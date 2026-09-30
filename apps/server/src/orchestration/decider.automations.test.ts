import {
  AutomationId,
  AutomationRunId,
  CommandId,
  ProjectId,
  ThreadId,
  type AutomationShell,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
/** `it.effect` pins the TestClock at the epoch; automation timestamps come from the server clock. */
const SERVER_NOW = "1970-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const automationId = AutomationId.make("automation-1");
const runId = AutomationRunId.make("run-1");
const commandId = CommandId.make("cmd-1");
const DAILY_NINE = { type: "schedule", cron: "0 9 * * *", timezone: "UTC" } as const;

function makeAutomation(overrides: Partial<AutomationShell> = {}): AutomationShell {
  return {
    id: automationId,
    projectId,
    name: "Nightly",
    prompt: "Do the thing",
    enabled: true,
    triggers: [DAILY_NINE],
    modelSelection: null,
    runtimeMode: "full-access",
    workspace: "checkout",
    createPullRequest: false,
    includeLastRunSummary: false,
    catchUpMissedRuns: true,
    minIntervalSeconds: 60,
    timeoutMinutes: 120,
    webhookToken: null,
    sourceThreadId: null,
    createdAt: NOW,
    updatedAt: NOW,
    nextRunAt: "2026-01-01T09:00:00.000Z",
    activeRun: null,
    lastRun: null,
    lastRequestedAt: null,
    pendingTrigger: null,
    consecutiveFailures: 0,
    runCount: 0,
    webhookPath: null,
    ...overrides,
  };
}

function makeReadModel(automations: ReadonlyArray<AutomationShell>): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [],
    automations,
    updatedAt: NOW,
  };
}

const ACTIVE_RUN = {
  runId: AutomationRunId.make("run-active"),
  threadId: null,
  requestedAt: "2026-01-01T08:00:00.000Z",
  startedAt: null,
};

const runRequest = (
  trigger: Extract<OrchestrationCommand, { type: "automation.run.request" }>["trigger"],
  requestedAt = "2026-01-01T09:00:10.000Z",
): OrchestrationCommand => ({
  type: "automation.run.request",
  commandId,
  automationId,
  runId,
  trigger,
  requestedAt,
});

const decideOne = (command: OrchestrationCommand, readModel: OrchestrationReadModel) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.map((result) => (Array.isArray(result) ? result[0]! : result) as OrchestrationEvent),
  );

const createCommand = (
  triggers: AutomationShell["triggers"],
): Extract<OrchestrationCommand, { type: "automation.create" }> => ({
  type: "automation.create",
  commandId,
  automationId,
  projectId,
  name: "Nightly",
  prompt: "Do the thing",
  triggers,
  enabled: true,
  modelSelection: null,
  runtimeMode: "full-access",
  workspace: "worktree",
  includeLastRunSummary: false,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  createdAt: NOW,
});

it.layer(NodeServices.layer)("automation decider", (it) => {
  it.effect("create mints a webhook token only when a webhook trigger exists", () =>
    Effect.gen(function* () {
      const without = yield* decideOne(createCommand([DAILY_NINE]), makeReadModel([]));
      expect(without.type).toBe("automation.created");
      if (without.type !== "automation.created") return;
      expect(without.payload.automation.webhookToken).toBeNull();
      // createPullRequest defaults from the workspace when the command omits it.
      expect(without.payload.automation.createPullRequest).toBe(true);
      // The client's createdAt is ignored so nextRunAt derives from server time.
      expect(without.occurredAt).toBe(SERVER_NOW);
      expect(without.payload.automation.createdAt).toBe(SERVER_NOW);
      expect(without.payload.automation.updatedAt).toBe(SERVER_NOW);

      const withWebhook = yield* decideOne(createCommand([{ type: "webhook" }]), makeReadModel([]));
      if (withWebhook.type !== "automation.created") return;
      expect(withWebhook.payload.automation.webhookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }),
  );

  it.effect("update keeps, rotates, and drops the webhook token", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel([
        makeAutomation({ triggers: [{ type: "webhook" }], webhookToken: "token-1" }),
      ]);
      const update = (
        patch: Extract<OrchestrationCommand, { type: "automation.update" }>["patch"],
        rotate?: true,
      ): OrchestrationCommand => ({
        type: "automation.update",
        commandId,
        automationId,
        patch,
        ...(rotate ? { rotateWebhookToken: true } : {}),
        updatedAt: "2026-01-02T00:00:00.000Z",
      });

      const kept = yield* decideOne(update({ name: "Renamed" }), readModel);
      if (kept.type !== "automation.updated") return;
      expect(kept.payload.automation.webhookToken).toBe("token-1");
      expect(kept.payload.automation.name).toBe("Renamed");
      expect(kept.occurredAt).toBe(SERVER_NOW);
      expect(kept.payload.automation.updatedAt).toBe(SERVER_NOW);
      expect(kept.payload.automation.createdAt).toBe(NOW);

      const rotated = yield* decideOne(update({}, true), readModel);
      if (rotated.type !== "automation.updated") return;
      expect(rotated.payload.automation.webhookToken).not.toBe("token-1");
      expect(rotated.payload.automation.webhookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const dropped = yield* decideOne(update({ triggers: [DAILY_NINE] }), readModel);
      if (dropped.type !== "automation.updated") return;
      expect(dropped.payload.automation.webhookToken).toBeNull();
    }),
  );

  it.effect("manual: rejected while a run is active, allowed while paused", () =>
    Effect.gen(function* () {
      const manual = { type: "manual", byThreadId: null } as const;
      const rejected = yield* decideOne(
        runRequest(manual),
        makeReadModel([makeAutomation({ activeRun: ACTIVE_RUN })]),
      ).pipe(Effect.flip);
      expect(rejected._tag).toBe("OrchestrationCommandInvariantError");

      const paused = yield* decideOne(
        runRequest(manual),
        makeReadModel([makeAutomation({ enabled: false, nextRunAt: null })]),
      );
      expect(paused.type).toBe("automation.run-requested");
      if (paused.type !== "automation.run-requested") return;
      expect(paused.payload.run.status).toBe("requested");
      expect(paused.payload.run.trigger).toEqual(manual);
    }),
  );

  it.effect("schedule: duplicate instants reject, overlap skips, paused rejects", () =>
    Effect.gen(function* () {
      const scheduled = (scheduledFor: string) =>
        ({ type: "schedule", scheduledFor, catchUp: false }) as const;

      const duplicate = yield* decideOne(
        runRequest(scheduled("2025-12-31T09:00:00.000Z")),
        makeReadModel([makeAutomation()]),
      ).pipe(Effect.flip);
      expect(duplicate._tag).toBe("OrchestrationCommandInvariantError");

      const skipped = yield* decideOne(
        runRequest(scheduled("2026-01-01T09:00:00.000Z")),
        makeReadModel([makeAutomation({ activeRun: ACTIVE_RUN })]),
      );
      expect(skipped.type).toBe("automation.run-skipped");
      if (skipped.type !== "automation.run-skipped") return;
      expect(skipped.payload.run.status).toBe("skipped");
      expect(skipped.payload.run.error).toBe("Previous run still running");

      const paused = yield* decideOne(
        runRequest(scheduled("2026-01-01T09:00:00.000Z")),
        makeReadModel([makeAutomation({ enabled: false, nextRunAt: null })]),
      ).pipe(Effect.flip);
      expect(paused._tag).toBe("OrchestrationCommandInvariantError");

      const requested = yield* decideOne(
        runRequest(scheduled("2026-01-01T09:00:00.000Z")),
        makeReadModel([makeAutomation()]),
      );
      expect(requested.type).toBe("automation.run-requested");
    }),
  );

  it.effect("event: debounced requests reject, overlapping ones coalesce", () =>
    Effect.gen(function* () {
      const trigger = {
        type: "event",
        event: "turn.completed",
        threadId: ThreadId.make("thread-1"),
      } as const;

      const debounced = yield* decideOne(
        runRequest(trigger, "2026-01-01T09:00:30.000Z"),
        makeReadModel([makeAutomation({ lastRequestedAt: "2026-01-01T09:00:00.000Z" })]),
      ).pipe(Effect.flip);
      expect(debounced._tag).toBe("OrchestrationCommandInvariantError");

      const coalesced = yield* decideOne(
        runRequest(trigger, "2026-01-01T09:02:00.000Z"),
        makeReadModel([
          makeAutomation({ lastRequestedAt: "2026-01-01T09:00:00.000Z", activeRun: ACTIVE_RUN }),
        ]),
      );
      expect(coalesced.type).toBe("automation.run-coalesced");
      if (coalesced.type !== "automation.run-coalesced") return;
      expect(coalesced.payload.trigger).toEqual(trigger);
    }),
  );

  it.effect("run.started and run.finished only apply to the active run", () =>
    Effect.gen(function* () {
      const started: OrchestrationCommand = {
        type: "automation.run.started",
        commandId,
        automationId,
        runId: ACTIVE_RUN.runId,
        threadId: ThreadId.make("thread-run"),
        startedAt: "2026-01-01T08:00:05.000Z",
      };
      const finished: OrchestrationCommand = {
        type: "automation.run.finished",
        commandId,
        automationId,
        runId: ACTIVE_RUN.runId,
        status: "completed",
        finishedAt: "2026-01-01T08:10:00.000Z",
      };

      const startedEvent = yield* decideOne(
        started,
        makeReadModel([makeAutomation({ activeRun: ACTIVE_RUN })]),
      );
      expect(startedEvent.type).toBe("automation.run-started");

      // A second start (thread already attached) is rejected.
      const startedTwice = yield* decideOne(
        started,
        makeReadModel([
          makeAutomation({ activeRun: { ...ACTIVE_RUN, threadId: ThreadId.make("thread-run") } }),
        ]),
      ).pipe(Effect.flip);
      expect(startedTwice._tag).toBe("OrchestrationCommandInvariantError");

      const finishedEvent = yield* decideOne(
        finished,
        makeReadModel([makeAutomation({ activeRun: ACTIVE_RUN })]),
      );
      expect(finishedEvent.type).toBe("automation.run-finished");
      if (finishedEvent.type !== "automation.run-finished") return;
      expect(finishedEvent.payload.error).toBeNull();

      const finishedTwice = yield* decideOne(finished, makeReadModel([makeAutomation()])).pipe(
        Effect.flip,
      );
      expect(finishedTwice._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("project.delete cascades automation.deleted before project.deleted", () =>
    Effect.gen(function* () {
      const events = yield* decideOrchestrationCommand({
        command: { type: "project.delete", commandId, projectId },
        readModel: makeReadModel([makeAutomation()]),
      });
      const types = (Array.isArray(events) ? events : [events]).map((event) => event.type);
      expect(types).toEqual(["automation.deleted", "project.deleted"]);
    }),
  );
});
