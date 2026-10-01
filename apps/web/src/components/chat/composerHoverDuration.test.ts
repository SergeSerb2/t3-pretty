import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_HOVER_SPEED_STALE_MS,
  composerHoverDestinationInside,
  composerHoverDurationScale,
  composerHoverPointerSpeed,
  composerHoverSettle,
  createComposerHoverTracker,
  pointerSpeedPxPerMs,
  smoothPointerSpeed,
} from "./composerHoverDuration";

describe("composerHoverDurationScale", () => {
  it("slows down when the pointer is still or crawling", () => {
    expect(composerHoverDurationScale(0)).toBeGreaterThan(1);
    expect(composerHoverDurationScale(0.1)).toBeGreaterThan(composerHoverDurationScale(0.45));
  });

  it("keeps the CSS bases around a typical mouse speed", () => {
    expect(composerHoverDurationScale(0.45)).toBeCloseTo(1, 1);
  });

  it("shortens a flick without snapping the light on or off", () => {
    expect(composerHoverDurationScale(3)).toBeGreaterThan(0.6);
    expect(composerHoverDurationScale(3)).toBeLessThan(0.8);
    expect(composerHoverDurationScale(3, "exit")).toBeGreaterThan(composerHoverDurationScale(3));
  });

  it("lets a slow leave linger longer than a fast one, and longer than a fast enter", () => {
    const slowExit = composerHoverDurationScale(0, "exit");
    const fastExit = composerHoverDurationScale(3, "exit");
    expect(slowExit).toBeGreaterThan(fastExit);
    expect(slowExit / fastExit).toBeGreaterThan(1.6);
    expect(fastExit).toBeGreaterThan(composerHoverDurationScale(3));
  });

  it("holds a landing a little longer than the same speed in a straight pass", () => {
    const coast = composerHoverDurationScale(0.6, "enter", 0.6);
    const landing = composerHoverDurationScale(0.6, "enter", 1.4);
    const flick = composerHoverDurationScale(0.6, "enter", 0.2);
    expect(landing).toBeGreaterThan(coast);
    expect(flick).toBeLessThan(coast);
  });

  it("treats non-finite input as a parked pointer", () => {
    expect(composerHoverDurationScale(Number.NaN)).toBe(composerHoverDurationScale(0));
    expect(composerHoverDurationScale(Number.POSITIVE_INFINITY)).toBe(
      composerHoverDurationScale(0),
    );
  });
});

describe("composerHoverSettle", () => {
  it("opens fully for a still hand and stays tight on a flick", () => {
    expect(composerHoverSettle(0)).toBe(1);
    expect(composerHoverSettle(0.45)).toBeGreaterThan(0.3);
    expect(composerHoverSettle(0.45)).toBeLessThan(0.7);
    expect(composerHoverSettle(3)).toBe(0);
  });
});

describe("smoothPointerSpeed", () => {
  it("takes the first sample and then eases toward the next one", () => {
    expect(smoothPointerSpeed(0, 2, 16)).toBe(2);
    const nudged = smoothPointerSpeed(1, 2, 8);
    expect(nudged).toBeGreaterThan(1);
    expect(nudged).toBeLessThan(1.3);
    expect(smoothPointerSpeed(0.2, 2, 200)).toBeGreaterThan(1.5);
  });
});

describe("createComposerHoverTracker", () => {
  it("blends the crossing step with the smoothed approach", () => {
    const tracker = createComposerHoverTracker();
    tracker.sample(0, 0, 1000);
    tracker.sample(40, 0, 1100);
    const cross = tracker.crossing(80, 0, 1200);
    expect(cross.speed).toBeGreaterThan(0.3);
    expect(cross.speed).toBeLessThan(0.6);
  });

  it("forgets a flick after the pointer rests", () => {
    const tracker = createComposerHoverTracker();
    tracker.sample(0, 0, 1000);
    tracker.sample(200, 0, 1100);
    tracker.rest();
    expect(tracker.crossing(200, 0, 1100).speed).toBe(0);
  });
});

describe("composerHoverDestinationInside", () => {
  it("agrees on enter for both events of one cross", () => {
    expect(composerHoverDestinationInside("pointerover", true, false)).toBe(true);
    expect(composerHoverDestinationInside("pointerout", false, true)).toBe(true);
  });

  it("agrees on leave for both events of one cross", () => {
    expect(composerHoverDestinationInside("pointerout", true, false)).toBe(false);
    expect(composerHoverDestinationInside("pointerover", false, true)).toBe(false);
  });

  it("ignores moves that stay inside or outside the shell", () => {
    expect(composerHoverDestinationInside("pointerover", true, true)).toBeNull();
    expect(composerHoverDestinationInside("pointerout", false, false)).toBeNull();
  });
});

describe("pointerSpeedPxPerMs", () => {
  it("uses hypot/dt for the last step, capping idle so a flick after pause still counts", () => {
    expect(pointerSpeedPxPerMs(0, 0, 1000, 9, 12, 1010)).toBeCloseTo(1.5);
    expect(pointerSpeedPxPerMs(0, 0, 1000, 400, 0, 1100)).toBeCloseTo(4);
    expect(pointerSpeedPxPerMs(0, 0, 1000, 400, 0, 1150)).toBeCloseTo(4);
    expect(pointerSpeedPxPerMs(0, 0, 1000, 10, 0, 1000)).toBe(0);
  });
});

describe("composerHoverPointerSpeed", () => {
  it("uses the crossing step after idle instead of a zeroed lastSpeed", () => {
    expect(composerHoverPointerSpeed(0, 0, 1000, 0, 400, 0, 1150)).toBeCloseTo(4);
  });

  it("reuses lastSpeed when this event already updated the sample", () => {
    expect(composerHoverPointerSpeed(400, 0, 1150, 2.5, 400, 0, 1150)).toBe(2.5);
  });

  it("reuses lastSpeed when enter/leave shares the sample point at a later time", () => {
    expect(composerHoverPointerSpeed(400, 0, 1150, 2.5, 400, 0, 1152)).toBe(2.5);
  });

  it("forgets lastSpeed after a same-point dwell", () => {
    expect(
      composerHoverPointerSpeed(400, 0, 1150, 2.5, 400, 0, 1150 + COMPOSER_HOVER_SPEED_STALE_MS),
    ).toBe(0);
  });

  it("drops speed when there was no prior coordinate", () => {
    expect(composerHoverPointerSpeed(0, 0, 0, 3, 400, 0, 1150)).toBe(0);
  });
});
