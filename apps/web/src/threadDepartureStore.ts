import { create } from "zustand";

export type ThreadDepartureKind = "settle" | "snooze";

/** Backstop for markers whose confirmation path never lands (the command
    succeeded but no matching reclassification event arrived, e.g. the thread
    woke again in the same instant): the row fades back rather than staying
    hidden forever. */
const DEPARTURE_MARKER_TTL_MS = 4_000;

interface ThreadDepartureState {
  readonly departingKindByKey: Readonly<Record<string, ThreadDepartureKind>>;
  readonly markDeparting: (threadKey: string, kind: ThreadDepartureKind) => void;
  readonly clearDeparting: (threadKey: string) => void;
}

const expiryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Optimistic "this row is leaving" signal for settle/snooze. The dispatch
 * site (useThreadActions) marks a thread departing the moment the action
 * fires — before the server round trip — so the sidebar row can start its
 * slide-out immediately instead of snapping away whenever the event lands.
 * The sidebar clears the marker once canonical classification matches; the
 * dispatch site clears it on failure; the TTL covers every other path.
 */
export const useThreadDepartureStore = create<ThreadDepartureState>()((set, get) => ({
  departingKindByKey: {},
  markDeparting: (threadKey, kind) => {
    const existing = expiryTimerByKey.get(threadKey);
    if (existing !== undefined) clearTimeout(existing);
    expiryTimerByKey.set(
      threadKey,
      setTimeout(() => get().clearDeparting(threadKey), DEPARTURE_MARKER_TTL_MS),
    );
    set((state) => ({
      departingKindByKey: { ...state.departingKindByKey, [threadKey]: kind },
    }));
  },
  clearDeparting: (threadKey) => {
    const timer = expiryTimerByKey.get(threadKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      expiryTimerByKey.delete(threadKey);
    }
    if (!(threadKey in get().departingKindByKey)) return;
    set((state) => {
      const next = { ...state.departingKindByKey };
      delete next[threadKey];
      return { departingKindByKey: next };
    });
  },
}));
