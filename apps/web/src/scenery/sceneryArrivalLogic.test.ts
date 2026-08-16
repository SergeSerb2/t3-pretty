import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  hasPlayedSceneryArrival,
  markSceneryArrivalPlayed,
  measureCenterDelta,
  resetPlayedSceneryArrivals,
  sceneryArrivalSettleAtMs,
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
