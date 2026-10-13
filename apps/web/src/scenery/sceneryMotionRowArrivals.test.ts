import { describe, expect, it } from "vite-plus/test";

import {
  enterDelayMs,
  rowBoundsSeenContent,
  shouldAnimateRowArrival,
  shouldDeferThreadSeed,
  STAGGER_CAP,
  STAGGER_MS,
} from "./sceneryMotionRowArrivals";

const visibleArrival = {
  firstPaintForThread: false,
  silentWindowActive: false,
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

  it("seeds during the silent window or under no-transitions", () => {
    expect(shouldAnimateRowArrival({ ...visibleArrival, silentWindowActive: true })).toBe(false);
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

describe("rowBoundsSeenContent", () => {
  it("lets rows a turn inserts above the live tail arrive", () => {
    const rows = [
      { kind: "message", top: 200 },
      { kind: "work-live", top: 520 },
      { kind: "thinking", top: 560 },
    ];
    const maxSeenTop = Math.max(
      ...rows.filter((row) => rowBoundsSeenContent(row.kind)).map((row) => row.top),
    );
    expect(shouldAnimateRowArrival({ ...visibleArrival, top: 480, maxSeenTop })).toBe(true);
    expect(rowBoundsSeenContent("working")).toBe(false);
  });

  it("keeps settled rows as the bound for history", () => {
    for (const kind of ["message", "work", "work-toggle", "turn-fold", null]) {
      expect(rowBoundsSeenContent(kind)).toBe(true);
    }
  });
});

describe("enterDelayMs", () => {
  it("staggers then caps so a burst cannot stay invisible behind both-fill", () => {
    expect(enterDelayMs(0)).toBe(0);
    expect(enterDelayMs(2)).toBe(2 * STAGGER_MS);
    expect(enterDelayMs(STAGGER_CAP + 8)).toBe(STAGGER_CAP * STAGGER_MS);
  });
});
