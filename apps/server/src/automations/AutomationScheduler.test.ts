import {
  AutomationId,
  EventId,
  AutomationRunId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  RunId,
  type AutomationCommand,
  type HostPowerSnapshot,
  type AutomationRun,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2DomainEvent,
  type AutomationShell,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { transferProjection } from "../project/ProjectTransfer.testkit.ts";
import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import {
  type ThreadLaunchInput,
  ThreadLaunchService,
} from "../orchestration-v2/ThreadLaunchService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { PullRequestService } from "../pullRequest/PullRequestService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { type AutomationStoreEvent, AutomationStore } from "./AutomationStore.ts";
import { ServerActivation } from "../serverActivation.ts";
import * as AutomationScheduler from "./AutomationScheduler.ts";

const NOW = "2026-09-06T09:00:30.000Z";
const PROJECT_ID = ProjectId.make("project-1");
const AUTOMATION_ID = AutomationId.make("automation-1");
const RUN_ID = AutomationRunId.make("run-1");
const THREAD_ID = ThreadId.make("thread-run-1");
let uuidCounter = 0;
const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(++uuidCounter & 0xff),
  digest: (_algorithm, data) => Effect.succeed(data),
});
function makeAutomation(overrides: Partial<AutomationShell> = {}): AutomationShell {
  return {
    id: AUTOMATION_ID,
    projectId: PROJECT_ID,
    name: "Nightly review",
    prompt: "Review yesterday's commits.",
    enabled: true,
    triggers: [{ type: "schedule", cron: "0 9 * * *", timezone: "Europe/Berlin" }],
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: NOW,
    nextRunAt: null,
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

const harness = (
  automation: AutomationShell,
  options: {
    readonly suspended?: boolean;
    readonly enabled?: boolean;
    readonly thread?: OrchestrationV2ThreadShell;
    readonly events?: Stream.Stream<AutomationStoreEvent>;
    readonly launch?: ThreadLaunchService["Service"]["launch"];
    readonly git?: Partial<GitWorkflowService["Service"]>;
    readonly domainEvents?: Stream.Stream<OrchestrationV2DomainEvent>;
    readonly onCommand?: (command: AutomationCommand) => Effect.Effect<void>;
    readonly threadManagement?: Partial<ThreadManagementService["Service"]>;
  } = {},
) => {
  const commands: Array<AutomationCommand> = [];
  const interrupted: Array<ThreadId> = [];
  const hostPower: HostPowerSnapshot = {
    source: "unknown",
    idle: "unknown",
    idleSeconds: null,
    locked: "unknown",
    suspended: options.suspended ?? false,
    onBattery: "unknown",
    lowPowerMode: "unknown",
    thermalState: "unknown",
    stale: true,
    updatedAt: DateTime.makeUnsafe(NOW),
  };
  const dependencies = Layer.mergeAll(
    Layer.mock(AutomationStore)({
      listAutomationShells: () => Effect.succeed([automation]),
      getAutomationShellById: () => Effect.succeed(Option.some(automation)),
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
        }).pipe(Effect.andThen(options.onCommand?.(command) ?? Effect.void)),
      subscribeChanges: options.events ?? Stream.empty,
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: () => Effect.succeed(options.thread ?? null),
      interruptThread: (input) =>
        Effect.sync(() => {
          interrupted.push(input.threadId);
          return { type: "no_active_run" as const };
        }),
      getThreadProjection: () => Effect.die("summary read must not be needed"),
      streamDomainEvents: options.domainEvents ?? Stream.empty,
      ...options.threadManagement,
    }),
    Layer.mock(ThreadLaunchService)(options.launch === undefined ? {} : { launch: options.launch }),
    Layer.mock(ProjectService)({
      listShells: () =>
        Effect.succeed([
          {
            id: PROJECT_ID,
            title: "Project",
            workspaceRoot: "/workspace/project",
            defaultModelSelection: null,
            scripts: [],
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]),
      getShell: () =>
        Effect.succeed(
          Option.some({
            id: PROJECT_ID,
            title: "Project",
            workspaceRoot: "/workspace/project",
            defaultModelSelection: null,
            scripts: [],
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ),
    }),
    Layer.mock(GitWorkflowService)(options.git ?? {}),
    Layer.mock(PullRequestService)({ subscribeMerges: Effect.succeed(Stream.empty) }),
    Layer.succeed(ServerActivation, Effect.void),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        ...DEFAULT_SERVER_SETTINGS,
        automations: { ...DEFAULT_SERVER_SETTINGS.automations, enabled: options.enabled ?? true },
      }),
    }),
    Layer.mock(BackgroundPolicy)({
      snapshot: Effect.succeed({
        hostPower,
        leases: [],
        activeForegroundLeaseCount: 0,
        activeScopeKeys: [],
        shouldRunOpportunisticWork: false,
        updatedAt: DateTime.makeUnsafe(NOW),
      }),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const layer = AutomationScheduler.layer.pipe(Layer.provide(dependencies));
  const tick = Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const scheduler = yield* AutomationScheduler.AutomationScheduler;
    yield* scheduler.tickOnce;
  }).pipe(Effect.provide(layer), Effect.scoped);
  return { commands, interrupted, tick, layer };
};

it.effect("requests a due schedule once and skips work while disabled or suspended", () =>
  Effect.gen(function* () {
    const due = harness(makeAutomation({ nextRunAt: "2026-09-06T09:00:00.000Z" }));
    yield* due.tick;
    assert.equal(due.commands[0]?.type, "automation.run.request");
    for (const options of [{ enabled: false }, { suspended: true }]) {
      const stopped = harness(makeAutomation({ nextRunAt: "2026-09-06T09:00:00.000Z" }), options);
      yield* stopped.tick;
      assert.deepEqual(stopped.commands, []);
    }
  }),
);

it.effect("records missed schedules when catch-up is disabled", () =>
  Effect.gen(function* () {
    const missed = harness(
      makeAutomation({ nextRunAt: "2026-09-06T08:00:00.000Z", catchUpMissedRuns: false }),
    );
    yield* missed.tick;
    assert.equal(missed.commands[0]?.type, "automation.run.missed");
  }),
);

it.effect("times out active V2 runs and interrupts their owned thread", () =>
  Effect.gen(function* () {
    const active = harness(
      makeAutomation({
        nextRunAt: null,
        timeoutMinutes: 1,
        activeRun: {
          runId: RUN_ID,
          threadId: THREAD_ID,
          requestedAt: "2026-09-06T08:00:00.000Z",
          startedAt: "2026-09-06T08:00:00.000Z",
        },
      }),
      { thread: { id: THREAD_ID, projectId: PROJECT_ID } as OrchestrationV2ThreadShell },
    );
    yield* active.tick;
    const command = active.commands[0];
    assert.equal(command?.type, "automation.run.finished");
    if (command?.type === "automation.run.finished") {
      assert.equal(command.status, "interrupted");
      assert.equal(command.error, "Timed out after 1 minutes");
    }
    assert.deepEqual(active.interrupted, [THREAD_ID]);
  }),
);

it.effect("recovers a lost run thread instead of leaving a permanent active run", () =>
  Effect.gen(function* () {
    const lost = harness(
      makeAutomation({
        nextRunAt: null,
        activeRun: {
          runId: RUN_ID,
          threadId: THREAD_ID,
          requestedAt: "2026-09-06T08:00:00.000Z",
          startedAt: "2026-09-06T08:00:00.000Z",
        },
      }),
    );
    yield* lost.tick;
    assert.equal(lost.commands[0]?.type, "automation.run.finished");
  }),
);

it.effect(
  "launches a V2 thread with workspace, permission mode, automation ownership and run prompt context",
  () =>
    Effect.gen(function* () {
      const launched = yield* Deferred.make<void>();
      const inputs: Array<ThreadLaunchInput> = [];
      const automation = makeAutomation({
        workspace: "checkout",
        runtimeMode: "approval-required",
        activeRun: { runId: RUN_ID, threadId: null, requestedAt: NOW, startedAt: null },
      });
      const run: AutomationRun = {
        id: RUN_ID,
        automationId: AUTOMATION_ID,
        projectId: PROJECT_ID,
        threadId: null,
        status: "requested",
        trigger: { type: "manual", byThreadId: null },
        requestedAt: NOW,
        startedAt: null,
        finishedAt: null,
        error: null,
        summary: null,
      };
      const test = harness(automation, {
        events: Stream.make({ type: "automation.run-requested", run }),
        launch: (input) =>
          Effect.gen(function* () {
            inputs.push(input);
            yield* Deferred.succeed(launched, undefined);
            return {
              threadId: input.threadId!,
              projection: {} as OrchestrationV2ThreadProjection,
              resumed: false,
            };
          }),
      });
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const scheduler = yield* AutomationScheduler.AutomationScheduler;
        yield* scheduler.start();
        yield* Deferred.await(launched);
        yield* scheduler.drain;
      }).pipe(Effect.provide(test.layer), Effect.scoped);
      assert.equal(inputs.length, 1);
      const input = inputs[0]!;
      assert.deepEqual(input.automationRun, { automationId: AUTOMATION_ID, runId: RUN_ID });
      assert.equal(input.runtimeMode, "approval-required");
      assert.deepEqual(input.workspaceStrategy, { type: "root" });
      assert.include(input.initialMessage!.text, "Review yesterday's commits.");
      assert.include(input.initialMessage!.text, RUN_ID);
      assert.equal(test.commands[0]?.type, "automation.run.started");
    }),
);

it.effect("replays pending triggers only after the debounce window and while enabled", () =>
  Effect.gen(function* () {
    const pending = { type: "webhook", deliveryId: "pending-delivery", payload: null } as const;
    const ready = harness(
      makeAutomation({
        triggers: [],
        pendingTrigger: pending,
        lastRequestedAt: "2026-09-06T08:00:00.000Z",
      }),
    );
    yield* ready.tick;
    assert.equal(ready.commands[0]?.type, "automation.run.request");
    for (const overrides of [{ enabled: false }, { lastRequestedAt: NOW }]) {
      const parked = harness(
        makeAutomation({
          triggers: [],
          pendingTrigger: pending,
          lastRequestedAt: "2026-09-06T08:00:00.000Z",
          ...overrides,
        }),
      );
      yield* parked.tick;
      assert.deepEqual(parked.commands, []);
    }
  }),
);

it.effect("baselines git triggers silently and dispatches only a later changed remote commit", () =>
  Effect.gen(function* () {
    let commit = "commit-a";
    const test = harness(makeAutomation({ triggers: [{ type: "git", branch: "main" }] }), {
      git: {
        fetchRemote: () => Effect.void,
        resolveRemoteTrackingCommit: () =>
          Effect.sync(() => ({ commitSha: commit, remoteRefName: "origin/main" })),
      },
    });
    yield* Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const scheduler = yield* AutomationScheduler.AutomationScheduler;
      yield* scheduler.pollGitOnce;
      assert.deepEqual(test.commands, []);
      commit = "commit-b";
      yield* scheduler.pollGitOnce;
      yield* scheduler.pollGitOnce;
    }).pipe(Effect.provide(test.layer), Effect.scoped);
    assert.equal(test.commands.length, 1);
    const command = test.commands[0]!;
    if (command.type === "automation.run.request") {
      assert.deepEqual(command.trigger, {
        type: "git",
        branch: "main",
        fromCommit: "commit-a",
        toCommit: "commit-b",
      });
    } else assert.fail("Git push did not request an automation run");
  }),
);

it.effect(
  "fires completion events even when the projection advances before the worker reads the running event",
  () =>
    Effect.gen(function* () {
      const fired = yield* Deferred.make<void>();
      const providerRunId = RunId.make("fast-provider-run");
      const event = (type: "run.created" | "run.updated", status: "running" | "completed") =>
        ({
          type,
          payload: { id: providerRunId, threadId: THREAD_ID, status },
        }) as OrchestrationV2DomainEvent;
      const test = harness(
        makeAutomation({ triggers: [{ type: "event", event: "turn.completed" }] }),
        {
          thread: {
            id: THREAD_ID,
            projectId: PROJECT_ID,
            status: "completed",
            latestRunId: providerRunId,
            automationRun: null,
          } as OrchestrationV2ThreadShell,
          domainEvents: Stream.make(
            event("run.created", "running"),
            event("run.updated", "completed"),
          ),
          onCommand: (command) =>
            command.type === "automation.run.request"
              ? Deferred.succeed(fired, undefined).pipe(Effect.asVoid)
              : Effect.void,
        },
      );
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const scheduler = yield* AutomationScheduler.AutomationScheduler;
        yield* scheduler.start();
        yield* Deferred.await(fired);
        yield* scheduler.drain;
      }).pipe(Effect.provide(test.layer), Effect.scoped);
      const request = test.commands.find((command) => command.type === "automation.run.request");
      assert.deepEqual(request?.trigger, {
        type: "event",
        event: "turn.completed",
        threadId: THREAD_ID,
      });
    }),
);

it.effect(
  "deleting an automation removes active and archived V2 run threads and their worktrees",
  () =>
    Effect.gen(function* () {
      const projection = yield* ProjectionStore.ProjectionStoreV2;
      const queued = yield* Deferred.make<void>();
      const deleted: ThreadId[] = [];
      const removedWorktrees: string[] = [];
      const ids = [
        ThreadId.make("active-automation-run"),
        ThreadId.make("archived-automation-run"),
      ];
      const now = DateTime.makeUnsafe(NOW);
      for (const [index, id] of ids.entries()) {
        yield* projection.apply({
          id: EventId.make(`create:${id}`),
          type: "thread.created",
          threadId: id,
          occurredAt: now,
          payload: {
            ...transferProjection(id).thread,
            projectId: PROJECT_ID,
            automationRun: { automationId: AUTOMATION_ID, runId: RUN_ID },
            worktreePath: `/workspace/worktrees/${id}`,
            archivedAt: index === 1 ? now : null,
          },
        });
      }
      assert.equal((yield* projection.getShellSnapshot({ location: "archive" })).threads.length, 0);
      assert.equal(
        (yield* projection.getShellSnapshot({ location: "archive" })).archivedThreads.length,
        1,
      );
      const test = harness(makeAutomation(), {
        events: Stream.concat(
          Stream.make({
            type: "automation.removed" as const,
            automationId: AUTOMATION_ID,
            revision: 1,
          }),
          Stream.fromEffect(Deferred.succeed(queued, undefined)).pipe(Stream.drain),
        ),
        threadManagement: {
          getShellSnapshot: (options) => projection.getShellSnapshot(options).pipe(Effect.orDie),
          dispatch: (command) =>
            Effect.gen(function* () {
              if (command.type !== "thread.delete") {
                return yield* Effect.die(new Error(`Unexpected command: ${command.type}`));
              }
              const thread = yield* projection.getThread(command.threadId);
              yield* projection.apply({
                id: EventId.make(`delete:${command.threadId}`),
                type: "thread.deleted",
                threadId: command.threadId,
                occurredAt: now,
                payload: { ...thread, deletedAt: now },
              });
              deleted.push(command.threadId);
              return {
                sequence: 1,
                storedEvents: [],
              };
            }).pipe(Effect.orDie),
        },
        git: {
          removeWorktree: (input) =>
            Effect.sync(() => {
              removedWorktrees.push(input.path);
            }),
        },
      });
      yield* Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler.AutomationScheduler;
        yield* scheduler.start();
        yield* Deferred.await(queued);
        yield* scheduler.drain;
      }).pipe(Effect.provide(test.layer), Effect.scoped);
      assert.deepEqual(deleted.toSorted(), ids.toSorted());
      assert.deepEqual(
        removedWorktrees.toSorted(),
        ids.map((id) => `/workspace/worktrees/${id}`).toSorted(),
      );
      const remaining = yield* projection.getShellSnapshot();
      assert.deepEqual(remaining.threads, []);
      assert.deepEqual(remaining.archivedThreads, []);
    }).pipe(Effect.provide(ProjectionStore.layerMemory)),
);
