import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useThreadDepartureStore } from "./threadDepartureStore";

function resetDepartureStore() {
  const state = useThreadDepartureStore.getState();
  for (const threadKey of Object.keys(state.departingKindByKey)) {
    state.clearDeparting(threadKey);
  }
}

describe("threadDepartureStore", () => {
  beforeEach(() => {
    resetDepartureStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDepartureStore();
  });

  it("marks a thread departing and clears it", () => {
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "settle");
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({
      "env1:thread1": "settle",
    });
    useThreadDepartureStore.getState().clearDeparting("env1:thread1");
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
  });

  it("re-marking a thread replaces the departure kind", () => {
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "settle");
    store.markDeparting("env1:thread1", "snooze");
    expect(useThreadDepartureStore.getState().departingKindByKey["env1:thread1"]).toBe("snooze");
  });

  it("expires a marker that no confirmation path ever clears", () => {
    vi.useFakeTimers();
    useThreadDepartureStore.getState().markDeparting("env1:thread1", "settle");
    vi.advanceTimersByTime(3_999);
    expect(useThreadDepartureStore.getState().departingKindByKey["env1:thread1"]).toBe("settle");
    vi.advanceTimersByTime(1);
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
  });

  it("does not let a stale expiry clear a newer marker for the same thread", () => {
    vi.useFakeTimers();
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "settle");
    vi.advanceTimersByTime(2_000);
    store.markDeparting("env1:thread1", "snooze");
    // The first marker's timer would have fired at 4s; the replacement must
    // survive it and expire on its own clock.
    vi.advanceTimersByTime(2_000);
    expect(useThreadDepartureStore.getState().departingKindByKey["env1:thread1"]).toBe("snooze");
    vi.advanceTimersByTime(2_000);
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
  });

  it("treats clearing an unknown thread as a no-op", () => {
    const before = useThreadDepartureStore.getState().departingKindByKey;
    useThreadDepartureStore.getState().clearDeparting("env1:nope");
    expect(useThreadDepartureStore.getState().departingKindByKey).toBe(before);
  });
});
