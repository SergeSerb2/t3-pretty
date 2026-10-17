import type { EnvironmentThreadShell as OrchestrationThreadShell } from "./models.ts";
import { presentThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
type OrchestrationShellSnapshot = {
  readonly snapshotSequence: number;
  readonly projects: readonly [];
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly automations?: readonly [];
  readonly updatedAt: string;
};
import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2DispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
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
  encodePendingEntries,
  makeThreadLifecycleOutbox,
  ThreadLifecycleOutboxPersistenceError,
  ThreadLifecycleOutboxStore,
  type PendingThreadLifecycleEntry,
} from "./threadLifecycleOutbox.ts";
import {
  THREAD_LIFECYCLE_OUTBOX_MAX_ENTRIES,
  THREAD_LIFECYCLE_OUTBOX_MAX_JSON_LENGTH,
} from "./threadLifecycleOutboxModel.ts";

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
    ...presentThreadShell(ENVIRONMENT_ID, v2ThreadShell),
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
    pullRequests: [],
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
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("queued thread lifecycle commands", () => {
  it("parks settle, snooze, pin, and reorder — not archive", () => {
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
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.pin",
        commandId: CommandId.make("pin"),
        threadId: THREAD_ID,
        orderKey: "a0",
      }),
    ).toEqual({
      type: "thread.pin",
      commandId: "pin",
      threadId: THREAD_ID,
      orderKey: "a0",
    });
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.pin.reorder",
        commandId: CommandId.make("pin-reorder"),
        threadId: THREAD_ID,
        orderKey: "a1",
      }),
    ).toEqual({
      type: "thread.pin.reorder",
      commandId: "pin-reorder",
      threadId: THREAD_ID,
      orderKey: "a1",
    });
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.active.reorder",
        commandId: CommandId.make("active-reorder"),
        threadId: THREAD_ID,
        orderKey: "mf",
      }),
    ).toEqual({
      type: "thread.active.reorder",
      commandId: "active-reorder",
      threadId: THREAD_ID,
      orderKey: "mf",
    });
  });

  it("preserves the effects of queued lifecycle transitions before their reverse", () => {
    const lifecycleEntry = (
      type:
        | "thread.settle"
        | "thread.unsettle"
        | "thread.pin"
        | "thread.unpin"
        | "thread.store"
        | "thread.unstore",
      index: number,
    ) => {
      const common = {
        commandId: CommandId.make(`transition-${index}`),
        threadId: THREAD_ID,
      };
      return entry({
        command:
          type === "thread.unsettle"
            ? { ...common, type, reason: "user" }
            : type === "thread.pin"
              ? { ...common, type, orderKey: `slot-${index}` }
              : { ...common, type },
      });
    };
    const sequences = [
      ["thread.settle", "thread.pin", "thread.unpin"],
      ["thread.settle", "thread.store", "thread.unstore"],
      ["thread.store", "thread.pin", "thread.unpin"],
      ["thread.settle", "thread.unsettle"],
      ["thread.unpin", "thread.pin"],
      ["thread.pin", "thread.pin"],
    ] as const;
    const initial = makeShell({
      snoozedUntil: "2026-08-16T12:00:00.000Z",
      snoozedAt: "2026-08-14T12:00:00.000Z",
      pinnedAt: "2026-08-14T12:00:00.000Z",
      pinOrderKey: "original-slot",
    });
    for (const sequence of sequences) {
      const entries = sequence.map(lifecycleEntry);
      const expected = applyPendingThreadLifecycleToThread(initial, entries);
      const incremental = entries.reduce<ReadonlyArray<PendingThreadLifecycleEntry>>(
        (pending, next) => coalescePendingThreadLifecycleEntries(pending, next),
        [],
      );
      expect(
        applyPendingThreadLifecycleToThread(initial, incremental),
        sequence.join(" → "),
      ).toEqual(expected);
      expect(
        applyPendingThreadLifecycleToThread(
          initial,
          coalescePendingThreadLifecycleEntryBatch(entries),
        ),
        sequence.join(" → "),
      ).toEqual(expected);
    }
  });
});

describe("pending thread lifecycle overlay", () => {
  it("applies settle by parking the thread and clearing pin or snooze", () => {
    const overlayed = applyPendingThreadLifecycleToThread(
      makeShell({
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        activeOrderKey: "previous-active-slot",
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
    expect(overlayed.activeOrderKey).toBeNull();
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

  it("applies store by parking the thread and unstore by returning it to active", () => {
    const stored = applyPendingThreadLifecycleToThread(
      makeShell({
        settledOverride: "settled",
        settledAt: "2026-08-14T00:00:00.000Z",
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        snoozedUntil: "2026-08-16T12:00:00.000Z",
        snoozedAt: "2026-08-15T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.store",
            commandId: CommandId.make("store"),
            threadId: THREAD_ID,
          },
        }),
      ],
    );
    expect(stored.storedAt).toBe("2026-08-15T12:00:00.000Z");
    expect(stored.settledOverride).toBe("active");
    expect(stored.pinnedAt).toBeNull();
    expect(stored.snoozedUntil).toBeNull();

    const unstored = applyPendingThreadLifecycleToThread(stored, [
      entry({
        queuedAt: "2026-08-15T13:00:00.000Z",
        command: {
          type: "thread.unstore",
          commandId: CommandId.make("unstore"),
          threadId: THREAD_ID,
        },
      }),
    ]);
    expect(unstored.storedAt).toBeNull();
    expect(unstored.settledOverride).toBe("active");

    // Settling a stored thread takes it out of storage, as on the server.
    const settled = applyPendingThreadLifecycleToThread(stored, [
      entry({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("settle"),
          threadId: THREAD_ID,
        },
      }),
    ]);
    expect(settled.storedAt).toBeNull();
    expect(settled.settledOverride).toBe("settled");
  });

  it("applies pin, unpin, and reorder overlays", () => {
    const pinned = applyPendingThreadLifecycleToThread(
      makeShell({
        settledOverride: "settled",
        settledAt: "2026-08-14T00:00:00.000Z",
        snoozedUntil: "2026-08-16T12:00:00.000Z",
        snoozedAt: "2026-08-15T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.pin",
            commandId: CommandId.make("pin"),
            threadId: THREAD_ID,
            orderKey: "a0",
          },
        }),
      ],
    );
    expect(pinned).toMatchObject({
      pinnedAt: "2026-08-15T12:00:00.000Z",
      pinOrderKey: "a0",
      settledOverride: "active",
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
    });

    const alreadyPinned = applyPendingThreadLifecycleToThread(
      makeShell({
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.pin",
            commandId: CommandId.make("pin-again"),
            threadId: THREAD_ID,
            orderKey: "zz",
          },
        }),
      ],
    );
    expect(alreadyPinned.pinOrderKey).toBe("a0");
    expect(alreadyPinned.updatedAt).toBe("2026-08-14T00:00:00.000Z");

    const unpinned = applyPendingThreadLifecycleToThread(pinned, [
      entry({
        queuedAt: "2026-08-15T13:00:00.000Z",
        command: {
          type: "thread.unpin",
          commandId: CommandId.make("unpin"),
          threadId: THREAD_ID,
        },
      }),
    ]);
    expect(unpinned.pinnedAt).toBeNull();
    expect(unpinned.pinOrderKey).toBeNull();

    const reordered = applyPendingThreadLifecycleToThread(
      makeShell({
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.pin.reorder",
            commandId: CommandId.make("pin-reorder"),
            threadId: THREAD_ID,
            orderKey: "b0",
          },
        }),
      ],
    );
    expect(reordered.pinOrderKey).toBe("b0");
    expect(reordered.updatedAt).toBe("2026-08-15T12:00:00.000Z");

    const activeReordered = applyPendingThreadLifecycleToThread(
      makeShell({
        activeOrderKey: "a0",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.active.reorder",
            commandId: CommandId.make("active-reorder"),
            threadId: THREAD_ID,
            orderKey: "mf",
          },
        }),
      ],
    );
    expect(activeReordered.activeOrderKey).toBe("mf");
    expect(activeReordered.updatedAt).toBe("2026-08-14T00:00:00.000Z");
  });

  it("leaves the snapshot identity unchanged when nothing is pending", () => {
    const snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 4,
      projects: [],
      threads: [makeShell()],
      automations: [],
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
      automations: [],
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
  it.effect.each(["entries", "encoded size"] as const)(
    "rejects an offline action at the %s limit without changing the saved queue",
    (limit) =>
      Effect.gen(function* () {
        let saved: ReadonlyArray<PendingThreadLifecycleEntry>;
        if (limit === "entries") {
          saved = Array.from({ length: THREAD_LIFECYCLE_OUTBOX_MAX_ENTRIES }, (_, index) =>
            entry({
              command: {
                type: "thread.settle",
                commandId: CommandId.make(`queued-${index}`),
                threadId: THREAD_ID,
              },
            }),
          );
        } else {
          const base = entry({
            command: {
              type: "thread.active.reorder",
              commandId: CommandId.make("large-order"),
              threadId: THREAD_ID,
              orderKey: "",
            },
          });
          saved = [
            {
              ...base,
              command: {
                ...base.command,
                type: "thread.active.reorder",
                orderKey: "x".repeat(
                  THREAD_LIFECYCLE_OUTBOX_MAX_JSON_LENGTH - JSON.stringify([base]).length,
                ),
              },
            },
          ];
        }
        yield* encodePendingEntries(saved);
        const original = saved;
        const store = ThreadLifecycleOutboxStore.of({
          load: () => Effect.succeed(saved),
          save: (_environmentId, entries) =>
            encodePendingEntries(entries).pipe(
              Effect.mapError(
                () =>
                  new ThreadLifecycleOutboxPersistenceError({
                    operation: "save",
                    message: "queue exceeds storage limits",
                  }),
              ),
              Effect.andThen(
                Effect.sync(() => {
                  saved = entries;
                }),
              ),
            ),
        });
        const outbox = yield* makeThreadLifecycleOutbox().pipe(
          Effect.provideService(ThreadLifecycleOutboxStore, store),
        );
        const result = yield* outbox
          .enqueue(ENVIRONMENT_ID, {
            type: "thread.unsettle",
            commandId: CommandId.make("overflow"),
            threadId: THREAD_ID,
            reason: "user",
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({
            _tag: "ThreadLifecycleOutboxPersistenceError",
            operation: "save",
          });
        }
        expect(saved).toBe(original);
        expect((yield* SubscriptionRef.get(outbox.pending)).get(ENVIRONMENT_ID)?.length).toBe(
          original.length,
        );
      }),
  );

  it.effect("rejects a failed save before publishing the new offline action", () =>
    Effect.gen(function* () {
      const saveStarted = yield* Deferred.make<void>();
      const releaseSave = yield* Deferred.make<void>();
      const failure = new ThreadLifecycleOutboxPersistenceError({
        operation: "save",
        message: "storage is full",
      });
      const outbox = yield* makeThreadLifecycleOutbox().pipe(
        Effect.provideService(ThreadLifecycleOutboxStore, {
          load: () => Effect.succeed([]),
          save: () =>
            Deferred.succeed(saveStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseSave)),
              Effect.andThen(Effect.fail(failure)),
            ),
        }),
      );
      const enqueuing = yield* outbox
        .enqueue(ENVIRONMENT_ID, {
          type: "thread.settle",
          commandId: CommandId.make("unpersisted"),
          threadId: THREAD_ID,
        })
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(saveStarted);
      expect((yield* SubscriptionRef.get(outbox.pending)).has(ENVIRONMENT_ID)).toBe(false);
      yield* Deferred.succeed(releaseSave, undefined);
      const result = yield* Fiber.join(enqueuing);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBe(failure);
      expect((yield* SubscriptionRef.get(outbox.pending)).has(ENVIRONMENT_ID)).toBe(false);
    }),
  );

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

  it.effect("rejects an initial load failure and preserves saved commands when retried", () =>
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
      const outbox = yield* makeThreadLifecycleOutbox().pipe(
        Effect.provideService(ThreadLifecycleOutboxStore, store),
      );

      const command = {
        type: "thread.settle",
        commandId: CommandId.make("queued-during-failure"),
        threadId: OTHER_THREAD_ID,
      } as const;
      const failed = yield* outbox.enqueue(ENVIRONMENT_ID, command).pipe(Effect.result);
      expect(Result.isFailure(failed)).toBe(true);
      if (Result.isFailure(failed)) {
        expect(failed.failure).toMatchObject({
          _tag: "ThreadLifecycleOutboxPersistenceError",
          operation: "load",
        });
      }
      expect(saveCount).toBe(0);
      expect((yield* SubscriptionRef.get(outbox.pending)).has(ENVIRONMENT_ID)).toBe(false);

      expect(yield* outbox.enqueue(ENVIRONMENT_ID, command)).toBe(true);
      const merged = yield* Deferred.await(persisted);

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
          [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: () =>
            dispatch.pipe(Effect.as({ sequence: 1 })),
        } as unknown as WsRpcProtocolClient,
        initialConfig: Effect.never,
        subscribeServerConfig: () => Stream.never,
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

  it.effect("replays parked transitions in order after reload and reconnect", () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationV2Command[] = [];
      const delivered = yield* Deferred.make<void>();
      const commands: ReadonlyArray<OrchestrationV2Command> = [
        {
          type: "thread.settle",
          commandId: CommandId.make("settle-offline"),
          threadId: THREAD_ID,
        },
        {
          type: "thread.pin",
          commandId: CommandId.make("pin-offline"),
          threadId: THREAD_ID,
        },
        {
          type: "thread.unpin",
          commandId: CommandId.make("unpin-offline"),
          threadId: THREAD_ID,
        },
      ];
      let replayed = makeShell();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: OrchestrationV2Command) =>
          Effect.gen(function* () {
            dispatched.push(command);
            const queued = asQueuedThreadLifecycleCommand(command);
            if (queued !== null) {
              replayed = applyPendingThreadLifecycleToThread(replayed, [
                entry({ command: queued }),
              ]);
            }
            if (dispatched.length === commands.length) {
              yield* Deferred.succeed(delivered, undefined);
            }
            return { sequence: dispatched.length };
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession = {
        client,
        initialConfig: Effect.never,
        subscribeServerConfig: () => Stream.never,
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
      const offlineOutbox = yield* makeThreadLifecycleOutbox();
      for (const command of commands) {
        expect(yield* offlineOutbox.enqueue(ENVIRONMENT_ID, command)).toBe(true);
      }
      expect(dispatched).toEqual([]);

      const outbox = yield* makeThreadLifecycleOutbox();
      const drain = yield* outbox.watchAndDrain(supervisor).pipe(Effect.forkChild);
      yield* SubscriptionRef.set(supervisor.session, Option.some(session));
      yield* Deferred.await(delivered);
      yield* Fiber.interrupt(drain);

      expect(dispatched).toEqual(commands);
      expect(replayed.settledOverride).toBe("active");
      expect(replayed.pinnedAt).toBeNull();
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );

  it.effect("drops a parked command the server rejects and keeps going", () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationV2Command[] = [];
      const finished = yield* Deferred.make<void>();
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: OrchestrationV2Command) =>
          Effect.gen(function* () {
            dispatched.push(command);
            if (command.type === "thread.snooze") {
              return yield* new OrchestrationV2DispatchCommandError({
                commandId: command.commandId,
                commandType: command.type,
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
        subscribeServerConfig: () => Stream.never,
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
