export type ThreadDepartureKind = "settle" | "snooze";

/** True when the row is already on the shelf this departure targeted.
    Snoozed vs settled must not complete each other's exit. */
export function threadDepartureHasLanded(
  kind: ThreadDepartureKind | null,
  shelf: { readonly snoozed: boolean; readonly settled: boolean },
): boolean {
  return (kind === "settle" && shelf.settled) || (kind === "snooze" && shelf.snoozed);
}

/** Backstop for markers whose confirmation path never lands (the command
    succeeded but no matching reclassification event arrived, e.g. the thread
    woke again in the same instant): the row fades back rather than staying
    hidden forever. Mirrors web's threadDepartureStore. */
const DEPARTURE_MARKER_TTL_MS = 4_000;

/** Outlives the 200ms arrive animation in ThreadListV2Row with a buffer so
    the marker never disappears mid-animation. */
const ARRIVE_MARKER_TTL_MS = 300;

export interface ThreadDepartureSnapshot {
  readonly departingKind: ThreadDepartureKind | null;
  readonly arriving: boolean;
}

const IDLE_SNAPSHOT: ThreadDepartureSnapshot = { departingKind: null, arriving: false };

const departingKindByKey = new Map<string, ThreadDepartureKind>();
const arrivingKeys = new Set<string>();
const departureExpiryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const arriveExpiryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const listenersByKey = new Map<string, Set<() => void>>();
const snapshotByKey = new Map<string, ThreadDepartureSnapshot>();

function emit(threadKey: string): void {
  const departingKind = departingKindByKey.get(threadKey) ?? null;
  const arriving = arrivingKeys.has(threadKey);
  if (departingKind === null && !arriving) {
    snapshotByKey.delete(threadKey);
  } else {
    snapshotByKey.set(threadKey, { departingKind, arriving });
  }
  const listeners = listenersByKey.get(threadKey);
  if (listeners === undefined) return;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeThreadDeparture(threadKey: string, listener: () => void): () => void {
  let listeners = listenersByKey.get(threadKey);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByKey.set(threadKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByKey.delete(threadKey);
  };
}

/** Stable per-key snapshot for useSyncExternalStore. */
export function getThreadDepartureSnapshot(threadKey: string): ThreadDepartureSnapshot {
  return snapshotByKey.get(threadKey) ?? IDLE_SNAPSHOT;
}

/**
 * Optimistic "this row is leaving" signal for settle/snooze. The dispatch
 * site (useThreadListActions) marks a thread departing the moment the action
 * fires — before the server round trip — so the list row can start its
 * slide-out immediately instead of snapping away whenever the event lands.
 * The destination row clears the marker once canonical classification
 * matches; the dispatch site clears it on failure; the TTL covers every
 * other path. Clearing raises a short-lived arrive marker so the row plays
 * the arrive fade — at its new shelf spot on success, in place on failure,
 * which reads as a snap-back.
 */
export function markThreadDeparting(threadKey: string, kind: ThreadDepartureKind): void {
  const existingDeparture = departureExpiryTimerByKey.get(threadKey);
  if (existingDeparture !== undefined) clearTimeout(existingDeparture);
  departureExpiryTimerByKey.set(
    threadKey,
    setTimeout(() => clearThreadDeparting(threadKey), DEPARTURE_MARKER_TTL_MS),
  );
  // A fresh departure supersedes a stale arrive fade (e.g. settling again
  // while the failure fade-back is still playing): holding both would put
  // competing animations on the same row.
  const existingArrive = arriveExpiryTimerByKey.get(threadKey);
  if (existingArrive !== undefined) {
    clearTimeout(existingArrive);
    arriveExpiryTimerByKey.delete(threadKey);
  }
  arrivingKeys.delete(threadKey);
  departingKindByKey.set(threadKey, kind);
  emit(threadKey);
}

export function clearThreadDeparting(threadKey: string): void {
  const timer = departureExpiryTimerByKey.get(threadKey);
  if (timer !== undefined) {
    clearTimeout(timer);
    departureExpiryTimerByKey.delete(threadKey);
  }
  if (!departingKindByKey.has(threadKey)) return;
  departingKindByKey.delete(threadKey);
  const existingArrive = arriveExpiryTimerByKey.get(threadKey);
  if (existingArrive !== undefined) clearTimeout(existingArrive);
  arriveExpiryTimerByKey.set(
    threadKey,
    setTimeout(() => clearThreadArriving(threadKey), ARRIVE_MARKER_TTL_MS),
  );
  arrivingKeys.add(threadKey);
  emit(threadKey);
}

export function clearThreadArriving(threadKey: string): void {
  const timer = arriveExpiryTimerByKey.get(threadKey);
  if (timer !== undefined) {
    clearTimeout(timer);
    arriveExpiryTimerByKey.delete(threadKey);
  }
  if (!arrivingKeys.has(threadKey)) return;
  arrivingKeys.delete(threadKey);
  emit(threadKey);
}
