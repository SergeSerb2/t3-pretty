import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_HOVER_SPEED_STALE_MS,
  composerHoverDurationScale,
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
  it("uses the last step, then forgets a parked pointer", () => {
    expect(pointerSpeedPxPerMs(0, 0, 1000, 9, 12, 1010)).toBeCloseTo(1.5);
    expect(pointerSpeedPxPerMs(0, 0, 1000, 400, 0, 1000 + COMPOSER_HOVER_SPEED_STALE_MS)).toBe(0);
    expect(pointerSpeedPxPerMs(0, 0, 1000, 10, 0, 1000)).toBe(0);
  });
});
