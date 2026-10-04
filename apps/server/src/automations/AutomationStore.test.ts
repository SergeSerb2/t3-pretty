import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AutomationId,
  AutomationRunId,
  CommandId,
  ProjectId,
  ThreadId,
  type AutomationCommand,
  type AutomationStreamMessage,
  type Project,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionAutomationRepositoryLive } from "../persistence/Layers/ProjectionAutomations.ts";
import { ProjectionAutomationRunRepositoryLive } from "../persistence/Layers/ProjectionAutomationRuns.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as AutomationStore from "./AutomationStore.ts";

const id = AutomationId.make("automation-test");
const runId = AutomationRunId.make("run-test");
const projectId = ProjectId.make("project-test");
const at = "2026-01-01T00:00:00.000Z";
const create = (
  overrides: Partial<Extract<AutomationCommand, { type: "automation.create" }>> = {},
): Extract<AutomationCommand, { type: "automation.create" }> => ({
  type: "automation.create",
  commandId: CommandId.make("create-test"),
  automationId: id,
  projectId,
  name: "Review",
  prompt: "Review commits",
  enabled: true,
  triggers: [{ type: "webhook" }],
  modelSelection: null,
  runtimeMode: "full-access",
  workspace: "checkout",
  createPullRequest: false,
  includeLastRunSummary: true,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});
const request = (
  overrides: Partial<Extract<AutomationCommand, { type: "automation.run.request" }>> = {},
): Extract<AutomationCommand, { type: "automation.run.request" }> => ({
  type: "automation.run.request",
  commandId: CommandId.make("request-test"),
  automationId: id,
  runId,
  trigger: { type: "manual", byThreadId: null },
  requestedAt: at,
  ...overrides,
});
const dependencies = Layer.mergeAll(
  ProjectionAutomationRepositoryLive,
  ProjectionAutomationRunRepositoryLive,
  NodeCrypto.layer,
  Layer.mock(ProjectService)({
    getById: () => Effect.succeed(Option.some({ id: projectId } as Project)),
  }),
).pipe(Layer.provideMerge(SqlitePersistenceMemory));
const layer = AutomationStore.layer.pipe(Layer.provideMerge(dependencies));

it.effect("keeps webhook tokens and run state across edits; command retries apply only once", () =>
  Effect.gen(function* () {
    const store = yield* AutomationStore.AutomationStore;
    yield* store.dispatch(create());
    const initial = Option.getOrThrow(yield* store.getAutomationShellById(id));
    assert.isNotNull(initial.webhookToken);
    yield* store.dispatch(create());
    yield* store.dispatch(request());
    yield* store.dispatch(request());
    yield* store.dispatch({
      type: "automation.update",
      commandId: CommandId.make("rename-test"),
      automationId: id,
      patch: { name: "Renamed" },
      updatedAt: at,
    });
    const edited = Option.getOrThrow(yield* store.getAutomationShellById(id));
    assert.equal(edited.name, "Renamed");
    assert.equal(edited.webhookToken, initial.webhookToken);
    assert.equal(edited.activeRun?.runId, runId);
    assert.equal((yield* store.listAutomationRuns({ automationId: id, limit: 10 })).runs.length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("coalesces event triggers during an active run and records completion atomically", () =>
  Effect.gen(function* () {
    const store = yield* AutomationStore.AutomationStore;
    yield* store.dispatch(create());
    yield* store.dispatch(request());
    const trigger = {
      type: "event",
      event: "turn.completed",
      threadId: ThreadId.make("source-thread"),
    } as const;
    yield* store.dispatch(
      request({
        commandId: CommandId.make("overlap-test"),
        runId: AutomationRunId.make("overlap-run"),
        trigger,
        requestedAt: "2026-01-01T00:02:00.000Z",
      }),
    );
    assert.deepEqual(
      Option.getOrThrow(yield* store.getAutomationShellById(id)).pendingTrigger,
      trigger,
    );
    yield* store.dispatch({
      type: "automation.run.finished",
      commandId: CommandId.make("finish-test"),
      automationId: id,
      runId,
      status: "completed",
      finishedAt: "2026-01-01T00:03:00.000Z",
      error: null,
      summary: "Reviewed",
    });
    const completed = Option.getOrThrow(yield* store.getAutomationShellById(id));
    assert.isNull(completed.activeRun);
    assert.equal(completed.lastRun?.summary, "Reviewed");
    assert.equal(completed.runCount, 1);
    assert.deepEqual(completed.pendingTrigger, trigger);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "rolls back a rejected overlapping manual run and allows explicit runs while paused",
  () =>
    Effect.gen(function* () {
      const store = yield* AutomationStore.AutomationStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.dispatch(create({ enabled: false }));
      yield* store.dispatch(request());
      const error = yield* store
        .dispatch(
          request({
            commandId: CommandId.make("rejected-test"),
            runId: AutomationRunId.make("rejected-run"),
          }),
        )
        .pipe(Effect.flip);
      assert.equal(error.detail, "Automation is already running.");
      assert.equal(
        (yield* sql`SELECT * FROM automation_command_receipts WHERE command_id = 'rejected-test'`)
          .length,
        0,
      );
      assert.equal(
        (yield* store.listAutomationRuns({ automationId: id, limit: 10 })).runs.length,
        1,
      );
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "deletes the definition and all run rows without resurrecting on delayed completion",
  () =>
    Effect.gen(function* () {
      const store = yield* AutomationStore.AutomationStore;
      yield* store.dispatch(create());
      yield* store.dispatch(request());
      yield* store.dispatch({
        type: "automation.delete",
        commandId: CommandId.make("delete-test"),
        automationId: id,
      });
      yield* store
        .dispatch({
          type: "automation.run.finished",
          commandId: CommandId.make("late-finish-test"),
          automationId: id,
          runId,
          status: "completed",
          finishedAt: at,
          error: null,
          summary: null,
        })
        .pipe(Effect.flip);
      assert.isTrue(Option.isNone(yield* store.getAutomationShellById(id)));
      assert.deepEqual((yield* store.listAutomationRuns({ automationId: id, limit: 10 })).runs, []);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "streams a consistent initial snapshot and independent durable revisions without replaying retries",
  () =>
    Effect.gen(function* () {
      const store = yield* AutomationStore.AutomationStore;
      const subscribed = yield* Deferred.make<void>();
      const events: Array<AutomationStreamMessage> = [];
      yield* store.dispatch(create());
      const fiber = yield* store.subscribeAutomationChanges().pipe(
        Stream.take(2),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "automation.snapshot")
              yield* Deferred.succeed(subscribed, undefined);
          }),
        ),
        Effect.forkScoped,
      );
      yield* Deferred.await(subscribed);
      yield* store.dispatch(create());
      yield* store.dispatch({
        type: "automation.update",
        commandId: CommandId.make("revision-update"),
        automationId: id,
        patch: { prompt: "New prompt" },
        updatedAt: at,
      });
      yield* Fiber.join(fiber);
      assert.deepEqual(
        events.map((event) => [event.type, event.revision]),
        [
          ["automation.snapshot", 1],
          ["automation.updated", 2],
        ],
      );
    }).pipe(Effect.provide(layer), Effect.scoped),
);

it.effect(
  "advances overlapping schedules while preserving the active run and recording a skip",
  () =>
    Effect.gen(function* () {
      const store = yield* AutomationStore.AutomationStore;
      yield* store.dispatch(
        create({ triggers: [{ type: "schedule", cron: "0 9 * * *", timezone: "UTC" }] }),
      );
      yield* store.dispatch(request());
      const scheduledFor = Option.getOrThrow(yield* store.getAutomationShellById(id)).nextRunAt!;
      yield* store.dispatch(
        request({
          commandId: CommandId.make("overlapping-schedule"),
          runId: AutomationRunId.make("skipped-schedule"),
          trigger: { type: "schedule", scheduledFor, catchUp: false },
          requestedAt: scheduledFor,
        }),
      );
      const automation = Option.getOrThrow(yield* store.getAutomationShellById(id));
      assert.equal(automation.activeRun?.runId, runId);
      assert.equal(automation.lastRun?.status, "skipped");
      assert.equal(automation.lastRun?.error, "Previous run still running");
      assert.notEqual(automation.nextRunAt, scheduledFor);
      assert.isNull(automation.pendingTrigger);
    }).pipe(Effect.provide(layer)),
);

it.effect("rejects debounced triggers and duplicate schedule instants without writing runs", () =>
  Effect.gen(function* () {
    const store = yield* AutomationStore.AutomationStore;
    yield* store.dispatch(create());
    yield* store.dispatch(request());
    const debounced = yield* store
      .dispatch(
        request({
          commandId: CommandId.make("debounced"),
          runId: AutomationRunId.make("debounced-run"),
          requestedAt: "2026-01-01T00:00:30.000Z",
          trigger: { type: "webhook", deliveryId: "delivery", payload: null },
        }),
      )
      .pipe(Effect.flip);
    assert.equal(debounced.detail, "Minimum interval has not elapsed.");
    const duplicate = yield* store
      .dispatch(
        request({
          commandId: CommandId.make("wrong-schedule"),
          runId: AutomationRunId.make("wrong-schedule-run"),
          trigger: { type: "schedule", scheduledFor: at, catchUp: false },
        }),
      )
      .pipe(Effect.flip);
    assert.equal(duplicate.detail, "Schedule instant is no longer due.");
    assert.equal((yield* store.listAutomationRuns({ automationId: id, limit: 10 })).runs.length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "rotates webhook credentials only on request and removes them with the webhook trigger",
  () =>
    Effect.gen(function* () {
      const store = yield* AutomationStore.AutomationStore;
      yield* store.dispatch(create());
      const before = Option.getOrThrow(yield* store.getAutomationShellById(id)).webhookToken;
      yield* store.dispatch({
        type: "automation.update",
        commandId: CommandId.make("rotate"),
        automationId: id,
        patch: {},
        rotateWebhookToken: true,
        updatedAt: at,
      });
      assert.notEqual(
        Option.getOrThrow(yield* store.getAutomationShellById(id)).webhookToken,
        before,
      );
      yield* store.dispatch({
        type: "automation.update",
        commandId: CommandId.make("remove-webhook"),
        automationId: id,
        patch: { triggers: [] },
        updatedAt: at,
      });
      const removed = Option.getOrThrow(yield* store.getAutomationShellById(id));
      assert.isNull(removed.webhookToken);
      assert.isNull(removed.webhookPath);
    }).pipe(Effect.provide(layer)),
);

it.effect("pages durable history in keyset order without dropping old runs", () =>
  Effect.gen(function* () {
    const store = yield* AutomationStore.AutomationStore;
    yield* store.dispatch(create());
    for (let index = 0; index < 27; index++) {
      const currentRunId = AutomationRunId.make(`history-run-${String(index).padStart(2, "0")}`);
      const requestedAt = `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`;
      yield* store.dispatch(
        request({
          commandId: CommandId.make(`history-request-${index}`),
          runId: currentRunId,
          requestedAt,
        }),
      );
      yield* store.dispatch({
        type: "automation.run.finished",
        commandId: CommandId.make(`history-finish-${index}`),
        automationId: id,
        runId: currentRunId,
        status: "completed",
        finishedAt: requestedAt,
        error: null,
        summary: null,
      });
    }
    const first = yield* store.listAutomationRuns({ automationId: id, limit: 20 });
    const second = yield* store.listAutomationRuns({
      automationId: id,
      limit: 20,
      beforeCursor: first.nextCursor!,
    });
    assert.equal(first.runs.length, 20);
    assert.equal(second.runs.length, 7);
    assert.isNull(second.nextCursor);
    assert.equal(second.runs.at(-1)?.id, "history-run-00");
    const ids = new Set([...first.runs, ...second.runs].map((run) => run.id));
    assert.equal(ids.size, 27);
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects stale missed ticks and a second ownership assignment", () =>
  Effect.gen(function* () {
    const store = yield* AutomationStore.AutomationStore;
    yield* store.dispatch(
      create({ triggers: [{ type: "schedule", cron: "0 9 * * *", timezone: "UTC" }] }),
    );
    const missed = yield* store
      .dispatch({
        type: "automation.run.missed",
        commandId: CommandId.make("stale-missed"),
        automationId: id,
        runId: AutomationRunId.make("stale-missed-run"),
        scheduledFor: at,
        at,
      })
      .pipe(Effect.flip);
    assert.equal(missed.detail, "Schedule instant is no longer due.");
    yield* store.dispatch(request());
    const started = {
      type: "automation.run.started" as const,
      commandId: CommandId.make("start-once"),
      automationId: id,
      runId,
      threadId: ThreadId.make("run-thread"),
      startedAt: at,
    };
    yield* store.dispatch(started);
    const repeated = yield* store
      .dispatch({
        ...started,
        commandId: CommandId.make("start-twice"),
        threadId: ThreadId.make("wrong-thread"),
      })
      .pipe(Effect.flip);
    assert.equal(repeated.detail, "Automation run has already started.");
    assert.equal(
      Option.getOrThrow(yield* store.getAutomationShellById(id)).activeRun?.threadId,
      started.threadId,
    );
    assert.equal((yield* store.listAutomationRuns({ automationId: id, limit: 10 })).runs.length, 1);
  }).pipe(Effect.provide(layer)),
);
