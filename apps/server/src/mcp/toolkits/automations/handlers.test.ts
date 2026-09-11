import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AutomationId,
  AutomationRunId,
  type AutomationShell,
  type AutomationTrigger,
  AutomationsError,
  CommandId,
  EnvironmentId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { automationsToolkitHandlers } from "./handlers.ts";

const threadId = ThreadId.make("thread-caller");
const projectId = ProjectId.make("project-caller");
const otherProjectId = ProjectId.make("project-other");
const automationId = AutomationId.make("automation-1");
const NOW = "2026-01-01T00:00:00.000Z";
const isAutomationsError = Schema.is(AutomationsError);

/** Any service method the handler under test should not reach dies loudly. */
const stub = <T extends object>(overrides: Partial<T>): T =>
  new Proxy(overrides, {
    get: (target, key) =>
      Reflect.get(target, key) ?? (() => Effect.die(`unexpected call: ${String(key)}`)),
  }) as T;

const makeScope = (
  capabilities: ReadonlySet<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-automations"),
  threadId,
  providerSessionId: "provider-session-automations",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

const makeThreadShell = (input: {
  readonly runtimeMode?: RuntimeMode;
  readonly automationRun?: OrchestrationThreadShell["automationRun"];
}): OrchestrationThreadShell => ({
  id: threadId,
  projectId,
  title: "Caller thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" },
  runtimeMode: input.runtimeMode ?? "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  enabledSkillIds: [],
  ...(input.automationRun === undefined ? {} : { automationRun: input.automationRun }),
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});

const makeAutomationShell = (input: {
  readonly projectId?: ProjectId;
  readonly triggers?: ReadonlyArray<AutomationTrigger>;
  readonly runtimeMode?: RuntimeMode;
}): AutomationShell => ({
  id: automationId,
  projectId: input.projectId ?? projectId,
  name: "Nightly report",
  prompt: "Summarize what changed today.",
  triggers: input.triggers ?? [],
  enabled: true,
  modelSelection: null,
  runtimeMode: input.runtimeMode ?? "full-access",
  workspace: "checkout",
  createPullRequest: false,
  includeLastRunSummary: false,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  webhookToken: null,
  sourceThreadId: threadId,
  createdAt: NOW,
  updatedAt: NOW,
  nextRunAt: null,
  activeRun: null,
  lastRun: null,
  lastRequestedAt: null,
  pendingTrigger: null,
  consecutiveFailures: 0,
  runCount: 0,
  webhookPath: null,
});

interface HarnessInput {
  readonly capabilities?: ReadonlySet<McpInvocationContext.McpCapability>;
  readonly thread?: OrchestrationThreadShell;
  readonly automation?: AutomationShell | null;
}

const makeHarness = (input: HarnessInput = {}) => {
  const dispatched: Array<OrchestrationCommand> = [];
  const threadReads: Array<ThreadId> = [];
  const projection = stub<ProjectionSnapshotQuery["Service"]>({
    getThreadShellById: (id) =>
      Effect.sync(() => {
        threadReads.push(id);
        return Option.some(input.thread ?? makeThreadShell({}));
      }),
    getAutomationShellById: () =>
      Effect.succeed(
        input.automation === undefined || input.automation === null
          ? Option.none()
          : Option.some(input.automation),
      ),
    listAutomationShells: () =>
      Effect.succeed([makeAutomationShell({}), makeAutomationShell({ projectId: otherProjectId })]),
  });
  const engine = stub<OrchestrationEngineService["Service"]>({
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  });
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | McpInvocationContext.McpInvocationContext
      | ProjectionSnapshotQuery
      | OrchestrationEngineService
      | Crypto.Crypto
    >,
  ) =>
    effect.pipe(
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        makeScope(input.capabilities ?? new Set(["automations"])),
      ),
      Effect.provideService(ProjectionSnapshotQuery, projection),
      Effect.provideService(OrchestrationEngineService, engine),
      Effect.provide(NodeServices.layer),
    );
  return { dispatched, threadReads, run };
};

it.effect("refuses every automation tool without the automations capability", () =>
  Effect.gen(function* () {
    const harness = makeHarness({ capabilities: new Set(["preview"]) });

    const error = yield* harness.run(
      automationsToolkitHandlers.automations_list().pipe(Effect.flip),
    );

    assert.isTrue(isAutomationsError(error));
    assert.equal(error.operation, "capability");
    // The projection is never touched, so a stale credential cannot read state.
    assert.deepEqual(harness.threadReads, []);
  }),
);

it.effect("refuses to let an automation run create or trigger automations", () =>
  Effect.gen(function* () {
    const harness = makeHarness({
      thread: makeThreadShell({
        automationRun: { automationId, runId: AutomationRunId.make("run-1") },
      }),
      automation: makeAutomationShell({}),
    });

    const created = yield* harness.run(
      automationsToolkitHandlers
        .automations_create({ name: "Loop", prompt: "run me again" })
        .pipe(Effect.flip),
    );
    const ranNow = yield* harness.run(
      automationsToolkitHandlers.automations_run_now({ automationId }).pipe(Effect.flip),
    );

    assert.equal(created.operation, "create");
    assert.include(created.message, "automation run");
    assert.equal(ranNow.operation, "run-now");
    assert.deepEqual(harness.dispatched, []);
  }),
);

it.effect("hides automations that belong to another project", () =>
  Effect.gen(function* () {
    const harness = makeHarness({
      automation: makeAutomationShell({ projectId: otherProjectId }),
    });

    const error = yield* harness.run(
      automationsToolkitHandlers.automations_get({ automationId }).pipe(Effect.flip),
    );
    const listed = yield* harness.run(automationsToolkitHandlers.automations_list());

    assert.include(error.message, "No automation");
    assert.deepEqual(
      listed.automations.map((automation) => automation.projectId),
      [projectId],
    );
  }),
);

it.effect(
  "creates from the caller's project, clamps the permission mode, previews the schedule",
  () =>
    Effect.gen(function* () {
      const triggers: ReadonlyArray<AutomationTrigger> = [
        { type: "schedule", cron: "0 9 * * *", timezone: "Europe/Berlin" },
      ];
      const harness = makeHarness({
        thread: makeThreadShell({ runtimeMode: "approval-required" }),
        automation: makeAutomationShell({ triggers, runtimeMode: "approval-required" }),
      });

      const result = yield* harness.run(
        automationsToolkitHandlers.automations_create({
          name: "Nightly report",
          prompt: "Summarize what changed today.",
          // No timezone: the server fills its own zone.
          triggers: [{ type: "schedule", cron: "0 9 * * *" }, { type: "webhook" }],
          runtimeMode: "full-access",
        }),
      );

      const command = harness.dispatched[0];
      assert.equal(command?.type, "automation.create");
      if (command?.type !== "automation.create") return;
      assert.isTrue(command.commandId.startsWith("server:mcp-automation:"));
      assert.equal(command.projectId, projectId);
      assert.equal(command.sourceThreadId, threadId);
      // An agent cannot grant an automation more access than its own thread has.
      assert.equal(command.runtimeMode, "approval-required");
      assert.equal(command.triggers.length, 2);
      const schedule = command.triggers[0];
      assert.equal(schedule?.type, "schedule");
      if (schedule?.type !== "schedule") return;
      assert.isTrue(schedule.timezone.length > 0);
      assert.equal(result.nextRuns.length, 5);
      assert.include(result.note ?? "", "full-access");
    }),
);

it.effect("rejects a cron the schedule validator will not accept", () =>
  Effect.gen(function* () {
    const harness = makeHarness({});

    const invalid = yield* harness.run(
      automationsToolkitHandlers.automations_validate_schedule({
        cron: "* * * * *",
        timezone: "UTC",
      }),
    );
    const valid = yield* harness.run(
      automationsToolkitHandlers.automations_validate_schedule({
        cron: "0 9 * * 1-5",
        timezone: "UTC",
      }),
    );

    assert.isFalse(invalid.valid);
    assert.deepEqual(invalid.nextRuns, []);
    assert.include(invalid.error ?? "", "5 minutes");
    assert.isTrue(valid.valid);
    assert.equal(valid.nextRuns.length, 5);
    assert.equal(valid.error, null);
  }),
);

it.effect("asks a manual run for the caller's automation and reports the run id", () =>
  Effect.gen(function* () {
    const harness = makeHarness({ automation: makeAutomationShell({}) });

    const result = yield* harness.run(
      automationsToolkitHandlers.automations_run_now({ automationId }),
    );

    const command = harness.dispatched[0];
    assert.equal(command?.type, "automation.run.request");
    if (command?.type !== "automation.run.request") return;
    assert.deepEqual(command.trigger, { type: "manual", byThreadId: threadId });
    assert.equal(command.runId, result.runId);
    assert.notEqual(command.commandId, CommandId.make("server:mcp-automation:"));
  }),
);
