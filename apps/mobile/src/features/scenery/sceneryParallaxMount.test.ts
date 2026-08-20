import { describe, expect, it } from "vite-plus/test";

import { shouldMountSceneryParallax } from "./sceneryParallaxMount";

describe("shouldMountSceneryParallax", () => {
  it("mounts gyro parallax only when 3D is on and Reduce Motion is off", () => {
    expect(shouldMountSceneryParallax(true, false)).toBe(true);
  });

  it("keeps the static photo when Reduce Motion is on or still unknown-as-parked", () => {
    expect(shouldMountSceneryParallax(true, true)).toBe(false);
    expect(shouldMountSceneryParallax(false, false)).toBe(false);
    expect(shouldMountSceneryParallax(false, true)).toBe(false);
  });
});
