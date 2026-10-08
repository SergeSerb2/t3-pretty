import { describe, expect, it } from "vite-plus/test";

import {
  formatTrailheadAltitude,
  TRAILHEAD_RIDGE_POINTS,
  trailheadAltitudeAt,
  trailheadRidgePath,
  trailheadRidgeY,
} from "./trailhead";

describe("trailheadRidgeY", () => {
  it("passes through every hand-placed point", () => {
    for (const [x, y] of TRAILHEAD_RIDGE_POINTS) {
      expect(trailheadRidgeY(x)).toBe(y);
    }
  });

  it("interpolates between points and clamps outside the ridge", () => {
    expect(trailheadRidgeY(-50)).toBe(186);
    expect(trailheadRidgeY(1200)).toBe(60);
    expect(trailheadRidgeY(27.5)).toBe(182);
  });
});

describe("trailheadRidgePath", () => {
  it("starts at the trailhead and ends at the last point", () => {
    const path = trailheadRidgePath();
    expect(path.startsWith("M0 186 C")).toBe(true);
    expect(path.endsWith("1000 60")).toBe(true);
  });

  it("closes to the bottom edge for a filled silhouette", () => {
    expect(trailheadRidgePath({ closed: true }).endsWith("L1000 200 L0 200 Z")).toBe(true);
  });
});

describe("formatTrailheadAltitude", () => {
  it("groups thousands with a thin space", () => {
    expect(formatTrailheadAltitude(3812.4)).toBe("3 812 m");
    expect(formatTrailheadAltitude(980)).toBe("980 m");
    expect(formatTrailheadAltitude(-4)).toBe("0 m");
  });
});

describe("trailheadAltitudeAt", () => {
  it("lands exactly on both ends and eases in between", () => {
    expect(trailheadAltitudeAt(1200, 2400, 0)).toBe(1200);
    expect(trailheadAltitudeAt(1200, 2400, 1)).toBe(2400);
    expect(trailheadAltitudeAt(1200, 2400, 0.5)).toBeGreaterThan(1800);
    expect(trailheadAltitudeAt(2400, 1200, 2)).toBe(1200);
  });
});
