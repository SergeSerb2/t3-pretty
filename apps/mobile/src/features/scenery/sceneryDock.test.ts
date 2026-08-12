import { describe, expect, it } from "vite-plus/test";

import {
  deriveFloatingChromeBottomInset,
  deriveMailSearchToolbarBottomSpacing,
  SCENERY_CREDIT_GAP,
  SCENERY_CREDIT_HEIGHT,
  SCENERY_CREDIT_MIN_BOTTOM,
} from "./sceneryDock";

describe("deriveFloatingChromeBottomInset", () => {
  it("drops the inset while the composer is at the keyboard edge", () => {
    expect(
      deriveFloatingChromeBottomInset({
        isAtKeyboardEdge: true,
        platform: "ios",
        safeAreaBottom: 34,
        creditHeight: SCENERY_CREDIT_HEIGHT,
      }),
    ).toBe(0);
  });

  it("docks iOS chrome to the physical bottom instead of the home-indicator inset", () => {
    expect(
      deriveFloatingChromeBottomInset({
        isAtKeyboardEdge: false,
        platform: "ios",
        safeAreaBottom: 34,
        creditHeight: 0,
      }),
    ).toBe(SCENERY_CREDIT_MIN_BOTTOM);
    expect(
      deriveFloatingChromeBottomInset({
        isAtKeyboardEdge: false,
        platform: "ios",
        safeAreaBottom: 34,
        creditHeight: SCENERY_CREDIT_HEIGHT,
      }),
    ).toBe(SCENERY_CREDIT_MIN_BOTTOM + SCENERY_CREDIT_HEIGHT);
  });

  it("keeps Android chrome above the system navigation inset", () => {
    expect(
      deriveFloatingChromeBottomInset({
        isAtKeyboardEdge: false,
        platform: "android",
        safeAreaBottom: 48,
        creditHeight: SCENERY_CREDIT_HEIGHT,
      }),
    ).toBe(48 + SCENERY_CREDIT_HEIGHT);
    expect(
      deriveFloatingChromeBottomInset({
        isAtKeyboardEdge: false,
        platform: "android",
        safeAreaBottom: 0,
        creditHeight: 0,
      }),
    ).toBe(12);
  });
});

describe("deriveMailSearchToolbarBottomSpacing", () => {
  it("sits 8pt above the physical bottom when no credit pill is showing", () => {
    expect(deriveMailSearchToolbarBottomSpacing(false)).toBe(SCENERY_CREDIT_MIN_BOTTOM);
  });

  it("reserves the credit pill under the search bar", () => {
    expect(deriveMailSearchToolbarBottomSpacing(true)).toBe(
      SCENERY_CREDIT_MIN_BOTTOM + SCENERY_CREDIT_HEIGHT + SCENERY_CREDIT_GAP,
    );
  });
});
