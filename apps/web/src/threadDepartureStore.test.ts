import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useThreadDepartureStore } from "./threadDepartureStore";

function resetDepartureStore() {
  const state = useThreadDepartureStore.getState();
  for (const threadKey of Object.keys(state.departingKindByKey)) {
    state.clearDeparting(threadKey);
  }
  for (const threadKey of Object.keys(state.arrivingByKey)) {
    state.clearArriving(threadKey);
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

  it("raises a short-lived arrive marker when a departure clears", () => {
    vi.useFakeTimers();
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "settle");
    store.clearDeparting("env1:thread1");
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
    expect(useThreadDepartureStore.getState().arrivingByKey["env1:thread1"]).toBe(true);
    // The marker must outlive sidebar-row-arrive's 200ms so the class never
    // disappears mid-animation, then clear on its own.
    vi.advanceTimersByTime(299);
    expect(useThreadDepartureStore.getState().arrivingByKey["env1:thread1"]).toBe(true);
    vi.advanceTimersByTime(1);
    expect(useThreadDepartureStore.getState().arrivingByKey).toEqual({});
  });

  it("does not raise an arrive marker when clearing an unknown thread", () => {
    useThreadDepartureStore.getState().clearDeparting("env1:nope");
    expect(useThreadDepartureStore.getState().arrivingByKey).toEqual({});
  });

  it("clears silently when raiseArrive is false", () => {
    vi.useFakeTimers();
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "snooze");
    store.clearDeparting("env1:thread1", { raiseArrive: false });
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
    expect(useThreadDepartureStore.getState().arrivingByKey).toEqual({});
    // No arrive timer is pending either: later ticks must stay clean.
    vi.advanceTimersByTime(1_000);
    expect(useThreadDepartureStore.getState().arrivingByKey).toEqual({});
  });

  it("lets a fresh departure supersede a pending arrive marker", () => {
    const store = useThreadDepartureStore.getState();
    store.markDeparting("env1:thread1", "settle");
    store.clearDeparting("env1:thread1");
    expect(useThreadDepartureStore.getState().arrivingByKey["env1:thread1"]).toBe(true);
    store.markDeparting("env1:thread1", "snooze");
    expect(useThreadDepartureStore.getState().arrivingByKey).toEqual({});
    expect(useThreadDepartureStore.getState().departingKindByKey["env1:thread1"]).toBe("snooze");
  });

  it("raises an arrive marker when the departure backstop expires", () => {
    vi.useFakeTimers();
    useThreadDepartureStore.getState().markDeparting("env1:thread1", "settle");
    vi.advanceTimersByTime(4_000);
    expect(useThreadDepartureStore.getState().departingKindByKey).toEqual({});
    expect(useThreadDepartureStore.getState().arrivingByKey["env1:thread1"]).toBe(true);
  });
});
