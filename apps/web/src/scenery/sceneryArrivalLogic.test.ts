import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  hasPlayedSceneryArrival,
  markSceneryArrivalPlayed,
  measureCenterDelta,
  remainingFogHoldMs,
  resetPlayedSceneryArrivals,
  sceneryArrivalCoversSwap,
  sceneryArrivalSettleAtMs,
  shouldArmSceneryArrival,
  shouldPlaySceneryArrival,
  SCENERY_ARRIVAL,
} from "./sceneryArrivalLogic";

afterEach(() => {
  resetPlayedSceneryArrivals();
});

describe("shouldPlaySceneryArrival", () => {
  const ready = {
    placement: "hero" as const,
    threadKey: "env:thread",
    hasPhoto: true,
    reducedMotion: false,
    motionEnabled: true,
    alreadyPlayed: false,
  };

  it("plays on a fresh hero thread with a photo", () => {
    expect(shouldPlaySceneryArrival(ready)).toBe(true);
  });

  it("skips docked threads, missing photos, and already-played keys", () => {
    expect(shouldPlaySceneryArrival({ ...ready, placement: "docked" })).toBe(false);
    expect(shouldPlaySceneryArrival({ ...ready, placement: null })).toBe(false);
    expect(shouldPlaySceneryArrival({ ...ready, hasPhoto: false })).toBe(false);
    expect(shouldPlaySceneryArrival({ ...ready, threadKey: null })).toBe(false);
    expect(shouldPlaySceneryArrival({ ...ready, alreadyPlayed: true })).toBe(false);
  });

  it("skips when the user asked for less motion", () => {
    expect(shouldPlaySceneryArrival({ ...ready, reducedMotion: true })).toBe(false);
    expect(shouldPlaySceneryArrival({ ...ready, motionEnabled: false })).toBe(false);
  });
});

describe("shouldArmSceneryArrival", () => {
  const ready = {
    placement: "hero" as const,
    threadKey: "env:thread",
    reducedMotion: false,
    motionEnabled: true,
    alreadyPlayed: false,
  };

  it("arms fog on a fresh hero thread before the photo has decoded", () => {
    expect(shouldArmSceneryArrival(ready)).toBe(true);
  });

  it("does not arm docked, already-played, or reduced-motion threads", () => {
    expect(shouldArmSceneryArrival({ ...ready, placement: "docked" })).toBe(false);
    expect(shouldArmSceneryArrival({ ...ready, alreadyPlayed: true })).toBe(false);
    expect(shouldArmSceneryArrival({ ...ready, reducedMotion: true })).toBe(false);
    expect(shouldArmSceneryArrival({ ...ready, threadKey: null })).toBe(false);
  });
});

describe("arrival swap cover", () => {
  it("covers the incoming photo only while fog is up", () => {
    expect(sceneryArrivalCoversSwap("fog")).toBe(true);
    expect(sceneryArrivalCoversSwap("reveal")).toBe(false);
    expect(sceneryArrivalCoversSwap("settled")).toBe(false);
    expect(sceneryArrivalCoversSwap(null)).toBe(false);
  });
});

describe("remaining fog hold", () => {
  it("keeps the full hold when the photo was ready at fog-on", () => {
    expect(remainingFogHoldMs(1000, 1000)).toBe(SCENERY_ARRIVAL.fogHoldMs);
  });

  it("does not drop below the after-ready beat when decode was slow", () => {
    expect(remainingFogHoldMs(0, SCENERY_ARRIVAL.fogHoldMs + 800)).toBe(
      SCENERY_ARRIVAL.fogHoldAfterReadyMs,
    );
  });

  it("shortens the remaining hold by time already spent in fog", () => {
    expect(remainingFogHoldMs(0, 200)).toBe(SCENERY_ARRIVAL.fogHoldMs - 200);
  });
});

describe("played scenery arrivals", () => {
  it("remembers a thread key for the session", () => {
    expect(hasPlayedSceneryArrival("env:a")).toBe(false);
    markSceneryArrivalPlayed("env:a");
    expect(hasPlayedSceneryArrival("env:a")).toBe(true);
    expect(hasPlayedSceneryArrival("env:b")).toBe(false);
  });
});

describe("scenery arrival geometry", () => {
  it("settles after the fog hold plus the longer of travel and clear", () => {
    expect(sceneryArrivalSettleAtMs()).toBe(
      SCENERY_ARRIVAL.fogHoldMs +
        Math.max(SCENERY_ARRIVAL.locationTravelMs, SCENERY_ARRIVAL.fogClearMs),
    );
  });

  it("measures the center-to-center delta used by the location handoff", () => {
    expect(
      measureCenterDelta(
        { left: 0, top: 0, width: 100, height: 40 },
        { left: 20, top: 80, width: 100, height: 40 },
      ),
    ).toEqual({ dx: 20, dy: 80 });
  });
});
