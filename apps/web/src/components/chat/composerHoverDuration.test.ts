import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_HOVER_SPEED_STALE_MS,
  composerHoverDurationScale,
  composerHoverPointerSpeed,
  pointerSpeedPxPerMs,
} from "./composerHoverDuration";

describe("composerHoverDurationScale", () => {
  it("slows down when the pointer is still or crawling", () => {
    expect(composerHoverDurationScale(0)).toBeGreaterThan(1);
    expect(composerHoverDurationScale(0.1)).toBeGreaterThan(composerHoverDurationScale(0.45));
  });

  it("keeps the CSS bases around a typical mouse speed", () => {
    expect(composerHoverDurationScale(0.45)).toBeCloseTo(1);
  });

  it("snaps shorter when the pointer is moving fast", () => {
    expect(composerHoverDurationScale(3)).toBeLessThan(0.4);
    expect(composerHoverDurationScale(3)).toBeGreaterThan(0);
  });

  it("treats non-finite input as a parked pointer", () => {
    expect(composerHoverDurationScale(Number.NaN)).toBe(composerHoverDurationScale(0));
    expect(composerHoverDurationScale(Number.POSITIVE_INFINITY)).toBe(
      composerHoverDurationScale(0),
    );
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
