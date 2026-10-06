import { describe, expect, it } from "vite-plus/test";

import {
  resolveTrailheadGate,
  trailheadKicker,
  trailheadStepAfter,
  trailheadStepBefore,
} from "./trailhead.logic";

describe("resolveTrailheadGate", () => {
  const base = {
    preferencesLoaded: true,
    onboardingCompletedAt: undefined,
    catalogReady: true,
    hasConnections: false,
  };

  it("waits for preferences before anything else", () => {
    expect(resolveTrailheadGate({ ...base, preferencesLoaded: false })).toBe("wait");
  });

  it("never shows again once completed, even before the catalog loads", () => {
    expect(
      resolveTrailheadGate({
        ...base,
        onboardingCompletedAt: "2026-10-05T00:00:00.000Z",
        catalogReady: false,
      }),
    ).toBe("skip");
  });

  it("waits for the connection catalog on a fresh device", () => {
    expect(resolveTrailheadGate({ ...base, catalogReady: false })).toBe("wait");
  });

  it("silently acknowledges installs that already have connections", () => {
    expect(resolveTrailheadGate({ ...base, hasConnections: true })).toBe("acknowledge");
  });

  it("shows on a fresh install with nothing paired", () => {
    expect(resolveTrailheadGate(base)).toBe("show");
  });
});

describe("trailhead steps", () => {
  it("walks every stop when notifications still need asking", () => {
    const options = { skipNotify: false };
    expect(trailheadStepAfter("welcome", options)).toBe("connect");
    expect(trailheadStepAfter("connect", options)).toBe("notify");
    expect(trailheadStepAfter("notify", options)).toBe("summit");
    expect(trailheadStepAfter("summit", options)).toBe("summit");
    expect(trailheadStepBefore("summit", options)).toBe("notify");
    expect(trailheadStepBefore("welcome", options)).toBeNull();
  });

  it("steps over the ridge in both directions when it is skipped", () => {
    const options = { skipNotify: true };
    expect(trailheadStepAfter("connect", options)).toBe("summit");
    expect(trailheadStepBefore("summit", options)).toBe("connect");
  });

  it("numbers the kicker by stop", () => {
    expect(trailheadKicker("connect")).toBe("02 · BASE CAMP");
  });
});
