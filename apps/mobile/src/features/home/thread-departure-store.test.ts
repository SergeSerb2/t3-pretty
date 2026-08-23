import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  clearThreadArriving,
  clearThreadDeparting,
  getThreadDepartureSnapshot,
  markThreadDeparting,
  subscribeThreadDeparture,
  threadDepartureHasLanded,
} from "./thread-departure-store";

const KEY = "env1:thread1";

afterEach(() => {
  clearThreadDeparting(KEY);
  clearThreadArriving(KEY);
  vi.useRealTimers();
});

describe("thread-departure-store", () => {
  it("marks a thread departing and raises arrive on clear", () => {
    markThreadDeparting(KEY, "settle");
    expect(getThreadDepartureSnapshot(KEY)).toEqual({ departingKind: "settle", arriving: false });
    clearThreadDeparting(KEY);
    expect(getThreadDepartureSnapshot(KEY)).toEqual({ departingKind: null, arriving: true });
    clearThreadArriving(KEY);
    expect(getThreadDepartureSnapshot(KEY)).toEqual({ departingKind: null, arriving: false });
  });

  it("re-marking replaces the kind and cancels a pending arrive fade", () => {
    markThreadDeparting(KEY, "settle");
    clearThreadDeparting(KEY);
    markThreadDeparting(KEY, "snooze");
    expect(getThreadDepartureSnapshot(KEY)).toEqual({ departingKind: "snooze", arriving: false });
  });

  it("expires a stuck departure via the TTL", () => {
    vi.useFakeTimers();
    markThreadDeparting(KEY, "snooze");
    vi.advanceTimersByTime(4_000);
    expect(getThreadDepartureSnapshot(KEY).departingKind).toBeNull();
    expect(getThreadDepartureSnapshot(KEY).arriving).toBe(true);
    vi.advanceTimersByTime(300);
    expect(getThreadDepartureSnapshot(KEY).arriving).toBe(false);
  });

  it("notifies subscribers on every transition", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThreadDeparture(KEY, listener);
    markThreadDeparting(KEY, "settle");
    clearThreadDeparting(KEY);
    clearThreadArriving(KEY);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    markThreadDeparting(KEY, "settle");
    expect(listener).toHaveBeenCalledTimes(3);
    clearThreadDeparting(KEY);
    clearThreadArriving(KEY);
  });

  it("notifies only listeners for the changed thread", () => {
    const otherKey = "env1:thread2";
    const listener = vi.fn();
    const otherListener = vi.fn();
    const unsubscribe = subscribeThreadDeparture(KEY, listener);
    const unsubscribeOther = subscribeThreadDeparture(otherKey, otherListener);
    markThreadDeparting(KEY, "settle");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
    unsubscribe();
    unsubscribeOther();
    clearThreadDeparting(KEY);
  });

  it("lands only on the shelf matching the departure kind", () => {
    const snoozed = { snoozed: true, settled: false };
    const settled = { snoozed: false, settled: true };
    expect(threadDepartureHasLanded("settle", settled)).toBe(true);
    expect(threadDepartureHasLanded("settle", snoozed)).toBe(false);
    expect(threadDepartureHasLanded("snooze", snoozed)).toBe(true);
    expect(threadDepartureHasLanded("snooze", settled)).toBe(false);
    expect(threadDepartureHasLanded(null, snoozed)).toBe(false);
    expect(threadDepartureHasLanded(null, settled)).toBe(false);
  });

  it("clearing an unmarked thread is a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThreadDeparture(KEY, listener);
    clearThreadDeparting(KEY);
    clearThreadArriving(KEY);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
