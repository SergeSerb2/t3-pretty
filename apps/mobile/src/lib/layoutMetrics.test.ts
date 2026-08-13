import { describe, expect, it } from "vite-plus/test";

import { IOS_COMPACT_NAVIGATION_BAR_HEIGHT, nativeGlassHeaderOverlapInset } from "./layoutMetrics";

describe("nativeGlassHeaderOverlapInset", () => {
  it("is zero when the header already occupies layout space", () => {
    expect(
      nativeGlassHeaderOverlapInset({
        glassSupported: false,
        headerHeight: 103,
        safeAreaTop: 59,
      }),
    ).toBe(0);
  });

  it("uses the measured navigation header when glass overlays the screen", () => {
    expect(
      nativeGlassHeaderOverlapInset({
        glassSupported: true,
        headerHeight: 103,
        safeAreaTop: 59,
      }),
    ).toBe(103);
  });

  it("falls back to the compact bar below the status area", () => {
    expect(
      nativeGlassHeaderOverlapInset({
        glassSupported: true,
        headerHeight: 0,
        safeAreaTop: 59,
      }),
    ).toBe(59 + IOS_COMPACT_NAVIGATION_BAR_HEIGHT);
  });
});
