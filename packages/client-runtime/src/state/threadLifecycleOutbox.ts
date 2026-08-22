import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  type ClientOrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import {
  EMPTY_THREAD_LIFECYCLE_PENDING,
  type PendingThreadLifecycleEntry,
  type QueuedThreadLifecycleCommand,
  type ThreadLifecyclePendingByEnvironment,
  threadLifecycleDomain,
} from "./threadLifecycleOutboxModel.ts";
import { ThreadLifecycleOutboxStore } from "./threadLifecycleOutboxStore.ts";

export {
  EMPTY_THREAD_LIFECYCLE_PENDING,
  type PendingThreadLifecycleEntry,
  type QueuedThreadLifecycleCommand,
  type ThreadLifecycleDomain,
  type ThreadLifecyclePendingByEnvironment,
  threadLifecycleDomain,
} from "./threadLifecycleOutboxModel.ts";
export {
  decodeStoredPendingEntries,
  encodePendingEntries,
  ThreadLifecycleOutboxPersistenceError,
  ThreadLifecycleOutboxStore,
} from "./threadLifecycleOutboxStore.ts";

export const QUEUED_THREAD_LIFECYCLE_DISPATCH_RESULT = { sequence: 0 } as const;

export function asQueuedThreadLifecycleCommand(
  command: ClientOrchestrationCommand,
): QueuedThreadLifecycleCommand | null {
  switch (command.type) {
    case "thread.settle":
      return {
        type: "thread.settle",
        commandId: command.commandId,
        threadId: command.threadId,
      };
    case "thread.unsettle":
      return {
        type: "thread.unsettle",
        commandId: command.commandId,
        threadId: command.threadId,
        reason: command.reason,
      };
    case "thread.snooze":
      return {
        type: "thread.snooze",
        commandId: command.commandId,
        threadId: command.threadId,
        snoozedUntil: command.snoozedUntil,
      };
    case "thread.unsnooze":
      return {
        type: "thread.unsnooze",
        commandId: command.commandId,
        threadId: command.threadId,
        reason: command.reason,
      };
    default:
      return null;
  }
}

export function coalescePendingThreadLifecycleEntries(
  existing: ReadonlyArray<PendingThreadLifecycleEntry>,
  next: PendingThreadLifecycleEntry,
): ReadonlyArray<PendingThreadLifecycleEntry> {
  const nextDomain = threadLifecycleDomain(next.command.type);
  const kept = existing.filter((entry) => {
    if (entry.command.threadId !== next.command.threadId) {
      return true;
    }
    if (threadLifecycleDomain(entry.command.type) === nextDomain) {
      return false;
    }
    // Settling unsnoozes on the server, so a later settle replaces a parked snooze.
    return !(
      next.command.type === "thread.settle" &&
      threadLifecycleDomain(entry.command.type) === "snooze"
    );
  });
  return [...kept, next];
}

export function applyPendingThreadLifecycleToThread<
  T extends Pick<
    OrchestrationThreadShell,
    | "id"
    | "settledOverride"
    | "settledAt"
    | "snoozedUntil"
    | "snoozedAt"
    | "pinnedAt"
    | "pinOrderKey"
    | "updatedAt"
  >,
>(thread: T, pending: ReadonlyArray<PendingThreadLifecycleEntry>): T {
  let next = thread;
  for (const entry of pending) {
    if (entry.command.threadId !== thread.id) {
      continue;
    }
    next = applyQueuedThreadLifecycleCommand(next, entry);
  }
  return next;
}

function applyQueuedThreadLifecycleCommand<
  T extends Pick<
    OrchestrationThreadShell,
    | "id"
    | "settledOverride"
    | "settledAt"
    | "snoozedUntil"
    | "snoozedAt"
    | "pinnedAt"
    | "pinOrderKey"
    | "updatedAt"
  >,
>(thread: T, entry: PendingThreadLifecycleEntry): T {
  switch (entry.command.type) {
    case "thread.settle":
      return {
        ...thread,
        settledOverride: "settled" as const,
        settledAt: entry.queuedAt,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        updatedAt: entry.queuedAt,
      };
    case "thread.unsettle":
      return {
        ...thread,
        settledOverride: "active" as const,
        settledAt: null,
        updatedAt: entry.queuedAt,
      };
    case "thread.snooze":
      return {
        ...thread,
        snoozedUntil: entry.command.snoozedUntil,
        snoozedAt: entry.queuedAt,
        updatedAt: entry.queuedAt,
      };
    case "thread.unsnooze":
      return {
        ...thread,
        snoozedUntil: null,
        snoozedAt: null,
        updatedAt: entry.queuedAt,
      };
  }
}

export function applyPendingThreadLifecycleToSnapshot(
  snapshot: OrchestrationShellSnapshot,
  pending: ReadonlyArray<PendingThreadLifecycleEntry>,
): OrchestrationShellSnapshot {
  if (pending.length === 0) {
    return snapshot;
  }
  let changed = false;
  const threads = snapshot.threads.map((thread) => {
    const next = applyPendingThreadLifecycleToThread(thread, pending);
    if (next !== thread) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...snapshot, threads } : snapshot;
}

export class ThreadLifecycleOutbox extends Context.Service<
  ThreadLifecycleOutbox,
  {
    readonly pending: SubscriptionRef.SubscriptionRef<ThreadLifecyclePendingByEnvironment>;
    readonly enqueue: (
      environmentId: EnvironmentId,
      command: ClientOrchestrationCommand,
    ) => Effect.Effect<boolean>;
    readonly watchAndDrain: (supervisor: EnvironmentSupervisor["Service"]) => Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/state/threadLifecycleOutbox") {}

export const makeThreadLifecycleOutbox = Effect.fn("ThreadLifecycleOutbox.make")(function* () {
  const store = yield* ThreadLifecycleOutboxStore;
  const pending = yield* SubscriptionRef.make<ThreadLifecyclePendingByEnvironment>(
    EMPTY_THREAD_LIFECYCLE_PENDING,
  );
  const loaded = yield* Effect.sync(() => new Set<EnvironmentId>());
  const lock = yield* Semaphore.make(1);
  const drainLock = yield* Semaphore.make(1);

  const persist = Effect.fn("ThreadLifecycleOutbox.persist")(function* (
    environmentId: EnvironmentId,
    entries: ReadonlyArray<PendingThreadLifecycleEntry>,
  ) {
    yield* store.save(environmentId, entries).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist queued thread lifecycle commands.").pipe(
          Effect.annotateLogs({
            environmentId,
            ...safeErrorLogAttributes(error),
          }),
        ),
      ),
    );
  });

  const ensureLoaded = Effect.fn("ThreadLifecycleOutbox.ensureLoaded")(function* (
    environmentId: EnvironmentId,
  ) {
    if (loaded.has(environmentId)) {
      return;
    }
    const stored = yield* store.load(environmentId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not load queued thread lifecycle commands.").pipe(
          Effect.annotateLogs({
            environmentId,
            ...safeErrorLogAttributes(error),
          }),
          Effect.as<ReadonlyArray<PendingThreadLifecycleEntry>>([]),
        ),
      ),
    );
    loaded.add(environmentId);
    if (stored.length === 0) {
      return;
    }
    yield* SubscriptionRef.update(pending, (current) => {
      if ((current.get(environmentId)?.length ?? 0) > 0) {
        return current;
      }
      const next = new Map(current);
      next.set(environmentId, stored);
      return next;
    });
  });

  const entriesFor = (current: ThreadLifecyclePendingByEnvironment, environmentId: EnvironmentId) =>
    current.get(environmentId) ?? [];

  const setEntries = Effect.fn("ThreadLifecycleOutbox.setEntries")(function* (
    environmentId: EnvironmentId,
    entries: ReadonlyArray<PendingThreadLifecycleEntry>,
  ) {
    yield* SubscriptionRef.update(pending, (current) => {
      const previous = entriesFor(current, environmentId);
      if (previous === entries || (previous.length === 0 && entries.length === 0)) {
        return current;
      }
      const next = new Map(current);
      if (entries.length === 0) {
        next.delete(environmentId);
      } else {
        next.set(environmentId, entries);
      }
      return next;
    });
    yield* persist(environmentId, entries);
  });

  const enqueue = Effect.fn("ThreadLifecycleOutbox.enqueue")(function* (
    environmentId: EnvironmentId,
    command: ClientOrchestrationCommand,
  ) {
    const queued = asQueuedThreadLifecycleCommand(command);
    if (queued === null) {
      return false;
    }
    const queuedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* ensureLoaded(environmentId);
        const current = entriesFor(yield* SubscriptionRef.get(pending), environmentId);
        yield* setEntries(
          environmentId,
          coalescePendingThreadLifecycleEntries(current, {
            environmentId,
            queuedAt,
            command: queued,
          }),
        );
      }),
    );
    return true;
  });

  const drain = Effect.fn("ThreadLifecycleOutbox.drain")(function* (
    supervisor: EnvironmentSupervisor["Service"],
  ) {
    const environmentId = supervisor.target.environmentId;
    yield* drainLock.withPermits(1)(
      Effect.gen(function* () {
        yield* ensureLoaded(environmentId);
        const queued = entriesFor(yield* SubscriptionRef.get(pending), environmentId);
        if (queued.length === 0) {
          return;
        }
        for (const entry of queued) {
          const session = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(session)) {
            return;
          }
          const result = yield* session.value.client[ORCHESTRATION_WS_METHODS.dispatchCommand](
            entry.command,
          ).pipe(Effect.result);
          if (Result.isSuccess(result)) {
            yield* removeEntry(environmentId, entry.command.commandId);
            continue;
          }
          // The server rejected the parked command (wake time already passed,
          // thread gone, invariants). Drop it so the live snapshot wins.
          if (result.failure._tag === "OrchestrationDispatchCommandError") {
            yield* Effect.logWarning(
              "Dropped a queued thread lifecycle command the server rejected.",
              {
                environmentId,
                threadId: entry.command.threadId,
                commandType: entry.command.type,
                message: result.failure.message,
              },
            );
            yield* removeEntry(environmentId, entry.command.commandId);
            continue;
          }
          return;
        }
      }),
    );
  });

  const removeEntry = Effect.fn("ThreadLifecycleOutbox.removeEntry")(function* (
    environmentId: EnvironmentId,
    commandId: CommandId,
  ) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = entriesFor(yield* SubscriptionRef.get(pending), environmentId);
        yield* setEntries(
          environmentId,
          current.filter((entry) => entry.command.commandId !== commandId),
        );
      }),
    );
  });

  const watchAndDrain = Effect.fn("ThreadLifecycleOutbox.watchAndDrain")(function* (
    supervisor: EnvironmentSupervisor["Service"],
  ) {
    const environmentId = supervisor.target.environmentId;
    yield* ensureLoaded(environmentId);
    yield* Stream.merge(
      SubscriptionRef.changes(supervisor.session).pipe(Stream.map(() => "session" as const)),
      SubscriptionRef.changes(pending).pipe(Stream.map(() => "pending" as const)),
    ).pipe(
      Stream.runForEach(() =>
        SubscriptionRef.get(supervisor.session).pipe(
          Effect.flatMap((session) => (Option.isSome(session) ? drain(supervisor) : Effect.void)),
        ),
      ),
    );
  });

  return ThreadLifecycleOutbox.of({
    pending,
    enqueue,
    watchAndDrain,
  });
});

export const threadLifecycleOutboxLayer = Layer.effect(
  ThreadLifecycleOutbox,
  makeThreadLifecycleOutbox(),
);

export function createThreadLifecyclePendingValueAtom<R, E>(
  runtime: Atom.AtomRuntime<ThreadLifecycleOutbox | R, E>,
) {
  const pendingAtom = runtime
    .atom(
      Stream.unwrap(
        ThreadLifecycleOutbox.pipe(Effect.map((outbox) => SubscriptionRef.changes(outbox.pending))),
      ),
      { initialValue: EMPTY_THREAD_LIFECYCLE_PENDING },
    )
    .pipe(Atom.keepAlive, Atom.withLabel("thread-lifecycle-outbox:pending"));

  return Atom.make(
    (get): ThreadLifecyclePendingByEnvironment =>
      Option.getOrElse(AsyncResult.value(get(pendingAtom)), () => EMPTY_THREAD_LIFECYCLE_PENDING),
  ).pipe(Atom.withLabel("thread-lifecycle-outbox:pending-value"));
}
