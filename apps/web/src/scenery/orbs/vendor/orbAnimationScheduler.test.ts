import { describe, expect, it } from "vite-plus/test";

import {
  createOrbAnimationScheduler,
  ORB_FRAME_INTERVAL_MS,
  ORB_MAX_FRAMES_PER_SECOND,
} from "./orbAnimationScheduler";

function schedulerHarness() {
  let nextFrameId = 1;
  let nextTimerId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const cancelledFrames: number[] = [];
  const cancelledTimers: number[] = [];
  const scheduler = createOrbAnimationScheduler({
    requestFrame(callback) {
      const frameId = nextFrameId++;
      pending.set(frameId, callback);
      return frameId;
    },
    cancelFrame(frameId) {
      cancelledFrames.push(frameId);
      pending.delete(frameId);
    },
    setTimer(callback, delayMs) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, delayMs });
      return timerId;
    },
    clearTimer(timerId) {
      cancelledTimers.push(timerId);
      timers.delete(timerId);
    },
  });
  const flushFrame = (timestamp: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) {
      callback(timestamp);
    }
  };
  const flushTimer = () => {
    const callbacks = [...timers.values()].map((timer) => timer.callback);
    timers.clear();
    for (const callback of callbacks) {
      callback();
    }
  };
  return {
    cancelledFrames,
    cancelledTimers,
    flushFrame,
    flushTimer,
    pending,
    scheduler,
    timers,
  };
}

describe("thinking-orb animation scheduler", () => {
  it("shares one pending animation frame across every orb", () => {
    const harness = schedulerHarness();
    const firstDraws: number[] = [];
    const secondDraws: number[] = [];

    harness.scheduler.subscribe((timestamp) => firstDraws.push(timestamp));
    harness.scheduler.subscribe((timestamp) => secondDraws.push(timestamp));

    expect(harness.pending.size).toBe(1);
    harness.flushFrame(10);
    expect(firstDraws).toEqual([10]);
    expect(secondDraws).toEqual([10]);
    expect(harness.pending.size).toBe(0);
    expect(harness.timers.size).toBe(1);
    harness.flushTimer();
    expect(harness.pending.size).toBe(1);
  });

  it("paces canvas draws at no more than 30 frames per second", () => {
    const harness = schedulerHarness();
    const draws: number[] = [];
    harness.scheduler.subscribe((timestamp) => draws.push(timestamp));

    harness.flushFrame(0);
    expect(harness.pending.size).toBe(0);
    expect([...harness.timers.values()].map((timer) => timer.delayMs)).toEqual([
      ORB_FRAME_INTERVAL_MS,
    ]);
    harness.flushTimer();
    harness.flushFrame(34);

    expect(ORB_MAX_FRAMES_PER_SECOND).toBe(30);
    expect(ORB_FRAME_INTERVAL_MS).toBeCloseTo(33.33, 1);
    expect(draws).toEqual([0, 34]);
  });

  it("cancels the shared frame when the last orb unsubscribes", () => {
    const harness = schedulerHarness();
    const unsubscribeFirst = harness.scheduler.subscribe(() => undefined);
    const unsubscribeSecond = harness.scheduler.subscribe(() => undefined);

    unsubscribeFirst();
    expect(harness.pending.size).toBe(1);
    unsubscribeSecond();

    expect(harness.pending.size).toBe(0);
    expect(harness.cancelledFrames).toHaveLength(1);
  });

  it("clears the cadence timer when the last active orb unsubscribes", () => {
    const harness = schedulerHarness();
    const unsubscribe = harness.scheduler.subscribe(() => undefined);
    harness.flushFrame(0);

    expect(harness.timers.size).toBe(1);
    unsubscribe();

    expect(harness.timers.size).toBe(0);
    expect(harness.cancelledTimers).toHaveLength(1);
  });
});
