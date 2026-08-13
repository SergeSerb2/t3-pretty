import { describe, expect, it } from "vite-plus/test";

import {
  enterDelayMs,
  isSceneryInkTransitionActive,
  shouldAnimateRowArrival,
  shouldDeferThreadSeed,
  STAGGER_CAP,
  STAGGER_MS,
} from "./sceneryMotionRowArrivals";

const visibleArrival = {
  firstPaintForThread: false,
  silentWindowActive: false,
  inkTransitionActive: false,
  noTransitions: false,
  top: 400,
  maxSeenTop: 200,
};

describe("shouldDeferThreadSeed", () => {
  it("waits while the first paint of a thread has no timeline rows yet", () => {
    expect(shouldDeferThreadSeed(true, 0)).toBe(true);
  });

  it("seeds as soon as the first rows for that thread exist", () => {
    expect(shouldDeferThreadSeed(true, 4)).toBe(false);
  });

  it("does not wait after the thread has already been seeded", () => {
    expect(shouldDeferThreadSeed(false, 0)).toBe(false);
  });
});

describe("shouldAnimateRowArrival", () => {
  it("animates a row that appears at or below already-seen content", () => {
    expect(shouldAnimateRowArrival(visibleArrival)).toBe(true);
  });

  it("seeds the first paint after a thread switch instead of animating it", () => {
    expect(shouldAnimateRowArrival({ ...visibleArrival, firstPaintForThread: true })).toBe(false);
  });

  it("seeds during the silent window, an ink view transition, or no-transitions", () => {
    expect(shouldAnimateRowArrival({ ...visibleArrival, silentWindowActive: true })).toBe(false);
    expect(shouldAnimateRowArrival({ ...visibleArrival, inkTransitionActive: true })).toBe(false);
    expect(shouldAnimateRowArrival({ ...visibleArrival, noTransitions: true })).toBe(false);
  });

  it("seeds history that mounts above already-seen content", () => {
    expect(
      shouldAnimateRowArrival({
        ...visibleArrival,
        top: 40,
        maxSeenTop: 400,
      }),
    ).toBe(false);
  });
});

describe("enterDelayMs", () => {
  it("staggers then caps so a burst cannot stay invisible behind both-fill", () => {
    expect(enterDelayMs(0)).toBe(0);
    expect(enterDelayMs(2)).toBe(2 * STAGGER_MS);
    expect(enterDelayMs(STAGGER_CAP + 8)).toBe(STAGGER_CAP * STAGGER_MS);
  });
});

describe("isSceneryInkTransitionActive", () => {
  it("reads the view-transition gate off the document element", () => {
    const root = { dataset: {} } as HTMLElement;
    expect(isSceneryInkTransitionActive(root)).toBe(false);
    root.dataset.sceneryInkTransition = "true";
    expect(isSceneryInkTransitionActive(root)).toBe(true);
  });
});
