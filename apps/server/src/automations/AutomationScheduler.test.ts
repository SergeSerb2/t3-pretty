import {
  AUTOMATION_KEEP_RUN_THREADS,
  AutomationId,
  AutomationRunId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AutomationRun,
  type AutomationShell,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import { AUTOMATION_RUN_OPEN_MARKER } from "@t3tools/shared/automationRunPrompt";
import { CREATE_PULL_REQUEST_OPEN_MARKER } from "@t3tools/shared/createPullRequestPrompt";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { makeUnknownSnapshot } from "../background/HostPowerMonitor.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import {
  PullRequestService,
  type PullRequestMergeEvent,
} from "../pullRequest/PullRequestService.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
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

function makeProject(
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "T3 Code",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: NOW,
    ...overrides,
  };
}

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

function makeThread(
  id: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId: PROJECT_ID,
    title: id,
    enabledSkillIds: [],
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeSession(
  status: OrchestrationSession["status"],
  activeTurnId: string | null,
  lastError: string | null = null,
): OrchestrationSession {
  return {
    threadId: THREAD_ID,
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: activeTurnId === null ? null : TurnId.make(activeTurnId),
    lastError,
    updatedAt: NOW,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: RUN_ID,
    automationId: AUTOMATION_ID,
    projectId: PROJECT_ID,
    threadId: null,
    status: "requested",
    trigger: { type: "schedule", scheduledFor: "2026-09-06T07:00:00.000Z", catchUp: false },
    requestedAt: NOW,
    startedAt: null,
    finishedAt: null,
    error: null,
    summary: null,
    ...overrides,
  };
}

let eventSequence = 0;
function makeEvent(
  type: OrchestrationEvent["type"],
  payload: unknown,
  aggregate: { kind: "thread" | "automation"; id: string },
): OrchestrationEvent {
  return {
    sequence: ++eventSequence,
    eventId: EventId.make(`event-${eventSequence}`),
    aggregateKind: aggregate.kind,
    aggregateId: aggregate.id,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as OrchestrationEvent;
}

const sessionSetEvent = (threadId: ThreadId, session: OrchestrationSession) =>
  makeEvent("thread.session-set", { threadId, session }, { kind: "thread", id: threadId });

interface HarnessOptions {
  readonly automations?: ReadonlyArray<AutomationShell>;
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly messages?: ReadonlyArray<OrchestrationThread["messages"][number]>;
  readonly settings?: ServerSettings;
  readonly suspended?: boolean;
  readonly git?: Partial<GitWorkflowService["Service"]>;
  /** Commands of this type are recorded, then rejected like the decider would. */
  readonly rejectWith?: { readonly type: OrchestrationCommand["type"]; readonly detail: string };
}

const makeHarness = Effect.fn("makeAutomationSchedulerHarness")(function* (
  options: HarnessOptions = {},
) {
  const activation = yield* Deferred.make<void>();
  const automations = yield* Ref.make(options.automations ?? []);
  const threads = yield* Ref.make(options.threads ?? []);
  const projects = options.projects ?? [makeProject()];
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const gitCalls = yield* Ref.make<ReadonlyArray<string>>([]);
  const setupCalls = yield* Ref.make<ReadonlyArray<string>>([]);
  const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
  const merges = yield* PubSub.unbounded<PullRequestMergeEvent>();
  const remoteCommit = yield* Ref.make("commit-a");

  const dispatch: OrchestrationEngineService["Service"]["dispatch"] = (command) =>
    Ref.update(commands, (recorded) => [...recorded, command]).pipe(
      Effect.andThen(
        options.rejectWith?.type === command.type
          ? Effect.fail(
              new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: options.rejectWith.detail,
              }),
            )
          : Effect.succeed({ sequence: 1 }),
      ),
    );

  const recordGit = (call: string) => Ref.update(gitCalls, (calls) => [...calls, call]);
  const gitService = {
    remoteExists: () => Effect.succeed(true),
    fetchRemote: ({ cwd }) => recordGit(`fetch ${cwd}`),
    resolveRemoteTrackingCommit: ({ refName }) =>
      Ref.get(remoteCommit).pipe(
        Effect.map((commitSha) => ({ commitSha, remoteRefName: `origin/${refName}` })),
      ),
    listRefs: () =>
      Effect.succeed({
        refs: [
          { name: "main", current: true, isDefault: true, worktreePath: null },
          { name: "feature", current: false, isDefault: false, worktreePath: null },
        ],
        isRepo: true,
        hasPrimaryRemote: true,
        nextCursor: null,
        totalCount: 2,
      }),
    createWorktree: ({ newRefName }) =>
      recordGit(`create ${newRefName}`).pipe(
        Effect.as({
          worktree: { path: `/workspace/.worktrees/${newRefName}`, refName: newRefName ?? "" },
        }),
      ),
    removeWorktree: ({ path }) => recordGit(`remove ${path}`),
    ...options.git,
  } satisfies Partial<GitWorkflowService["Service"]>;

  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      listAutomationShells: () => Ref.get(automations),
      getAutomationShellById: (id) =>
        Ref.get(automations).pipe(
          Effect.map((rows) => Option.fromNullishOr(rows.find((row) => row.id === id))),
        ),
      getProjectShellById: (id) =>
        Effect.succeed(Option.fromNullishOr(projects.find((project) => project.id === id))),
      getThreadShellById: (id) =>
        Ref.get(threads).pipe(
          Effect.map((rows) => Option.fromNullishOr(rows.find((row) => row.id === id))),
        ),
      getShellSnapshot: () =>
        Effect.all({ automations: Ref.get(automations), threads: Ref.get(threads) }).pipe(
          Effect.map((state) => ({ ...state, projects, snapshotSequence: 1, updatedAt: NOW })),
        ),
      getThreadDetailById: (id) =>
        Ref.get(threads).pipe(
          Effect.map((rows) => {
            const shell = rows.find((row) => row.id === id);
            return shell === undefined
              ? Option.none()
              : Option.some({
                  ...shell,
                  deletedAt: null,
                  messages: options.messages ?? [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                } satisfies OrchestrationThread);
          }),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch,
      subscribeDomainEvents: PubSub.subscribe(domainEvents).pipe(
        Effect.map((subscription) => Stream.fromSubscription(subscription)),
      ),
    }),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed(options.settings ?? DEFAULT_SERVER_SETTINGS),
    }),
    Layer.mock(BackgroundPolicy)({
      snapshot: Effect.succeed({
        hostPower: {
          ...makeUnknownSnapshot("unknown", DateTime.makeUnsafe(NOW)),
          suspended: options.suspended ?? false,
        },
        leases: [],
        activeForegroundLeaseCount: 0,
        activeScopeKeys: [],
        shouldRunOpportunisticWork: false,
        updatedAt: DateTime.makeUnsafe(NOW),
      }),
    }),
    Layer.mock(GitWorkflowService)(gitService),
    Layer.mock(ProjectSetupScriptRunner)({
      runForThread: ({ threadId }) =>
        Ref.update(setupCalls, (calls) => [...calls, threadId]).pipe(
          Effect.as({ status: "no-script" as const }),
        ),
    }),
    Layer.mock(PullRequestService)({
      subscribeMerges: PubSub.subscribe(merges).pipe(
        Effect.map((subscription) => Stream.fromSubscription(subscription)),
      ),
    }),
    Layer.succeed(ServerActivation, Deferred.await(activation)),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );

  return {
    activation,
    automations,
    threads,
    commands,
    gitCalls,
    setupCalls,
    remoteCommit,
    publish: (event: OrchestrationEvent) => PubSub.publish(domainEvents, event),
    publishMerge: (merge: PullRequestMergeEvent) => PubSub.publish(merges, merge),
    layer: AutomationScheduler.layer.pipe(Layer.provide(dependencies)),
  };
});

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

/** Runs `body` against a started scheduler; the parked roots unpark once `start()` returned. */
const withScheduler = <A, E>(
  harness: Harness,
  body: (
    scheduler: AutomationScheduler.AutomationScheduler["Service"],
  ) => Effect.Effect<A, E, never>,
) =>
  Effect.gen(function* () {
    const scheduler = yield* AutomationScheduler.AutomationScheduler;
    yield* scheduler.start();
    yield* Deferred.succeed(harness.activation, undefined);
    yield* scheduler.drain;
    return yield* body(scheduler);
  }).pipe(Effect.provide(harness.layer));

const commandsOfType = <T extends OrchestrationCommand["type"]>(
  commands: ReadonlyArray<OrchestrationCommand>,
  type: T,
) =>
  commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: T }> => command.type === type,
  );

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.scoped(TestClock.setTime(Date.parse(NOW)).pipe(Effect.andThen(body)));

describe("AutomationScheduler tick", () => {
  it.effect("requests one on-time run for a due schedule", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ nextRunAt: "2026-09-06T09:00:00.000Z" })],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const commands = yield* Ref.get(harness.commands);
        assert.strictEqual(commands.length, 1);
        const request = commandsOfType(commands, "automation.run.request")[0]!;
        assert.strictEqual(
          request.commandId,
          `server:automation-schedule:${AUTOMATION_ID}:2026-09-06T09:00:00.000Z`,
        );
        assert.deepStrictEqual(request.trigger, {
          type: "schedule",
          scheduledFor: "2026-09-06T09:00:00.000Z",
          catchUp: false,
        });
        assert.strictEqual(request.requestedAt, NOW);
      }),
    ),
  );

  it.effect("catches up a schedule that is hours late with exactly one request", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ nextRunAt: "2026-09-06T02:00:00.000Z" })],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
          // The projector would advance nextRunAt after the first request; a
          // second tick on the same row is what a restart looks like and it
          // must not add a second request (the decider rejects the same id).
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const requests = commandsOfType(yield* Ref.get(harness.commands), "automation.run.request");
        assert.strictEqual(requests.length, 2);
        assert.strictEqual(requests[0]!.commandId, requests[1]!.commandId);
        assert.deepStrictEqual(requests[0]!.trigger, {
          type: "schedule",
          scheduledFor: "2026-09-06T02:00:00.000Z",
          catchUp: true,
        });
      }),
    ),
  );

  it.effect("records a missed instant instead of catching up when catch-up is off", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [
            makeAutomation({ nextRunAt: "2026-09-06T02:00:00.000Z", catchUpMissedRuns: false }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["automation.run.missed"],
        );
        const missed = commandsOfType(commands, "automation.run.missed")[0]!;
        assert.strictEqual(missed.scheduledFor, "2026-09-06T02:00:00.000Z");
        assert.strictEqual(
          missed.commandId,
          `server:automation-missed:${AUTOMATION_ID}:2026-09-06T02:00:00.000Z`,
        );
      }),
    ),
  );

  it.effect("dispatches nothing when nothing is due, paused, or the host is suspended", () =>
    run(
      Effect.gen(function* () {
        const idle = yield* makeHarness({
          automations: [
            makeAutomation({ nextRunAt: "2026-09-06T10:00:00.000Z" }),
            makeAutomation({
              id: AutomationId.make("paused"),
              enabled: false,
              nextRunAt: "2026-09-06T08:00:00.000Z",
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(idle.layer));
        assert.deepStrictEqual(yield* Ref.get(idle.commands), []);

        const suspended = yield* makeHarness({
          suspended: true,
          automations: [
            makeAutomation({
              nextRunAt: "2026-09-06T08:00:00.000Z",
              activeRun: {
                runId: RUN_ID,
                threadId: THREAD_ID,
                requestedAt: "2026-09-06T04:00:00.000Z",
                startedAt: "2026-09-06T04:00:00.000Z",
              },
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(suspended.layer));
        assert.deepStrictEqual(yield* Ref.get(suspended.commands), []);
      }),
    ),
  );

  it.effect("keeps enforcing timeouts while automations are paused on the environment", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            automations: { ...DEFAULT_SERVER_SETTINGS.automations, enabled: false },
          },
          automations: [
            makeAutomation({
              nextRunAt: "2026-09-06T08:00:00.000Z",
              activeRun: {
                runId: RUN_ID,
                threadId: THREAD_ID,
                requestedAt: "2026-09-06T04:00:00.000Z",
                startedAt: "2026-09-06T04:00:00.000Z",
              },
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["automation.run.finished", "thread.turn.interrupt"],
        );
        const finished = commandsOfType(commands, "automation.run.finished")[0]!;
        assert.strictEqual(finished.status, "interrupted");
        assert.strictEqual(finished.error, "Timed out after 120 minutes");
        assert.strictEqual(finished.commandId, `server:automation-run-finished:${RUN_ID}`);
        assert.strictEqual(
          commandsOfType(commands, "thread.turn.interrupt")[0]!.threadId,
          THREAD_ID,
        );
      }),
    ),
  );

  it.effect("fails a request that never got a thread after two minutes", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [
            makeAutomation({
              activeRun: {
                runId: RUN_ID,
                threadId: null,
                requestedAt: "2026-09-06T08:57:00.000Z",
                startedAt: null,
              },
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const finished = commandsOfType(
          yield* Ref.get(harness.commands),
          "automation.run.finished",
        );
        assert.strictEqual(finished.length, 1);
        assert.strictEqual(finished[0]!.status, "failed");
        assert.match(finished[0]!.error ?? "", /never started/);
      }),
    ),
  );

  it.effect("sweeps a settled run thread the tracker missed and carries its summary", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [
            makeAutomation({
              activeRun: {
                runId: RUN_ID,
                threadId: THREAD_ID,
                requestedAt: "2026-09-06T08:00:00.000Z",
                startedAt: "2026-09-06T08:00:01.000Z",
              },
            }),
          ],
          threads: [
            makeThread(THREAD_ID, {
              automationRun: { automationId: AUTOMATION_ID, runId: RUN_ID },
              latestTurn: {
                turnId: TurnId.make("turn-1"),
                state: "completed",
                requestedAt: "2026-09-06T08:00:01.000Z",
                startedAt: "2026-09-06T08:00:02.000Z",
                completedAt: "2026-09-06T08:20:00.000Z",
                assistantMessageId: null,
              },
              session: makeSession("ready", null),
            }),
          ],
          messages: [
            {
              id: MessageId.make("m-1"),
              role: "assistant",
              text: "  Reviewed 3 commits, nothing to fix.  ",
              turnId: TurnId.make("turn-1"),
              streaming: false,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const finished = commandsOfType(
          yield* Ref.get(harness.commands),
          "automation.run.finished",
        );
        assert.strictEqual(finished.length, 1);
        assert.strictEqual(finished[0]!.status, "completed");
        assert.strictEqual(finished[0]!.summary, "Reviewed 3 commits, nothing to fix.");
      }),
    ),
  );

  it.effect("re-dispatches a pending trigger once the automation is idle", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [
            makeAutomation({
              pendingTrigger: { type: "webhook", deliveryId: "d-1", payload: null },
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(harness.layer));
        const requests = commandsOfType(yield* Ref.get(harness.commands), "automation.run.request");
        assert.strictEqual(requests.length, 1);
        assert.deepStrictEqual(requests[0]!.trigger, {
          type: "webhook",
          deliveryId: "d-1",
          payload: null,
        });
        assert.match(requests[0]!.commandId, /^server:automation-pending:/);
      }),
    ),
  );

  it.effect("parks a pending trigger while it would be rejected as paused or debounced", () =>
    run(
      Effect.gen(function* () {
        const pending = { type: "webhook", deliveryId: "d-1", payload: null } as const;
        const rejectWith = { type: "automation.run.request", detail: "rejected" } as const;
        const paused = yield* makeHarness({
          rejectWith,
          automations: [makeAutomation({ enabled: false, pendingTrigger: pending })],
        });
        const environmentPaused = yield* makeHarness({
          rejectWith,
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            automations: { ...DEFAULT_SERVER_SETTINGS.automations, enabled: false },
          },
          automations: [makeAutomation({ pendingTrigger: pending })],
        });
        const debounced = yield* makeHarness({
          rejectWith,
          automations: [
            makeAutomation({
              pendingTrigger: pending,
              minIntervalSeconds: 600,
              lastRequestedAt: "2026-09-06T08:55:00.000Z",
            }),
          ],
        });
        for (const harness of [paused, environmentPaused, debounced]) {
          yield* Effect.gen(function* () {
            const scheduler = yield* AutomationScheduler.AutomationScheduler;
            yield* scheduler.tickOnce;
          }).pipe(Effect.provide(harness.layer));
          assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
        }

        const elapsed = yield* makeHarness({
          automations: [
            makeAutomation({
              pendingTrigger: pending,
              minIntervalSeconds: 300,
              lastRequestedAt: "2026-09-06T08:55:00.000Z",
            }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.tickOnce;
        }).pipe(Effect.provide(elapsed.layer));
        assert.deepStrictEqual(
          (yield* Ref.get(elapsed.commands)).map((command) => command.type),
          ["automation.run.request"],
        );
      }),
    ),
  );
});

describe("AutomationScheduler executor", () => {
  const activeRequested = {
    runId: RUN_ID,
    threadId: null,
    requestedAt: NOW,
    startedAt: null,
  } as const;

  it.effect(
    "creates the thread, marks the run started, and starts the turn with the run block",
    () =>
      run(
        Effect.gen(function* () {
          const harness = yield* makeHarness({
            automations: [
              makeAutomation({
                activeRun: activeRequested,
                createPullRequest: true,
                includeLastRunSummary: true,
                lastRun: {
                  runId: AutomationRunId.make("run-0"),
                  status: "completed",
                  threadId: ThreadId.make("thread-run-0"),
                  requestedAt: "2026-09-05T07:00:00.000Z",
                  startedAt: "2026-09-05T07:00:01.000Z",
                  finishedAt: "2026-09-05T07:10:00.000Z",
                  error: null,
                  summary: "Yesterday: fixed the flaky test.",
                },
              }),
            ],
          });
          yield* withScheduler(harness, (scheduler) =>
            Effect.gen(function* () {
              yield* harness.publish(
                makeEvent(
                  "automation.run-requested",
                  { run: makeRun() },
                  { kind: "automation", id: AUTOMATION_ID },
                ),
              );
              yield* scheduler.drain;
            }),
          );
          const commands = yield* Ref.get(harness.commands);
          assert.deepStrictEqual(
            commands.map((command) => command.type),
            ["thread.create", "automation.run.started", "thread.turn.start"],
          );
          const create = commandsOfType(commands, "thread.create")[0]!;
          assert.strictEqual(create.title, "Nightly review · Sep 6, 11:00");
          assert.deepStrictEqual(create.automationRun, {
            automationId: AUTOMATION_ID,
            runId: RUN_ID,
          });
          assert.strictEqual(create.worktreePath, null);
          assert.deepStrictEqual(create.modelSelection, {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
          });
          const started = commandsOfType(commands, "automation.run.started")[0]!;
          assert.strictEqual(started.threadId, create.threadId);
          assert.strictEqual(started.commandId, `server:automation-run-started:${RUN_ID}`);
          const turn = commandsOfType(commands, "thread.turn.start")[0]!;
          assert.strictEqual(turn.threadId, create.threadId);
          assert.strictEqual(turn.titleSeed, undefined);
          assert.ok(turn.message.text.startsWith("Review yesterday's commits."));
          assert.ok(turn.message.text.includes(CREATE_PULL_REQUEST_OPEN_MARKER));
          assert.ok(turn.message.text.includes(AUTOMATION_RUN_OPEN_MARKER));
          assert.ok(turn.message.text.includes("Yesterday: fixed the flaky test."));
          assert.deepStrictEqual(yield* Ref.get(harness.setupCalls), []);
        }),
      ),
  );

  it.effect("prepares a worktree, runs the setup script, then starts the turn", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeRequested, workspace: "worktree" })],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "automation.run-requested",
                { run: makeRun() },
                { kind: "automation", id: AUTOMATION_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["thread.create", "automation.run.started", "thread.meta.update", "thread.turn.start"],
        );
        const meta = commandsOfType(commands, "thread.meta.update")[0]!;
        assert.strictEqual(meta.branch, "automation/nightly-review/20260906-0900");
        assert.strictEqual(
          meta.worktreePath,
          "/workspace/.worktrees/automation/nightly-review/20260906-0900",
        );
        assert.deepStrictEqual(yield* Ref.get(harness.gitCalls), [
          "fetch /workspace/project",
          "create automation/nightly-review/20260906-0900",
        ]);
        assert.deepStrictEqual(yield* Ref.get(harness.setupCalls), [meta.threadId]);
      }),
    ),
  );

  it.effect("fails the run and deletes the thread when the worktree cannot be created", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeRequested, workspace: "worktree" })],
          git: {
            createWorktree: () => Effect.die(new Error("disk full")),
          },
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "automation.run-requested",
                { run: makeRun() },
                { kind: "automation", id: AUTOMATION_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["thread.create", "automation.run.started", "automation.run.finished", "thread.delete"],
        );
        const finished = commandsOfType(commands, "automation.run.finished")[0]!;
        assert.strictEqual(finished.status, "failed");
        assert.strictEqual(finished.error, "disk full");
        assert.strictEqual(
          commandsOfType(commands, "thread.delete")[0]!.threadId,
          commandsOfType(commands, "thread.create")[0]!.threadId,
        );
      }),
    ),
  );

  it.effect("fails the run and deletes the thread when run.started is rejected", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeRequested })],
          rejectWith: { type: "automation.run.started", detail: "Run is no longer active." },
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "automation.run-requested",
                { run: makeRun() },
                { kind: "automation", id: AUTOMATION_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["thread.create", "automation.run.started", "automation.run.finished", "thread.delete"],
        );
        const finished = commandsOfType(commands, "automation.run.finished")[0]!;
        assert.strictEqual(finished.status, "failed");
        assert.include(finished.error, "Run is no longer active.");
        assert.strictEqual(
          commandsOfType(commands, "thread.delete")[0]!.threadId,
          commandsOfType(commands, "thread.create")[0]!.threadId,
        );
      }),
    ),
  );

  it.effect("ignores a request whose run already has a thread", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: { ...activeRequested, threadId: THREAD_ID } })],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "automation.run-requested",
                { run: makeRun() },
                { kind: "automation", id: AUTOMATION_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
      }),
    ),
  );
});

describe("AutomationScheduler completion tracker", () => {
  const activeStarted = {
    runId: RUN_ID,
    threadId: THREAD_ID,
    requestedAt: "2026-09-06T08:00:00.000Z",
    startedAt: "2026-09-06T08:00:01.000Z",
  } as const;
  const runThread = (overrides: Partial<OrchestrationThreadShell>) =>
    makeThread(THREAD_ID, {
      automationRun: { automationId: AUTOMATION_ID, runId: RUN_ID },
      ...overrides,
    });

  it.effect("finishes the run from the session-set that settles its turn", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeStarted })],
          threads: [runThread({})],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            // Settle the thread only now, after the activation tick swept it.
            yield* Ref.set(harness.threads, [
              runThread({
                latestTurn: {
                  turnId: TurnId.make("turn-1"),
                  state: "error",
                  requestedAt: "2026-09-06T08:00:01.000Z",
                  startedAt: "2026-09-06T08:00:02.000Z",
                  completedAt: NOW,
                  assistantMessageId: null,
                },
                session: makeSession("error", null, "Provider crashed"),
              }),
            ]);
            yield* harness.publish(
              sessionSetEvent(THREAD_ID, makeSession("error", null, "Provider crashed")),
            );
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["automation.run.finished"],
        );
        const finished = commandsOfType(commands, "automation.run.finished")[0]!;
        assert.strictEqual(finished.status, "failed");
        assert.strictEqual(finished.error, "Provider crashed");
      }),
    ),
  );

  it.effect("fails the run when the provider could not start the turn", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeStarted })],
          threads: [runThread({})],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "thread.activity-appended",
                {
                  threadId: THREAD_ID,
                  activity: {
                    id: EventId.make("activity-1"),
                    tone: "error",
                    kind: "provider.turn.start.failed",
                    summary: "Provider turn start failed",
                    payload: {},
                    turnId: null,
                    createdAt: NOW,
                  },
                },
                { kind: "thread", id: THREAD_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        const finished = commandsOfType(
          yield* Ref.get(harness.commands),
          "automation.run.finished",
        );
        assert.strictEqual(finished.length, 1);
        assert.strictEqual(finished[0]!.status, "failed");
        assert.strictEqual(finished[0]!.error, "Provider turn start failed");
      }),
    ),
  );

  it.effect("leaves a still-running run alone", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ activeRun: activeStarted })],
          threads: [
            runThread({
              latestTurn: {
                turnId: TurnId.make("turn-1"),
                state: "running",
                requestedAt: "2026-09-06T08:00:01.000Z",
                startedAt: "2026-09-06T08:00:02.000Z",
                completedAt: null,
                assistantMessageId: null,
              },
              session: makeSession("running", "turn-1"),
            }),
          ],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(sessionSetEvent(THREAD_ID, makeSession("running", "turn-1")));
            yield* scheduler.drain;
          }),
        );
        assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
      }),
    ),
  );
});

describe("AutomationScheduler after a run", () => {
  const runFinishedEvent = makeEvent(
    "automation.run-finished",
    {
      automationId: AUTOMATION_ID,
      runId: RUN_ID,
      status: "completed",
      finishedAt: NOW,
      error: null,
      summary: null,
    },
    { kind: "automation", id: AUTOMATION_ID },
  );

  it.effect("requests the coalesced trigger and trims run threads beyond the retention limit", () =>
    run(
      Effect.gen(function* () {
        const runThreads = Array.from({ length: AUTOMATION_KEEP_RUN_THREADS + 2 }, (_, index) =>
          makeThread(`run-thread-${String(index).padStart(2, "0")}`, {
            automationRun: {
              automationId: AUTOMATION_ID,
              runId: AutomationRunId.make(`run-${index}`),
            },
            createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            worktreePath: index === 0 ? "/workspace/.worktrees/oldest" : null,
          }),
        );
        const harness = yield* makeHarness({
          automations: [makeAutomation()],
          threads: [...runThreads, makeThread("ordinary-thread")],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            // Coalesce only now, after the activation tick, so the request
            // below is attributable to the run-finished handler.
            yield* Ref.set(harness.automations, [
              makeAutomation({
                pendingTrigger: { type: "git", branch: "main", fromCommit: "a", toCommit: "b" },
              }),
            ]);
            yield* harness.publish(runFinishedEvent);
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["automation.run.request", "thread.delete", "thread.delete"],
        );
        assert.deepStrictEqual(commandsOfType(commands, "automation.run.request")[0]!.trigger, {
          type: "git",
          branch: "main",
          fromCommit: "a",
          toCommit: "b",
        });
        assert.deepStrictEqual(
          commandsOfType(commands, "thread.delete").map((command) => command.threadId),
          [ThreadId.make("run-thread-01"), ThreadId.make("run-thread-00")],
        );
        assert.deepStrictEqual(yield* Ref.get(harness.gitCalls), [
          "remove /workspace/.worktrees/oldest",
        ]);
      }),
    ),
  );

  it.effect("keeps the coalesced trigger parked while the environment is paused", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            automations: { ...DEFAULT_SERVER_SETTINGS.automations, enabled: false },
          },
          rejectWith: { type: "automation.run.request", detail: "paused" },
          automations: [
            makeAutomation({
              pendingTrigger: { type: "webhook", deliveryId: "d-1", payload: null },
            }),
          ],
        });
        yield* withScheduler(harness, (scheduler) =>
          harness.publish(runFinishedEvent).pipe(Effect.andThen(scheduler.drain)),
        );
        assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
      }),
    ),
  );

  it.effect("interrupts and deletes every run thread when the automation is deleted", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [],
          threads: [
            makeThread("run-live", {
              automationRun: { automationId: AUTOMATION_ID, runId: RUN_ID },
              session: makeSession("running", "turn-1"),
              worktreePath: "/workspace/.worktrees/live",
            }),
            makeThread("run-old", {
              automationRun: {
                automationId: AUTOMATION_ID,
                runId: AutomationRunId.make("run-0"),
              },
            }),
            makeThread("other-automation", {
              automationRun: {
                automationId: AutomationId.make("automation-2"),
                runId: AutomationRunId.make("run-x"),
              },
            }),
          ],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publish(
              makeEvent(
                "automation.deleted",
                { automationId: AUTOMATION_ID, projectId: PROJECT_ID, deletedAt: NOW },
                { kind: "automation", id: AUTOMATION_ID },
              ),
            );
            yield* scheduler.drain;
          }),
        );
        const commands = yield* Ref.get(harness.commands);
        assert.deepStrictEqual(
          commands.map((command) => command.type),
          ["thread.turn.interrupt", "thread.delete", "thread.delete"],
        );
        assert.deepStrictEqual(
          commandsOfType(commands, "thread.delete").map((command) => command.threadId),
          [ThreadId.make("run-live"), ThreadId.make("run-old")],
        );
        assert.deepStrictEqual(yield* Ref.get(harness.gitCalls), [
          "remove /workspace/.worktrees/live",
        ]);
      }),
    ),
  );
});

describe("AutomationScheduler event source", () => {
  const eventAutomation = makeAutomation({
    triggers: [
      { type: "event", event: "turn.completed" },
      { type: "event", event: "pull-request.merged" },
    ],
  });

  it.effect(
    "fires turn.completed for an ordinary thread's settled turn, never for run threads",
    () =>
      run(
        Effect.gen(function* () {
          const ordinary = ThreadId.make("ordinary");
          const harness = yield* makeHarness({
            automations: [eventAutomation],
            threads: [
              makeThread(ordinary),
              makeThread(THREAD_ID, {
                automationRun: {
                  automationId: AutomationId.make("automation-2"),
                  runId: AutomationRunId.make("run-x"),
                },
              }),
            ],
          });
          yield* withScheduler(harness, (scheduler) =>
            Effect.gen(function* () {
              yield* harness.publish(sessionSetEvent(THREAD_ID, makeSession("running", "turn-r")));
              yield* harness.publish(sessionSetEvent(THREAD_ID, makeSession("ready", null)));
              // A boot-time "ready" with no running turn behind it is not a settlement.
              yield* harness.publish(sessionSetEvent(ordinary, makeSession("ready", null)));
              yield* harness.publish(sessionSetEvent(ordinary, makeSession("running", "turn-1")));
              yield* harness.publish(sessionSetEvent(ordinary, makeSession("ready", null)));
              yield* harness.publish(sessionSetEvent(ordinary, makeSession("stopped", null)));
              yield* scheduler.drain;
            }),
          );
          const requests = commandsOfType(
            yield* Ref.get(harness.commands),
            "automation.run.request",
          );
          assert.strictEqual(requests.length, 1);
          assert.deepStrictEqual(requests[0]!.trigger, {
            type: "event",
            event: "turn.completed",
            threadId: ordinary,
          });
        }),
      ),
  );

  it.effect("fires pull-request.merged for the thread linked to the merged pull request", () =>
    run(
      Effect.gen(function* () {
        const linked = ThreadId.make("linked");
        const harness = yield* makeHarness({
          automations: [eventAutomation],
          threads: [
            makeThread(linked, {
              linkedPullRequest: {
                projectId: PROJECT_ID,
                repository: "Owner/Repo",
                number: 7,
                url: "https://github.com/Owner/Repo/pull/7",
              },
            }),
            // A run thread's own pull request never fires the event.
            makeThread("run-thread", {
              automationRun: { automationId: AUTOMATION_ID, runId: RUN_ID },
              linkedPullRequest: {
                projectId: PROJECT_ID,
                repository: "Owner/Repo",
                number: 8,
                url: "https://github.com/Owner/Repo/pull/8",
              },
            }),
          ],
        });
        yield* withScheduler(harness, (scheduler) =>
          Effect.gen(function* () {
            yield* harness.publishMerge({
              projectId: PROJECT_ID,
              repository: "owner/repo",
              number: 8,
              mergedAt: NOW,
            });
            yield* harness.publishMerge({
              projectId: PROJECT_ID,
              repository: "owner/repo",
              number: 7,
              mergedAt: NOW,
            });
            yield* scheduler.drain;
          }),
        );
        const requests = commandsOfType(yield* Ref.get(harness.commands), "automation.run.request");
        assert.strictEqual(requests.length, 1);
        assert.deepStrictEqual(requests[0]!.trigger, {
          type: "event",
          event: "pull-request.merged",
          threadId: linked,
        });
      }),
    ),
  );
});

describe("AutomationScheduler git source", () => {
  it.effect("baselines the remote branch silently and fires once per change", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [makeAutomation({ triggers: [{ type: "git", branch: null }] })],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.pollGitOnce;
          yield* scheduler.pollGitOnce;
          assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
          yield* Ref.set(harness.remoteCommit, "commit-b");
          yield* scheduler.pollGitOnce;
          yield* scheduler.pollGitOnce;
        }).pipe(Effect.provide(harness.layer));
        const requests = commandsOfType(yield* Ref.get(harness.commands), "automation.run.request");
        assert.strictEqual(requests.length, 1);
        assert.deepStrictEqual(requests[0]!.trigger, {
          type: "git",
          branch: "main",
          fromCommit: "commit-a",
          toCommit: "commit-b",
        });
        assert.deepStrictEqual(yield* Ref.get(harness.gitCalls), [
          "fetch /workspace/project",
          "fetch /workspace/project",
          "fetch /workspace/project",
          "fetch /workspace/project",
        ]);
      }),
    ),
  );

  it.effect("does not fetch when no enabled automation has a git trigger", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          automations: [
            makeAutomation({ enabled: false, triggers: [{ type: "git", branch: "main" }] }),
          ],
        });
        yield* Effect.gen(function* () {
          const scheduler = yield* AutomationScheduler.AutomationScheduler;
          yield* scheduler.pollGitOnce;
        }).pipe(Effect.provide(harness.layer));
        assert.deepStrictEqual(yield* Ref.get(harness.gitCalls), []);
      }),
    ),
  );
});
