import { describe, expect, it } from "vite-plus/test";

import {
  deriveThreadFeedListFooterInset,
  resolveThreadFeedEndOffset,
} from "./thread-feed-end-scroll";

describe("deriveThreadFeedListFooterInset", () => {
  it("uses the full overlay height when the list owns the bottom inset", () => {
    expect(
      deriveThreadFeedListFooterInset({
        usesNativeAutomaticInsets: false,
        composerOverlayHeight: 94,
        safeAreaBottom: 34,
      }),
    ).toBe(94);
  });

  it("subtracts the home-indicator strip when UIKit adds it automatically", () => {
    expect(
      deriveThreadFeedListFooterInset({
        usesNativeAutomaticInsets: true,
        composerOverlayHeight: 94,
        safeAreaBottom: 34,
      }),
    ).toBe(60);
  });

  it("does not produce a negative footer when the overlay is still smaller than the safe area", () => {
    expect(
      deriveThreadFeedListFooterInset({
        usesNativeAutomaticInsets: true,
        composerOverlayHeight: 20,
        safeAreaBottom: 34,
      }),
    ).toBe(0);
  });
});

describe("resolveThreadFeedEndOffset", () => {
  it("does not treat the native top-rest as the end of a viewport-padded short thread", () => {
    const headerInset = 103;
    expect(
      resolveThreadFeedEndOffset({
        contentSize: 852,
        scrollLength: 852,
        insetStartAdjustment: headerInset,
        insetEnd: 0,
      }),
    ).toBe(0);
    expect(-headerInset).toBe(-103);
  });

  it("adds a separate end inset when content-size does not already include it", () => {
    expect(
      resolveThreadFeedEndOffset({
        contentSize: 852,
        scrollLength: 852,
        insetStartAdjustment: 103,
        insetEnd: 34,
      }),
    ).toBe(34);
  });

  it("keeps overflowing threads at content-size minus the viewport plus the end inset", () => {
    expect(
      resolveThreadFeedEndOffset({
        contentSize: 2400,
        scrollLength: 852,
        insetStartAdjustment: 103,
        insetEnd: 34,
      }),
    ).toBe(1582);
  });

  it("clamps true underflow to the header rest instead of a large negative offset", () => {
    expect(
      resolveThreadFeedEndOffset({
        contentSize: 200,
        scrollLength: 852,
        insetStartAdjustment: 103,
        insetEnd: 34,
      }),
    ).toBe(-103);
  });
});
