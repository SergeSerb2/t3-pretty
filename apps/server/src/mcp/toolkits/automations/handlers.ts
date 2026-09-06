import {
  AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
  AUTOMATION_RUNTIME_MODE_RANK,
  AutomationId,
  type AutomationPatch,
  AutomationRunId,
  type AutomationShell,
  type AutomationTrigger,
  AutomationsError,
  type AutomationsOperation,
  type AutomationsToolTrigger,
  CommandId,
  DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS,
  DEFAULT_AUTOMATION_TIMEOUT_MINUTES,
  DEFAULT_AUTOMATION_WORKSPACE,
  DEFAULT_RUNTIME_MODE,
  type IsoDateTime,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
  validateAutomationCron,
} from "@t3tools/contracts";
import { describeAutomationSchedule, nextRunPreview } from "@t3tools/shared/automationSchedule";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import type { OrchestrationDispatchError } from "../../../orchestration/Errors.ts";
import { isOrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";

/** Schedule instants previewed back to the agent after a create or update. */
const NEXT_RUNS_PREVIEW_COUNT = 5;
/** Runs returned alongside the automation by `automations_get`. */
const RECENT_RUNS_LIMIT = 10;

/**
 * Zone used when an agent omits one. Reading the host zone here (rather than
 * from settings) matches what the user sees in their own client when both run
 * on this machine.
 */
const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const failure = (operation: AutomationsOperation, message: string, automationId?: AutomationId) =>
  new AutomationsError({
    operation,
    message,
    ...(automationId === undefined ? {} : { automationId }),
  });

/** Everything a handler needs to know about the thread that called it. */
interface AutomationsCaller {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly runtimeMode: RuntimeMode;
  readonly isRunThread: boolean;
}

const requireCaller = (operation: AutomationsOperation) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireAutomationsCapability();
    const projection = yield* ProjectionSnapshotQuery;
    const thread = yield* projection
      .getThreadShellById(scope.threadId)
      .pipe(
        Effect.mapError(
          (cause) =>
            new AutomationsError({ operation, message: "Could not read this thread.", cause }),
        ),
      );
    if (Option.isNone(thread)) {
      return yield* failure(operation, "This thread is no longer available.");
    }
    return {
      threadId: scope.threadId,
      projectId: thread.value.projectId,
      runtimeMode: thread.value.runtimeMode,
      isRunThread: (thread.value.automationRun ?? null) !== null,
    } satisfies AutomationsCaller;
  });

/**
 * Callers that may change automations. An automation run must not create,
 * edit, or trigger automations: that is how a single prompt injection turns
 * into a self-sustaining loop.
 */
const requireWritingCaller = (operation: AutomationsOperation) =>
  Effect.gen(function* () {
    const caller = yield* requireCaller(operation);
    if (caller.isRunThread) {
      return yield* failure(
        operation,
        "This thread is an automation run, and automation runs cannot create, change, or trigger automations. Ask the user to do it from the app.",
      );
    }
    return caller;
  });

/** Automations of other projects are invisible, not merely refused. */
const requireAutomation = (
  operation: AutomationsOperation,
  caller: AutomationsCaller,
  automationId: AutomationId,
) =>
  Effect.gen(function* () {
    const projection = yield* ProjectionSnapshotQuery;
    const automation = yield* projection.getAutomationShellById(automationId).pipe(
      Effect.mapError(
        (cause) =>
          new AutomationsError({
            operation,
            automationId,
            message: "Could not read the automation.",
            cause,
          }),
      ),
    );
    if (Option.isNone(automation) || automation.value.projectId !== caller.projectId) {
      return yield* failure(
        operation,
        `No automation '${automationId}' in this project. Call automations_list to see the ones you can manage.`,
        automationId,
      );
    }
    return automation.value;
  });

/**
 * Fills the server zone into schedules the agent left zoneless and rejects
 * crons the automation schema would reject later, while the agent can still
 * read the reason.
 */
const resolveTriggers = (
  operation: AutomationsOperation,
  triggers: ReadonlyArray<AutomationsToolTrigger>,
): Effect.Effect<ReadonlyArray<AutomationTrigger>, AutomationsError> => {
  const resolved: Array<AutomationTrigger> = [];
  for (const trigger of triggers) {
    if (trigger.type !== "schedule") {
      resolved.push(trigger);
      continue;
    }
    const timezone = trigger.timezone ?? serverTimeZone();
    const validated = validateAutomationCron(trigger.cron, timezone);
    if (Result.isFailure(validated)) {
      return Effect.fail(
        failure(
          operation,
          `Schedule '${trigger.cron}' (${timezone}) is not usable: ${validated.failure}`,
        ),
      );
    }
    resolved.push({ type: "schedule", cron: trigger.cron, timezone });
  }
  return Effect.succeed(resolved);
};

/**
 * An agent may not grant an automation more access than the user granted the
 * thread it is running in.
 */
const clampRuntimeMode = (requested: RuntimeMode, callerMode: RuntimeMode) =>
  AUTOMATION_RUNTIME_MODE_RANK[requested] > AUTOMATION_RUNTIME_MODE_RANK[callerMode]
    ? { runtimeMode: callerMode, clampedFrom: requested }
    : { runtimeMode: requested, clampedFrom: null };

const mutationNote = (automation: AutomationShell, clampedFrom: RuntimeMode | null) => {
  const notes: Array<string> = [];
  if (clampedFrom !== null) {
    notes.push(
      `Permission mode was lowered from '${clampedFrom}' to '${automation.runtimeMode}': an automation cannot get more access than the thread that created it.`,
    );
  }
  if (automation.webhookPath !== null) {
    notes.push(
      `The webhook path ${automation.webhookPath} is not a full URL: ask the user which address of this machine the sender can reach and prefix the path with it.`,
    );
  }
  return notes.length === 0 ? null : notes.join(" ");
};

const dispatchFailure =
  (operation: AutomationsOperation, automationId: AutomationId) =>
  (cause: OrchestrationDispatchError) =>
    new AutomationsError({
      operation,
      automationId,
      // Decider rejections carry a plain sentence written for humans; anything
      // else is infrastructure the agent can do nothing about.
      message: isOrchestrationCommandInvariantError(cause)
        ? cause.detail
        : "The server could not apply this change.",
      cause,
    });

const commandId = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  return CommandId.make(`server:mcp-automation:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`);
});

const randomId = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  return yield* crypto.randomUUIDv4.pipe(Effect.orDie);
});

/** Shell plus the preview an agent needs to confirm the schedule it just saved. */
const mutationResult = (
  operation: AutomationsOperation,
  automationId: AutomationId,
  clampedFrom: RuntimeMode | null,
) =>
  Effect.gen(function* () {
    const projection = yield* ProjectionSnapshotQuery;
    const automation = yield* projection.getAutomationShellById(automationId).pipe(
      Effect.mapError(
        (cause) =>
          new AutomationsError({
            operation,
            automationId,
            message: "Could not read the automation back.",
            cause,
          }),
      ),
    );
    if (Option.isNone(automation)) {
      return yield* failure(
        operation,
        "The automation disappeared right after saving.",
        automationId,
      );
    }
    return {
      automation: automation.value,
      nextRuns: nextRunPreview(automation.value.triggers, yield* nowIso, NEXT_RUNS_PREVIEW_COUNT),
      webhookPath: automation.value.webhookPath,
      note: mutationNote(automation.value, clampedFrom),
    };
  });

export const automationsToolkitHandlers = {
  automations_list: () =>
    Effect.gen(function* () {
      const caller = yield* requireCaller("list");
      const projection = yield* ProjectionSnapshotQuery;
      const automations = yield* projection.listAutomationShells().pipe(
        Effect.mapError(
          (cause) =>
            new AutomationsError({
              operation: "list",
              message: "Could not list automations.",
              cause,
            }),
        ),
      );
      return {
        automations: automations.filter((automation) => automation.projectId === caller.projectId),
      };
    }),

  automations_get: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireCaller("get");
      const automation = yield* requireAutomation("get", caller, input.automationId);
      const projection = yield* ProjectionSnapshotQuery;
      const page = yield* projection
        .listAutomationRuns({ automationId: automation.id, limit: RECENT_RUNS_LIMIT })
        .pipe(
          Effect.mapError(
            (cause) =>
              new AutomationsError({
                operation: "get",
                automationId: automation.id,
                message: "Could not read the automation's runs.",
                cause,
              }),
          ),
        );
      return { automation, runs: page.runs };
    }),

  automations_create: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireWritingCaller("create");
      const triggers = yield* resolveTriggers("create", input.triggers ?? []);
      const { runtimeMode, clampedFrom } = clampRuntimeMode(
        input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        caller.runtimeMode,
      );
      const automationId = AutomationId.make(yield* randomId);
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "automation.create",
          commandId: yield* commandId,
          automationId,
          projectId: caller.projectId,
          name: input.name,
          prompt: input.prompt,
          triggers,
          enabled: input.enabled ?? true,
          modelSelection: input.modelSelection ?? null,
          runtimeMode,
          workspace: input.workspace ?? DEFAULT_AUTOMATION_WORKSPACE,
          ...(input.createPullRequest === undefined
            ? {}
            : { createPullRequest: input.createPullRequest }),
          includeLastRunSummary: input.includeLastRunSummary ?? false,
          catchUpMissedRuns: input.catchUpMissedRuns ?? true,
          minIntervalSeconds: input.minIntervalSeconds ?? DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS,
          timeoutMinutes: input.timeoutMinutes ?? DEFAULT_AUTOMATION_TIMEOUT_MINUTES,
          sourceThreadId: caller.threadId,
          createdAt: yield* nowIso,
        })
        .pipe(Effect.mapError(dispatchFailure("create", automationId)));
      return yield* mutationResult("create", automationId, clampedFrom);
    }),

  automations_update: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireWritingCaller("update");
      const automation = yield* requireAutomation("update", caller, input.automationId);
      const clamped =
        input.runtimeMode === undefined
          ? { runtimeMode: undefined, clampedFrom: null }
          : clampRuntimeMode(input.runtimeMode, caller.runtimeMode);
      const patch: AutomationPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.triggers === undefined
          ? {}
          : { triggers: yield* resolveTriggers("update", input.triggers) }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
        ...(clamped.runtimeMode === undefined ? {} : { runtimeMode: clamped.runtimeMode }),
        ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
        ...(input.createPullRequest === undefined
          ? {}
          : { createPullRequest: input.createPullRequest }),
        ...(input.includeLastRunSummary === undefined
          ? {}
          : { includeLastRunSummary: input.includeLastRunSummary }),
        ...(input.catchUpMissedRuns === undefined
          ? {}
          : { catchUpMissedRuns: input.catchUpMissedRuns }),
        ...(input.minIntervalSeconds === undefined
          ? {}
          : { minIntervalSeconds: input.minIntervalSeconds }),
        ...(input.timeoutMinutes === undefined ? {} : { timeoutMinutes: input.timeoutMinutes }),
      };
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "automation.update",
          commandId: yield* commandId,
          automationId: automation.id,
          patch,
          ...(input.rotateWebhookToken === true ? { rotateWebhookToken: true as const } : {}),
          updatedAt: yield* nowIso,
        })
        .pipe(Effect.mapError(dispatchFailure("update", automation.id)));
      return yield* mutationResult("update", automation.id, clamped.clampedFrom);
    }),

  automations_delete: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireWritingCaller("delete");
      const automation = yield* requireAutomation("delete", caller, input.automationId);
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "automation.delete",
          commandId: yield* commandId,
          automationId: automation.id,
        })
        .pipe(Effect.mapError(dispatchFailure("delete", automation.id)));
      return { automationId: automation.id };
    }),

  automations_run_now: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireWritingCaller("run-now");
      const automation = yield* requireAutomation("run-now", caller, input.automationId);
      const runId = AutomationRunId.make(yield* randomId);
      const engine = yield* OrchestrationEngineService;
      yield* engine
        .dispatch({
          type: "automation.run.request",
          commandId: yield* commandId,
          automationId: automation.id,
          runId,
          trigger: { type: "manual", byThreadId: caller.threadId },
          requestedAt: yield* nowIso,
        })
        .pipe(Effect.mapError(dispatchFailure("run-now", automation.id)));
      return { runId };
    }),

  automations_list_runs: (input) =>
    Effect.gen(function* () {
      const caller = yield* requireCaller("list-runs");
      const automation = yield* requireAutomation("list-runs", caller, input.automationId);
      const projection = yield* ProjectionSnapshotQuery;
      const page = yield* projection
        .listAutomationRuns({
          automationId: automation.id,
          limit: input.limit ?? AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new AutomationsError({
                operation: "list-runs",
                automationId: automation.id,
                message: "Could not read the automation's runs.",
                cause,
              }),
          ),
        );
      return { runs: page.runs };
    }),

  automations_validate_schedule: (input) =>
    Effect.gen(function* () {
      yield* McpInvocationContext.requireAutomationsCapability();
      const timezone = input.timezone ?? serverTimeZone();
      const validated = validateAutomationCron(input.cron, timezone);
      const description = describeAutomationSchedule(input.cron, timezone);
      if (Result.isFailure(validated)) {
        return {
          valid: false,
          timezone,
          nextRuns: [] as ReadonlyArray<IsoDateTime>,
          description,
          error: validated.failure,
        };
      }
      return {
        valid: true,
        timezone,
        nextRuns: nextRunPreview(
          [{ type: "schedule", cron: input.cron, timezone }],
          yield* nowIso,
          NEXT_RUNS_PREVIEW_COUNT,
        ),
        description,
        error: null,
      };
    }),
} satisfies Parameters<typeof AutomationsToolkit.toLayer>[0];

export const AutomationsToolkitHandlersLive = AutomationsToolkit.toLayer(
  automationsToolkitHandlers,
);
