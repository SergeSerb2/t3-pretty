import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  applyPendingThreadLifecycleToSnapshot,
  applyPendingThreadLifecycleToThread,
  asQueuedThreadLifecycleCommand,
  coalescePendingThreadLifecycleEntryBatch,
  coalescePendingThreadLifecycleEntries,
  makeThreadLifecycleOutbox,
  ThreadLifecycleOutboxPersistenceError,
  ThreadLifecycleOutboxStore,
  type PendingThreadLifecycleEntry,
} from "./threadLifecycleOutbox.ts";

function isolatedOutboxStore() {
  const memory = new Map<string, ReadonlyArray<PendingThreadLifecycleEntry>>();
  return ThreadLifecycleOutboxStore.of({
    load: (environmentId) => Effect.succeed(memory.get(environmentId) ?? []),
    save: (environmentId, entries) =>
      Effect.sync(() => {
        if (entries.length === 0) {
          memory.delete(environmentId);
        } else {
          memory.set(environmentId, entries);
        }
      }),
  });
}

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const SECOND_ENVIRONMENT_ID = EnvironmentId.make("environment-2");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");

const TARGET = new PrimaryConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const SECOND_TARGET = new PrimaryConnectionTarget({
  environmentId: SECOND_ENVIRONMENT_ID,
  label: "Second test environment",
  httpBaseUrl: "https://environment-two.example.test",
  wsBaseUrl: "wss://environment-two.example.test",
});

function entry(
  overrides: Partial<PendingThreadLifecycleEntry> & Pick<PendingThreadLifecycleEntry, "command">,
): PendingThreadLifecycleEntry {
  return {
    environmentId: ENVIRONMENT_ID,
    queuedAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeShell(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    enabledSkillIds: [],
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("queued thread lifecycle commands", () => {
  it("only parks settle, unsettle, snooze, and unsnooze", () => {
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.archive",
        commandId: CommandId.make("archive"),
        threadId: THREAD_ID,
      }),
    ).toBeNull();
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.settle",
        commandId: CommandId.make("settle"),
        threadId: THREAD_ID,
      }),
    ).toEqual({
      type: "thread.settle",
      commandId: "settle",
      threadId: THREAD_ID,
    });
  });

  it("replaces the same-domain command and lets settle drop a parked snooze", () => {
    const snooze = entry({
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-1"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-16T12:00:00.000Z",
      },
    });
    const laterSnooze = entry({
      queuedAt: "2026-08-15T13:00:00.000Z",
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-2"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-17T12:00:00.000Z",
      },
    });
    const settle = entry({
      queuedAt: "2026-08-15T14:00:00.000Z",
      command: {
        type: "thread.settle",
        commandId: CommandId.make("settle-1"),
        threadId: THREAD_ID,
      },
    });
    const otherThread = entry({
      command: {
        type: "thread.settle",
        commandId: CommandId.make("settle-other"),
        threadId: OTHER_THREAD_ID,
      },
    });

    expect(coalescePendingThreadLifecycleEntries([snooze, otherThread], laterSnooze)).toEqual([
      otherThread,
      laterSnooze,
    ]);
    expect(coalescePendingThreadLifecycleEntries([laterSnooze, otherThread], settle)).toEqual([
      otherThread,
      settle,
    ]);
  });

  it("coalesces a persisted batch in one pass without reviving a removed snooze", () => {
    const snooze = entry({
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-before-settle"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-16T12:00:00.000Z",
      },
    });
    const settle = entry({
      command: {
        type: "thread.settle",
        commandId: CommandId.make("settle-before-unsettle"),
        threadId: THREAD_ID,
      },
    });
    const unsettle = entry({
      command: {
        type: "thread.unsettle",
        commandId: CommandId.make("latest-unsettle"),
        threadId: THREAD_ID,
        reason: "user",
      },
    });

    expect(coalescePendingThreadLifecycleEntryBatch([snooze, settle, unsettle])).toEqual([
      unsettle,
    ]);

    let threadIdReads = 0;
    const manyThreads = Array.from({ length: 2_000 }, (_, index) => {
      const threadId = ThreadId.make(`thread-${index}`);
      const command = {
        type: "thread.settle" as const,
        commandId: CommandId.make(`settle-${index}`),
        threadId,
      };
      Object.defineProperty(command, "threadId", {
        get: () => {
          threadIdReads += 1;
          return threadId;
        },
      });
      return entry({ command });
    });

    expect(coalescePendingThreadLifecycleEntryBatch(manyThreads)).toHaveLength(manyThreads.length);
    expect(threadIdReads).toBe(manyThreads.length);
  });
});

describe("pending thread lifecycle overlay", () => {
  it("applies settle by parking the thread and clearing pin or snooze", () => {
    const overlayed = applyPendingThreadLifecycleToThread(
      makeShell({
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        snoozedUntil: "2026-08-16T12:00:00.000Z",
        snoozedAt: "2026-08-15T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.settle",
            commandId: CommandId.make("settle"),
            threadId: THREAD_ID,
          },
        }),
      ],
    );

    expect(overlayed.settledOverride).toBe("settled");
    expect(overlayed.settledAt).toBe("2026-08-15T12:00:00.000Z");
    expect(overlayed.pinnedAt).toBeNull();
    expect(overlayed.pinOrderKey).toBeNull();
    expect(overlayed.snoozedUntil).toBeNull();
    expect(overlayed.snoozedAt).toBeNull();
  });

  it("applies snooze and unsettle overlays in order", () => {
    const overlayed = applyPendingThreadLifecycleToThread(makeShell(), [
      entry({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("snooze"),
          threadId: THREAD_ID,
          snoozedUntil: "2026-08-16T09:00:00.000Z",
        },
      }),
      entry({
        queuedAt: "2026-08-15T13:00:00.000Z",
        command: {
          type: "thread.unsettle",
          commandId: CommandId.make("unsettle"),
          threadId: THREAD_ID,
          reason: "user",
        },
      }),
    ]);

    expect(overlayed.snoozedUntil).toBe("2026-08-16T09:00:00.000Z");
    expect(overlayed.settledOverride).toBe("active");
    expect(overlayed.settledAt).toBeNull();
  });

  it("leaves the snapshot identity unchanged when nothing is pending", () => {
    const snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 4,
      projects: [],
      threads: [makeShell()],
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    expect(applyPendingThreadLifecycleToSnapshot(snapshot, [])).toBe(snapshot);
  });

  it("indexes interleaved pending commands once while preserving per-thread order", () => {
    const untouched = makeShell({ id: ThreadId.make("thread-3"), title: "Untouched" });
    const snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 4,
      projects: [],
      threads: [makeShell(), makeShell({ id: OTHER_THREAD_ID, title: "Other" }), untouched],
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const entries = [
      entry({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("snooze"),
          threadId: THREAD_ID,
          snoozedUntil: "2026-08-16T09:00:00.000Z",
        },
      }),
      entry({
        queuedAt: "2026-08-15T12:30:00.000Z",
        command: {
          type: "thread.settle",
          commandId: CommandId.make("settle-other"),
          threadId: OTHER_THREAD_ID,
        },
      }),
      entry({
        queuedAt: "2026-08-15T13:00:00.000Z",
        command: {
          type: "thread.unsettle",
          commandId: CommandId.make("unsettle"),
          threadId: THREAD_ID,
          reason: "user",
        },
      }),
    ];
    let iteratorReads = 0;
    const instrumented = new Proxy(entries, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) iteratorReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const overlayed = applyPendingThreadLifecycleToSnapshot(snapshot, instrumented);

    expect(iteratorReads).toBe(1);
    expect(overlayed.threads[0]).toMatchObject({
      snoozedUntil: "2026-08-16T09:00:00.000Z",
      settledOverride: "active",
      updatedAt: "2026-08-15T13:00:00.000Z",
    });
    expect(overlayed.threads[1]).toMatchObject({
      settledOverride: "settled",
      updatedAt: "2026-08-15T12:30:00.000Z",
    });
    expect(overlayed.threads[2]).toBe(untouched);
  });
});

describe("ThreadLifecycleOutbox", () => {
  it.effect("does not lose stored commands when the first enqueue races initial loading", () =>
    Effect.gen(function* () {
      const loadStarted = yield* Deferred.make<void>();
      const releaseInitialLoad = yield* Deferred.make<void>();
      let loadCount = 0;
      const stored = entry({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("stored-settle"),
          threadId: THREAD_ID,
        },
      });
      const store = ThreadLifecycleOutboxStore.of({
        load: () =>
          Effect.suspend(() => {
            loadCount += 1;
            return loadCount === 1
              ? Deferred.succeed(loadStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseInitialLoad)),
                  Effect.as([stored]),
                )
              : Effect.succeed([]);
          }),
        save: () => Effect.void,
      });
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox().pipe(
        Effect.provideService(ThreadLifecycleOutboxStore, store),
      );

      const watcher = yield* outbox
        .watchAndDrain(supervisor)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(loadStarted);
      const enqueue = yield* outbox
        .enqueue(ENVIRONMENT_ID, {
          type: "thread.settle",
          commandId: CommandId.make("new-settle"),
          threadId: OTHER_THREAD_ID,
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseInitialLoad, undefined);
      expect(yield* Fiber.join(enqueue)).toBe(true);
      yield* Fiber.interrupt(watcher);

      expect(loadCount).toBe(1);
      expect(
        (yield* SubscriptionRef.get(outbox.pending))
          .get(ENVIRONMENT_ID)
          ?.map((pending) => pending.command.commandId),
      ).toEqual(["stored-settle", "new-settle"]);
    }),
  );

  it.effect("does not block another environment behind a stalled initial load", () =>
    Effect.gen(function* () {
      const slowLoadStarted = yield* Deferred.make<void>();
      const releaseSlowLoad = yield* Deferred.make<void>();
      const store = ThreadLifecycleOutboxStore.of({
        load: (environmentId) =>
          environmentId === ENVIRONMENT_ID
            ? Deferred.succeed(slowLoadStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseSlowLoad)),
                Effect.as([]),
              )
            : Effect.succeed([]),
        save: () => Effect.void,
      });
      const outbox = yield* makeThreadLifecycleOutbox().pipe(
        Effect.provideService(ThreadLifecycleOutboxStore, store),
      );

      const slowEnqueue = yield* outbox
        .enqueue(ENVIRONMENT_ID, {
          type: "thread.settle",
          commandId: CommandId.make("slow-load-settle"),
          threadId: THREAD_ID,
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(slowLoadStarted);
      const fastEnqueue = yield* outbox
        .enqueue(SECOND_ENVIRONMENT_ID, {
          type: "thread.settle",
          commandId: CommandId.make("independent-settle"),
          threadId: OTHER_THREAD_ID,
        })
        .pipe(Effect.forkChild({ startImmediately: true }));

      expect(yield* Fiber.join(fastEnqueue)).toBe(true);
      yield* Deferred.succeed(releaseSlowLoad, undefined);
      expect(yield* Fiber.join(slowEnqueue)).toBe(true);
    }),
  );

  it.effect("merges in-memory commands after a transient initial load failure", () =>
    Effect.gen(function* () {
      let loadCount = 0;
      let saveCount = 0;
      const persisted = yield* Deferred.make<ReadonlyArray<PendingThreadLifecycleEntry>>();
      const stored = entry({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("stored-before-failure"),
          threadId: THREAD_ID,
        },
      });
      const store = ThreadLifecycleOutboxStore.of({
        load: () =>
          Effect.suspend(() => {
            loadCount += 1;
            return loadCount === 1
              ? Effect.fail(
                  new ThreadLifecycleOutboxPersistenceError({
                    operation: "load",
                    message: "temporary read failure",
                  }),
                )
              : Effect.succeed([stored]);
          }),
        save: (_environmentId, entries) =>
          Effect.sync(() => {
            saveCount += 1;
          }).pipe(Effect.andThen(Deferred.succeed(persisted, entries)), Effect.asVoid),
      });
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox().pipe(
        Effect.provideService(ThreadLifecycleOutboxStore, store),
      );

      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("queued-during-failure"),
        threadId: OTHER_THREAD_ID,
      });
      expect(saveCount).toBe(0);

      const watcher = yield* outbox
        .watchAndDrain(supervisor)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const merged = yield* Deferred.await(persisted);
      yield* Fiber.interrupt(watcher);

      expect(loadCount).toBe(2);
      expect(saveCount).toBe(1);
      expect(merged.map((pending) => pending.command.commandId)).toEqual([
        "stored-before-failure",
        "queued-during-failure",
      ]);
    }),
  );

  it.effect("drains different environments independently", () =>
    Effect.gen(function* () {
      const slowDispatchStarted = yield* Deferred.make<void>();
      const releaseSlowDispatch = yield* Deferred.make<void>();
      const fastDispatchFinished = yield* Deferred.make<void>();
      const sessionFor = (dispatch: Effect.Effect<void>): RpcSession => ({
        client: {
          [ORCHESTRATION_WS_METHODS.dispatchCommand]: () =>
            dispatch.pipe(Effect.as({ sequence: 1 })),
        } as unknown as WsRpcProtocolClient,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      });
      const supervisorFor = Effect.fn("TestThreadLifecycleOutbox.supervisorFor")(function* (
        target: PrimaryConnectionTarget,
        session: RpcSession,
      ) {
        return EnvironmentSupervisor.EnvironmentSupervisor.of({
          target,
          state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.some(session)),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      });
      const slowSupervisor = yield* supervisorFor(
        TARGET,
        sessionFor(
          Deferred.succeed(slowDispatchStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSlowDispatch)),
          ),
        ),
      );
      const fastSupervisor = yield* supervisorFor(
        SECOND_TARGET,
        sessionFor(Deferred.succeed(fastDispatchFinished, undefined).pipe(Effect.asVoid)),
      );
      const outbox = yield* makeThreadLifecycleOutbox();
      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("slow-settle"),
        threadId: THREAD_ID,
      });
      yield* outbox.enqueue(SECOND_ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("fast-settle"),
        threadId: THREAD_ID,
      });

      const slowWatcher = yield* outbox
        .watchAndDrain(slowSupervisor)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(slowDispatchStarted);
      const fastPendingCleared = yield* SubscriptionRef.changes(outbox.pending).pipe(
        Stream.filter((pending) => !pending.has(SECOND_ENVIRONMENT_ID)),
        Stream.runHead,
        Effect.forkChild({ startImmediately: true }),
      );
      const fastWatcher = yield* outbox
        .watchAndDrain(fastSupervisor)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(fastDispatchFinished);
      yield* Fiber.join(fastPendingCleared);
      yield* Deferred.succeed(releaseSlowDispatch, undefined);
      yield* Fiber.interrupt(fastWatcher);
      yield* Fiber.interrupt(slowWatcher);

      expect(
        (yield* SubscriptionRef.get(outbox.pending)).get(SECOND_ENVIRONMENT_ID),
      ).toBeUndefined();
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );

  it.effect("dispatches parked commands once the environment session is back", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const delivered = yield* Deferred.make<void>();
      const client = {
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
          Effect.gen(function* () {
            dispatched.push(command);
            yield* Deferred.succeed(delivered, undefined);
            return { sequence: dispatched.length };
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession = {
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox();

      const queued = yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("settle-offline"),
        threadId: THREAD_ID,
      });
      expect(queued).toBe(true);
      expect(dispatched).toEqual([]);

      const drain = yield* outbox.watchAndDrain(supervisor).pipe(Effect.forkChild);
      yield* SubscriptionRef.set(supervisor.session, Option.some(session));
      yield* Deferred.await(delivered);
      yield* Fiber.interrupt(drain);

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-offline",
          threadId: THREAD_ID,
        },
      ]);
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );

  it.effect("drops a parked command the server rejects and keeps going", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const finished = yield* Deferred.make<void>();
      const client = {
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
          Effect.gen(function* () {
            dispatched.push(command);
            if (command.type === "thread.snooze") {
              return yield* new OrchestrationDispatchCommandError({
                message: "wake time is not in the future",
              });
            }
            yield* Deferred.succeed(finished, undefined);
            return { sequence: dispatched.length };
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession = {
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session)),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox();

      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-expired"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-14T12:00:00.000Z",
      });
      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("settle-after"),
        threadId: OTHER_THREAD_ID,
      });

      const drain = yield* outbox.watchAndDrain(supervisor).pipe(Effect.forkChild);
      yield* Deferred.await(finished);
      yield* Fiber.interrupt(drain);

      expect(dispatched.map((command) => command.type)).toEqual(["thread.snooze", "thread.settle"]);
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );
});
