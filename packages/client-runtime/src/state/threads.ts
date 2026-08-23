import {
  ORCHESTRATION_WS_METHODS,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationThread,
  type OrchestrationThreadDetailPage,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { ThreadSnapshotLoader, type ThreadSnapshotWindow } from "./threadSnapshotHttp.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import { THREAD_STATE_IDLE_TTL_MS } from "./threadRetention.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadPageState,
  type EnvironmentThreadState,
  type EnvironmentThreadStatus,
} from "./threadState.ts";

function statusWithoutLiveData(data: Option.Option<OrchestrationThread>): EnvironmentThreadStatus {
  return Option.isSome(data) ? "cached" : "empty";
}

/**
 * Turn window sizes for paginated thread loads: the initial page covers the
 * last 10 user-anchored turns (subagent/fan-out turns ride along), each
 * "load earlier" tap fetches 20 more. Sized so first paint on the heaviest
 * observed threads stays around 100K gzipped while median threads load fully.
 */
export const INITIAL_THREAD_USER_TURN_LIMIT = 10;
export const OLDER_THREAD_PAGE_USER_TURN_LIMIT = 20;

/**
 * Streamed provider deltas arrive one WS event at a time; publishing each one
 * re-renders every thread subscriber per event. Arrivals are buffered and
 * folded through the reducer once per window — the same coalescing the server
 * applies to shell events (apps/server/src/ws.ts). The timer arms on the
 * first buffered item, so quiet periods cost nothing, and the window stays
 * under the UI's 64ms streaming-text cadence.
 */
const THREAD_STREAM_COALESCE_WINDOW = "50 millis" as const;

function pageStateFromSnapshot(
  page: OrchestrationThreadDetailPage | undefined,
): Option.Option<EnvironmentThreadPageState> {
  return page === undefined
    ? Option.none()
    : Option.some({
        beforeCursor: page.beforeCursor,
        hasMore: page.hasMore,
        loadingOlder: false,
      });
}

interface ThreadOlderTurnRequestRegistry {
  /**
   * Registers the live state machine for a thread. Returns the deregistration
   * cleanup; registration lives exactly as long as the machine's scope, and a
   * successor machine for the same thread simply replaces the entry.
   */
  readonly register: (key: string, handler: () => void) => () => void;
  readonly request: (key: string) => boolean;
}

function makeThreadOlderTurnRequestRegistry(): ThreadOlderTurnRequestRegistry {
  const handlers = new Map<string, () => void>();
  return {
    register: (key, handler) => {
      handlers.set(key, handler);
      return () => {
        if (handlers.get(key) === handler) {
          handlers.delete(key);
        }
      };
    },
    request: (key) => {
      const handler = handlers.get(key);
      if (handler === undefined) {
        return false;
      }
      handler();
      return true;
    },
  };
}

const defaultOlderTurnRequestRegistry = makeThreadOlderTurnRequestRegistry();

/**
 * Last-known state a closing thread machine leaves behind for its successor.
 * Unlike the persisted cache, this covers running threads too: reopening a
 * thread whose agent is mid-turn re-renders the already-loaded conversation
 * instantly and catches up via `afterSequence` instead of re-downloading.
 */
interface WarmThreadState {
  readonly thread: OrchestrationThread;
  readonly page: Option.Option<EnvironmentThreadPageState>;
  readonly lastSequence: number;
  /** Minted at machine start; a late equal-sequence write cannot rewind a successor. */
  readonly generation: number;
}

// ponytail: fixed-size LRU of full thread objects; make it byte-aware if
// giant threads ever show up in memory profiles. Tombstones live in their
// own LRU so live blobs cannot evict a delete, and deletes cannot grow
// without bound.
export const WARM_THREAD_STATE_CAPACITY = 32;

function lruSet<V>(map: Map<string, V>, key: string, value: V, capacity: number) {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= capacity) {
      break;
    }
    map.delete(oldest);
  }
}

interface WarmThreadStateRegistry {
  /** Copy without removing so overlapping machines can all restore. */
  readonly get: (key: string) => WarmThreadState | null;
  /**
   * Publish a handoff blob. A lower lastSequence, an equal lastSequence with
   * an older-or-equal generation, or a tombstoned key is ignored.
   */
  readonly set: (key: string, entry: WarmThreadState) => void;
  readonly remove: (key: string) => void;
  readonly nextGeneration: () => number;
}

export function makeWarmThreadStateRegistry(): WarmThreadStateRegistry {
  const entries = new Map<string, WarmThreadState>();
  const deleted = new Map<string, true>();
  let generation = 0;
  return {
    nextGeneration: () => {
      generation += 1;
      return generation;
    },
    get: (key) => (deleted.has(key) ? null : (entries.get(key) ?? null)),
    set: (key, entry) => {
      if (deleted.has(key)) {
        return;
      }
      const current = entries.get(key);
      if (current !== undefined) {
        if (entry.lastSequence < current.lastSequence) {
          return;
        }
        if (entry.lastSequence === current.lastSequence && entry.generation <= current.generation) {
          return;
        }
      }
      lruSet(entries, key, entry, WARM_THREAD_STATE_CAPACITY);
    },
    remove: (key) => {
      entries.delete(key);
      lruSet(deleted, key, true, WARM_THREAD_STATE_CAPACITY);
    },
  };
}

/**
 * In-memory handoff between successive per-thread state machines. Each
 * runtime layer gets its own registry; tests override with
 * `makeWarmThreadStateRegistry()`.
 */
export class WarmThreadStates extends Context.Service<WarmThreadStates, WarmThreadStateRegistry>()(
  "@t3tools/client-runtime/state/threads/WarmThreadStates",
) {}

export const warmThreadStatesLayer = Layer.sync(WarmThreadStates, makeWarmThreadStateRegistry);

/**
 * Channel from UI actions to the live per-thread state machines. The machines
 * resolve it from the Effect environment (overridable in tests); the default
 * instance is shared with the sync `requestOlderThreadTurns` entry point so
 * the apps get working wiring without providing anything.
 */
export class ThreadOlderTurnRequests extends Context.Reference<ThreadOlderTurnRequestRegistry>(
  "@t3tools/client-runtime/state/threads/ThreadOlderTurnRequests",
  { defaultValue: () => defaultOlderTurnRequestRegistry },
) {}

/**
 * Asks the live state machine for `threadId` to fetch the next older page.
 * Returns false when no machine is live or no fetch was started (no cursor,
 * already loading); callers render from `EnvironmentThreadState.page` and can
 * treat false as "nothing to do".
 */
export function requestOlderThreadTurns(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
): boolean {
  return defaultOlderTurnRequestRegistry.request(threadKey({ environmentId, threadId }));
}

function formatThreadError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize the thread.";
}

function shouldPersistThread(thread: OrchestrationThread): boolean {
  const status = thread.session?.status;
  return status !== "starting" && status !== "running";
}

export const makeEnvironmentThreadState = Effect.fn("EnvironmentThreadState.make")(function* (
  threadId: ThreadIdType,
) {
  const supervisor = yield* EnvironmentSupervisor;
  const cache = yield* EnvironmentCacheStore;
  const snapshotLoader = yield* ThreadSnapshotLoader;
  const environmentId = supervisor.target.environmentId;
  const warmStates = yield* WarmThreadStates;
  const stateKey = threadKey({ environmentId, threadId });
  const warmGeneration = warmStates.nextGeneration();
  // A predecessor machine's in-memory state beats the persisted cache: it is
  // newer and exists for running threads the cache deliberately skips. Peek,
  // don't take: overlapping machines (Strict Mode remount, environment swap
  // before the old finalizer) must all see the same blob.
  const warm = warmStates.get(stateKey);
  const cached =
    warm !== null
      ? Option.none<OrchestrationThreadDetailSnapshot>()
      : yield* cache.loadThread(environmentId, threadId).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not load cached thread.").pipe(
              Effect.annotateLogs({
                environmentId,
                threadId,
                error: error.message,
              }),
              Effect.as(Option.none<OrchestrationThreadDetailSnapshot>()),
            ),
          ),
        );
  const cachedThread =
    warm !== null ? Option.some(warm.thread) : Option.map(cached, (snapshot) => snapshot.thread);
  const state = yield* SubscriptionRef.make<EnvironmentThreadState>({
    data: cachedThread,
    status: statusWithoutLiveData(cachedThread),
    error: Option.none(),
    // A cached windowed snapshot restores its page cursor so "load earlier"
    // works while rendering from cache; a cached full snapshot has no page.
    // An older-page fetch in flight died with the predecessor's scope.
    page:
      warm !== null
        ? Option.map(warm.page, (page) => ({ ...page, loadingOlder: false }))
        : Option.flatMap(cached, (snapshot) => pageStateFromSnapshot(snapshot.page)),
  });
  // Seed the resume cursor from the cached snapshot so a warm cache can catch up
  // via `afterSequence` instead of re-downloading the full thread body.
  const lastSequence = yield* SubscriptionRef.make(
    warm !== null
      ? warm.lastSequence
      : Option.match(cached, { onNone: () => 0, onSome: (snapshot) => snapshot.snapshotSequence }),
  );
  const awaitingCompletion = yield* Ref.make(false);
  // Bumped whenever loaded history may have been rewritten out from under an
  // in-flight older-page fetch (snapshot replacement, revert, deletion). A
  // page response captured under an older epoch is discarded, not merged.
  const historyEpoch = yield* Ref.make(0);
  // Serializes stream-item application against older-page staleness checks +
  // merges. Without it, a revert or snapshot processed between loadOlderTurns'
  // epoch check and its merge could still slip resurrected history in.
  const applyLock = yield* Semaphore.make(1);
  // Whether the connected server accepts windowed reads; set per subscription
  // from the session config. Gates loadOlderTurns so a reconnect to a
  // pre-pagination server never sends unsupported window parameters.
  const paginationSupported = yield* Ref.make(false);
  // An older page whose thread watermark is ahead of the live state, parked
  // until the subscription catches up (see mergeOlderPage's caller). At most
  // one can exist because loadOlderTurns no-ops while loadingOlder is true.
  const pendingOlderPage = yield* Ref.make<{
    readonly snapshot: OrchestrationThreadDetailSnapshot;
    readonly epoch: number;
  } | null>(null);
  const persistence = yield* Queue.sliding<OrchestrationThreadDetailSnapshot>(1);

  const persist = Effect.fn("EnvironmentThreadState.persist")(function* (
    snapshot: OrchestrationThreadDetailSnapshot,
  ) {
    yield* cache.saveThread(environmentId, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist the thread cache.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  yield* Stream.fromQueue(persistence).pipe(
    Stream.debounce("500 millis"),
    Stream.runForEach(persist),
    Effect.forkScoped,
  );

  const setSynchronizing = SubscriptionRef.update(state, (current) =>
    current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live" || current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setDisconnected = Effect.gen(function* () {
    yield* Ref.set(awaitingCompletion, false);
    // The capability belongs to the session that advertised it. During a
    // reconnect, a new prepared connection can exist before the new session's
    // config arrives; leaving the old value would let loadOlderTurns send
    // window parameters to a server that may not accept them (review
    // finding). makeSubscribeInput re-sets it from the next session's config.
    yield* Ref.set(paginationSupported, false);
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
    }));
  });
  const publishStreamError = (cause: Cause.Cause<unknown>) =>
    Ref.set(awaitingCompletion, false).pipe(
      Effect.andThen(
        SubscriptionRef.update(state, (current) => ({
          ...current,
          status:
            current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
          error: Option.some(formatThreadError(cause)),
        })),
      ),
    );
  const setThread = Effect.fn("EnvironmentThreadState.setThread")(function* (
    thread: OrchestrationThread,
    // "keep" preserves the current page state (live events touch only loaded
    // recent turns); a snapshot or merged page passes its own page state.
    page: Option.Option<EnvironmentThreadPageState> | "keep",
  ) {
    const waiting = yield* Ref.get(awaitingCompletion);
    yield* SubscriptionRef.update(state, (current) => ({
      data: Option.some(thread),
      status: waiting ? ("synchronizing" as const) : ("live" as const),
      error: Option.none(),
      page: page === "keep" ? current.page : page,
    }));
    const snapshotSequence = yield* SubscriptionRef.get(lastSequence);
    const currentPage = page === "keep" ? (yield* SubscriptionRef.get(state)).page : page;
    // Keep a live copy so an overlapping successor can peek before this
    // scope finalizes (React remount, Strict Mode, environment swap).
    warmStates.set(stateKey, {
      thread,
      page: currentPage,
      lastSequence: snapshotSequence,
      generation: warmGeneration,
    });
    // Active threads can update many times per second and retain large tool
    // payloads. The server remains the source of truth while a turn is active;
    // persist once it settles so cache encoding stays off the streaming path.
    if (shouldPersistThread(thread)) {
      yield* Queue.offer(persistence, {
        snapshotSequence,
        thread,
        // Persist the window boundary with the window's content so a cache
        // restore can keep paging from where the loaded history ends.
        ...Option.match(currentPage, {
          onNone: () => ({}),
          onSome: (value) =>
            ({
              page: {
                beforeCursor: value.beforeCursor,
                hasMore: value.hasMore,
                snapshotSequence,
              },
            }) as const,
        }),
      });
    }
  });

  const setDeleted = Effect.fn("EnvironmentThreadState.setDeleted")(function* () {
    warmStates.remove(stateKey);
    yield* Ref.set(awaitingCompletion, false);
    yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
    yield* SubscriptionRef.set(state, {
      data: Option.none(),
      status: "deleted",
      error: Option.none(),
      page: Option.none(),
    });
    yield* cache.removeThread(environmentId, threadId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove the cached thread.").pipe(
          Effect.annotateLogs({
            environmentId,
            threadId,
            error: error.message,
          }),
        ),
      ),
    );
  });

  // Per-chunk fold state for streamed events. `working` mirrors the thread
  // data events apply to (null when there is none, or after a deletion);
  // `fresh` tracks whether `working` still matches the published state —
  // control items invalidate it so the next event run re-reads.
  interface EventFold {
    working: OrchestrationThread | null;
    fresh: boolean;
    dirty: boolean;
  }

  // Body of applyChunk, running under applyLock. Consecutive events fold into
  // the working copy and publish once per run; control items (snapshot,
  // synchronized) flush the run and apply immediately, preserving the
  // per-item ordering the stream delivered.
  const applyChunkLocked = Effect.fn("EnvironmentThreadState.applyChunkLocked")(function* (
    items: ReadonlyArray<OrchestrationThreadStreamItem>,
  ) {
    const fold: EventFold = { working: null, fresh: false, dirty: false };
    const flushEventRun = Effect.fn("EnvironmentThreadState.flushEventRun")(function* () {
      if (fold.dirty && fold.working !== null) {
        yield* setThread(fold.working, "keep");
      }
      fold.dirty = false;
      // The run may have advanced the live state past a parked page's
      // watermark; merge it as soon as that happens.
      yield* tryMergePendingOlderPage();
    });

    for (const item of items) {
      if (item.kind === "synchronized") {
        yield* flushEventRun();
        fold.fresh = false;
        yield* Ref.set(awaitingCompletion, false);
        yield* SubscriptionRef.update(state, (current) =>
          Option.isSome(current.data) && current.status !== "deleted"
            ? { ...current, status: "live" as const, error: Option.none() }
            : current,
        );
        continue;
      }

      if (item.kind === "snapshot") {
        yield* flushEventRun();
        fold.fresh = false;
        // A fresh snapshot replaces all loaded history, including older
        // pages: a turn reverted while disconnected would otherwise survive
        // in the preserved history with no event left to remove it. The
        // epoch bump discards any older-page fetch racing this snapshot.
        yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
        yield* SubscriptionRef.set(lastSequence, item.snapshot.snapshotSequence);
        yield* setThread(item.snapshot.thread, pageStateFromSnapshot(item.snapshot.page));
        continue;
      }

      if (!fold.fresh) {
        const current = yield* SubscriptionRef.get(state);
        fold.working = Option.getOrNull(current.data);
        fold.fresh = true;
        fold.dirty = false;
      }

      // Ephemeral items (live-only tool progress) have no sequence position:
      // apply them to the working copy without touching the resume cursor.
      if (item.ephemeral !== true) {
        const sequence = yield* SubscriptionRef.get(lastSequence);
        if (item.event.sequence <= sequence) {
          continue;
        }
        yield* SubscriptionRef.set(lastSequence, item.event.sequence);
      }

      if (fold.working === null) {
        if (item.event.type === "thread.deleted") {
          yield* setDeleted();
        }
        continue;
      }
      if (item.event.type === "thread.reverted") {
        // A revert rewrites loaded history (whole turns disappear), so an
        // older-page fetch in flight may straddle the removed range; the epoch
        // bump discards it. The stored page cursor stays valid: cursors are an
        // (anchor, turnId) keyset derived from event content, which survives
        // the revert projector's row rewrite, so no refresh is needed — the
        // revert reducer's turn filtering fully handles loaded history.
        yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
      }
      const result = applyThreadDetailEvent(fold.working, item.event);
      if (result.kind === "updated") {
        fold.working = result.thread;
        fold.dirty = true;
      } else if (result.kind === "deleted") {
        fold.working = null;
        fold.dirty = false;
        yield* setDeleted();
      }
    }

    yield* flushEventRun();
  });

  // Merges a parked older page once the live state has caught up to the
  // page's thread watermark, or discards it if history was rewritten
  // (epoch advanced) while it waited. Must run under applyLock.
  const tryMergePendingOlderPage = Effect.fn("EnvironmentThreadState.tryMergePendingOlderPage")(
    function* () {
      const pending = yield* Ref.get(pendingOlderPage);
      if (pending === null) {
        return;
      }
      const epochNow = yield* Ref.get(historyEpoch);
      if (epochNow !== pending.epoch) {
        yield* Ref.set(pendingOlderPage, null);
        yield* SubscriptionRef.update(state, (value) => ({
          ...value,
          page: Option.map(value.page, (existing) => ({ ...existing, loadingOlder: false })),
        }));
        return;
      }
      const watermark = pending.snapshot.page?.threadSequence;
      const loadedSequence = yield* SubscriptionRef.get(lastSequence);
      if (watermark !== undefined && watermark > loadedSequence) {
        return;
      }
      yield* Ref.set(pendingOlderPage, null);
      yield* mergeOlderPage(pending.snapshot);
    },
  );

  const applyChunk = Effect.fn("EnvironmentThreadState.applyChunk")(function* (
    items: ReadonlyArray<OrchestrationThreadStreamItem>,
  ) {
    yield* applyLock.withPermits(1)(applyChunkLocked(items));
  });

  // Arrivals land on streamItems; a single flusher fiber folds everything
  // that arrived within each window into one publication. Quiet periods cost
  // nothing (the fiber parks on Queue.take), and a scope close drops the
  // buffer, which the cursor resume replays on the next subscription.
  const streamItems = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      for (;;) {
        const first = yield* Queue.take(streamItems);
        yield* Effect.sleep(THREAD_STREAM_COALESCE_WINDOW);
        // Queue.takeBetween(q, 0, n) short-circuits to [] on min <= 0; clear
        // drains everything that landed during the window.
        const rest = yield* Queue.clear(streamItems);
        yield* applyChunk([first, ...rest]);
      }
    }),
  );

  // Merges an older disjoint page below the currently loaded window. All four
  // windowed collections prepend; identity dedupe guards the (server-bug or
  // cursor-misuse) case of overlapping pages so a row never renders twice.
  const mergeOlderPage = Effect.fn("EnvironmentThreadState.mergeOlderPage")(function* (
    snapshot: OrchestrationThreadDetailSnapshot,
  ) {
    // The merge is built inside the update callback so it composes with
    // whatever thread value is current at commit time. The applyLock already
    // serializes this against event application; the atomic build is defense
    // in depth against future callers outside the lock.
    let merged: OrchestrationThread | null = null;
    yield* SubscriptionRef.update(state, (value) => {
      if (Option.isNone(value.data)) {
        return value;
      }
      const loaded = value.data.value;
      const older = snapshot.thread;
      const mergeById = <T extends { readonly id: string }>(
        olderRows: ReadonlyArray<T>,
        loadedRows: ReadonlyArray<T>,
      ): ReadonlyArray<T> => {
        const seen = new Set(loadedRows.map((row) => row.id));
        return [...olderRows.filter((row) => !seen.has(row.id)), ...loadedRows];
      };
      const seenCheckpoints = new Set(loaded.checkpoints.map((row) => row.turnId));
      merged = {
        // Thread metadata stays the loaded (newer) snapshot's; only the
        // windowed collections gain rows from the older page.
        ...loaded,
        messages: mergeById(older.messages, loaded.messages),
        activities: mergeById(older.activities, loaded.activities),
        proposedPlans: mergeById(older.proposedPlans, loaded.proposedPlans),
        checkpoints: [
          ...older.checkpoints.filter((row) => !seenCheckpoints.has(row.turnId)),
          ...loaded.checkpoints,
        ],
      };
      return {
        ...value,
        data: Option.some(merged),
        page: pageStateFromSnapshot(snapshot.page),
      };
    });
    // Persist the widened window under the *loaded* watermark: the merged
    // content is only known consistent with the state it merged into, not
    // with the page's own (possibly newer) sequence.
    if (merged !== null && shouldPersistThread(merged)) {
      const snapshotSequence = yield* SubscriptionRef.get(lastSequence);
      yield* Queue.offer(persistence, {
        snapshotSequence,
        thread: merged,
        ...(snapshot.page === undefined ? {} : { page: { ...snapshot.page, snapshotSequence } }),
      });
    }
  });

  const loadOlderTurns = Effect.fn("EnvironmentThreadState.loadOlderTurns")(function* () {
    // Gated on the connected server's capability: a reconnect to a
    // pre-pagination server must never receive window parameters.
    if (!(yield* Ref.get(paginationSupported))) {
      return;
    }
    const current = yield* SubscriptionRef.get(state);
    const page = Option.getOrNull(current.page);
    if (page === null || page.loadingOlder || !page.hasMore || page.beforeCursor === null) {
      return;
    }
    const prepared = Option.getOrNull(yield* SubscriptionRef.get(supervisor.prepared));
    if (prepared === null) {
      return;
    }
    const epochAtStart = yield* Ref.get(historyEpoch);
    yield* SubscriptionRef.update(state, (value) => ({
      ...value,
      page: Option.map(value.page, (existing) => ({ ...existing, loadingOlder: true })),
    }));
    const window: ThreadSnapshotWindow = {
      turnLimit: OLDER_THREAD_PAGE_USER_TURN_LIMIT,
      beforeCursor: page.beforeCursor,
    };
    const response = yield* snapshotLoader.load(prepared, threadId, window);
    // Staleness check and merge run under the same lock as stream-item
    // application, so a revert/snapshot cannot land between them (TOCTOU
    // review finding) — anything that rewrites history bumps the epoch
    // before this permit is acquired.
    yield* applyLock.withPermits(1)(
      Effect.gen(function* () {
        const epochNow = yield* Ref.get(historyEpoch);
        const loadedSequence = yield* SubscriptionRef.get(lastSequence);
        // A page carrying a sequence older than the loaded state was read
        // from a projection behind what we render; merging it could
        // resurrect turns a newer snapshot or revert already removed.
        const stale =
          epochNow !== epochAtStart ||
          Option.match(response, {
            onNone: () => false,
            onSome: (snapshot) => snapshot.snapshotSequence < loadedSequence,
          });
        if (Option.isNone(response) || stale) {
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            page: Option.map(value.page, (existing) => ({ ...existing, loadingOlder: false })),
          }));
          return;
        }
        // A page read AHEAD of the live state may include content (e.g.
        // streaming deltas of an out-of-window turn) the subscription has
        // not delivered yet; merging now and then replaying those events
        // would duplicate them. Park the page until the live state reaches
        // the page's thread-scoped watermark; loadingOlder stays true so
        // the UI shows progress and no second fetch starts. Pages from
        // pre-watermark servers (threadSequence absent) merge immediately,
        // preserving the old behavior.
        const watermark = response.value.page?.threadSequence;
        if (watermark !== undefined && watermark > loadedSequence) {
          yield* Ref.set(pendingOlderPage, {
            snapshot: response.value,
            epoch: epochNow,
          });
          return;
        }
        yield* mergeOlderPage(response.value);
      }),
    );
  });

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  yield* setSynchronizing;
  yield* Effect.forkScoped(
    subscribeDynamic(
      ORCHESTRATION_WS_METHODS.subscribeThread,
      Effect.fn("EnvironmentThreadState.makeSubscribeInput")(function* (session) {
        const config = yield* session.initialConfig.pipe(
          Effect.orElseSucceed(
            () =>
              ({}) as {
                threadResumeCompletionMarker?: boolean;
                threadSnapshotPagination?: boolean;
              },
          ),
        );
        const supportsCompletionMarker = config.threadResumeCompletionMarker === true;
        // Windowed loads are gated on the server capability: pre-pagination
        // servers reject unknown query params, and a windowed WS fallback to
        // such a server would silently hide history.
        const supportsPagination = config.threadSnapshotPagination === true;
        yield* Ref.set(paginationSupported, supportsPagination);
        yield* Ref.set(awaitingCompletion, supportsCompletionMarker);
        yield* setSynchronizing;

        let current = yield* SubscriptionRef.get(state);
        // A windowed cache resuming against a server without pagination is a
        // trap: afterSequence resume keeps only the window, and the missing
        // older turns can never be loaded (the server has no cursor reads).
        // Drop the window marker and treat the data as needing a full reload.
        if (!supportsPagination && Option.isSome(current.page)) {
          yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            data: Option.none(),
            status: value.status === "deleted" ? value.status : ("empty" as const),
            page: Option.none(),
          }));
          yield* SubscriptionRef.set(lastSequence, 0);
          current = yield* SubscriptionRef.get(state);
        }
        const shouldLoadHttpSnapshot = current.status !== "deleted" && Option.isNone(current.data);
        if (shouldLoadHttpSnapshot) {
          const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
            Effect.flatMap(
              Option.match({
                onSome: Effect.succeed,
                onNone: () =>
                  SubscriptionRef.changes(supervisor.prepared).pipe(
                    Stream.filter(Option.isSome),
                    Stream.map((value) => value.value),
                    Stream.runHead,
                    Effect.map(Option.getOrThrow),
                  ),
              }),
            ),
          );
          const httpSnapshot = yield* snapshotLoader.load(
            prepared,
            threadId,
            supportsPagination ? { turnLimit: INITIAL_THREAD_USER_TURN_LIMIT } : undefined,
          );
          if (Option.isSome(httpSnapshot)) {
            yield* applyChunk([{ kind: "snapshot", snapshot: httpSnapshot.value }]);
            current = yield* SubscriptionRef.get(state);
          }
        }

        const sequence = yield* SubscriptionRef.get(lastSequence);
        const canResume = Option.isSome(current.data);
        if (!supportsCompletionMarker && canResume) {
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            status: value.status === "deleted" ? value.status : ("live" as const),
            error: Option.none(),
          }));
        }

        return {
          threadId,
          ...(canResume ? { afterSequence: sequence } : {}),
          ...(supportsCompletionMarker ? { requestCompletionMarker: true as const } : {}),
          // The WS fallback snapshot (sent when afterSequence is missing or
          // the gap is too large) should be windowed the same as the HTTP
          // path; without this a resume failure re-downloads the full thread.
          ...(supportsPagination ? { turnLimit: INITIAL_THREAD_USER_TURN_LIMIT } : {}),
        };
      }),
      {
        onExpectedFailure: publishStreamError,
        retryExpectedFailureAfter: "250 millis",
      },
    ).pipe(Stream.runForEach((item) => Queue.offer(streamItems, item))),
  );

  // Expose loadOlderTurns to UI actions through the request registry.
  // Requests funnel through a sliding queue drained serially, so mashing
  // "load earlier" coalesces (loadOlderTurns itself no-ops while a fetch is
  // in flight).
  const olderTurnRequestRegistry = yield* ThreadOlderTurnRequests;
  const olderTurnRequests = yield* Queue.sliding<void>(1);
  yield* Stream.fromQueue(olderTurnRequests).pipe(
    Stream.runForEach(() => loadOlderTurns()),
    Effect.forkScoped,
  );
  const deregister = olderTurnRequestRegistry.register(
    threadKey({ environmentId, threadId }),
    () => {
      Queue.offerUnsafe(olderTurnRequests, undefined);
    },
  );
  yield* Effect.addFinalizer(() => Effect.sync(deregister));

  yield* Effect.addFinalizer(() =>
    Effect.all([SubscriptionRef.get(state), SubscriptionRef.get(lastSequence)]).pipe(
      Effect.flatMap(([current, snapshotSequence]) => {
        if (current.status === "deleted") {
          warmStates.remove(stateKey);
          return Effect.void;
        }
        return Option.match(current.data, {
          onNone: () => Effect.void,
          onSome: (thread) => {
            // Hand the loaded state to the next machine for this thread even
            // when the persisted cache skips it (running threads): reopening
            // renders instantly and resumes via afterSequence.
            warmStates.set(stateKey, {
              thread,
              page: current.page,
              lastSequence: snapshotSequence,
              generation: warmGeneration,
            });
            return shouldPersistThread(thread)
              ? persist({
                  snapshotSequence,
                  thread,
                  ...Option.match(current.page, {
                    onNone: () => ({}),
                    onSome: (page) =>
                      ({
                        page: {
                          beforeCursor: page.beforeCursor,
                          hasMore: page.hasMore,
                          snapshotSequence,
                        },
                      }) as const,
                  }),
                })
              : Effect.void;
          },
        });
      }),
    ),
  );

  return state;
});

export function threadStateChanges(environmentId: EnvironmentIdType, threadId: ThreadIdType) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(makeEnvironmentThreadState(threadId).pipe(Effect.map(SubscriptionRef.changes))),
  );
}

export function createEnvironmentThreadStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | EnvironmentCacheStore | ThreadSnapshotLoader | WarmThreadStates | R,
    E
  >,
  options?: { readonly idleTtlMs?: number },
) {
  const idleTtlMs = options?.idleTtlMs ?? THREAD_STATE_IDLE_TTL_MS;
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    return runtime
      .atom(threadStateChanges(environmentId, threadId), {
        initialValue: EMPTY_ENVIRONMENT_THREAD_STATE,
      })
      .pipe(Atom.setIdleTTL(idleTtlMs), Atom.withLabel(`environment-thread-state:${key}`));
  });

  return {
    stateAtom: (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
      family(threadKey({ environmentId, threadId })),
  };
}

export * from "./archivedThreads.ts";
export * from "./checkpointDiff.ts";
export * from "./threadSnapshotHttp.ts";
export * from "./composerPathSearch.ts";
export * from "./threadCommands.ts";
export * from "./threadDetail.ts";
export * from "./threadReducer.ts";
export * from "./threadShell.ts";
export * from "./threadState.ts";
