import { create } from "zustand";

export type ThreadDepartureKind = "settle" | "snooze";

/** Backstop for markers whose confirmation path never lands (the command
    succeeded but no matching reclassification event arrived, e.g. the thread
    woke again in the same instant): the row fades back rather than staying
    hidden forever. */
const DEPARTURE_MARKER_TTL_MS = 4_000;

/** Matches sidebar-row-arrive's 200ms in index.css, plus a buffer so the
    class never disappears mid-animation. */
const ARRIVE_MARKER_TTL_MS = 300;

interface ThreadDepartureState {
  readonly departingKindByKey: Readonly<Record<string, ThreadDepartureKind>>;
  readonly arrivingByKey: Readonly<Record<string, true>>;
  readonly markDeparting: (threadKey: string, kind: ThreadDepartureKind) => void;
  readonly clearDeparting: (threadKey: string) => void;
  readonly clearArriving: (threadKey: string) => void;
}

const departureExpiryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const arriveExpiryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Optimistic "this row is leaving" signal for settle/snooze. The dispatch
 * site (useThreadActions) marks a thread departing the moment the action
 * fires — before the server round trip — so the sidebar row can start its
 * slide-out immediately instead of snapping away whenever the event lands.
 * The sidebar clears the marker once canonical classification matches; the
 * dispatch site clears it on failure; the TTL covers every other path.
 *
 * Clearing also raises a short-lived arrive marker. Settle/snooze moves the
 * thread to another shelf, unmounting the source row, so arrive state kept
 * on the row instance would die with it; the store marker survives the
 * remount and lets the destination row play the arrive fade (or the source
 * row, fading back in place when the command failed).
 */
export const useThreadDepartureStore = create<ThreadDepartureState>()((set, get) => ({
  departingKindByKey: {},
  arrivingByKey: {},
  markDeparting: (threadKey, kind) => {
    const existingDeparture = departureExpiryTimerByKey.get(threadKey);
    if (existingDeparture !== undefined) clearTimeout(existingDeparture);
    departureExpiryTimerByKey.set(
      threadKey,
      setTimeout(() => get().clearDeparting(threadKey), DEPARTURE_MARKER_TTL_MS),
    );
    // A fresh departure supersedes a stale arrive fade (e.g. settling again
    // while the failure fade-back is still playing): holding both would put
    // competing animations on the same row.
    const existingArrive = arriveExpiryTimerByKey.get(threadKey);
    if (existingArrive !== undefined) {
      clearTimeout(existingArrive);
      arriveExpiryTimerByKey.delete(threadKey);
    }
    set((state) => {
      const arrivingByKey = { ...state.arrivingByKey };
      delete arrivingByKey[threadKey];
      return {
        departingKindByKey: { ...state.departingKindByKey, [threadKey]: kind },
        arrivingByKey,
      };
    });
  },
  clearDeparting: (threadKey) => {
    const timer = departureExpiryTimerByKey.get(threadKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      departureExpiryTimerByKey.delete(threadKey);
    }
    if (!(threadKey in get().departingKindByKey)) return;
    const existingArrive = arriveExpiryTimerByKey.get(threadKey);
    if (existingArrive !== undefined) clearTimeout(existingArrive);
    arriveExpiryTimerByKey.set(
      threadKey,
      setTimeout(() => get().clearArriving(threadKey), ARRIVE_MARKER_TTL_MS),
    );
    set((state) => {
      const departingKindByKey = { ...state.departingKindByKey };
      delete departingKindByKey[threadKey];
      return {
        departingKindByKey,
        arrivingByKey: { ...state.arrivingByKey, [threadKey]: true },
      };
    });
  },
  clearArriving: (threadKey) => {
    const timer = arriveExpiryTimerByKey.get(threadKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      arriveExpiryTimerByKey.delete(threadKey);
    }
    if (!(threadKey in get().arrivingByKey)) return;
    set((state) => {
      const arrivingByKey = { ...state.arrivingByKey };
      delete arrivingByKey[threadKey];
      return { arrivingByKey };
    });
  },
}));
