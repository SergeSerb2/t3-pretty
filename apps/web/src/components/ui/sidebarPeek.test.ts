import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarPeekIntent,
  SIDEBAR_PEEK_ANIMATION_MS,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  sidebarPeekDatasetValue,
} from "./sidebarPeek";

describe("sidebar peek", () => {
  it("opens on a short hover delay, and immediately when already peeking", () => {
    expect(resolveSidebarPeekIntent(false, "pointer-enter")).toEqual({
      peeking: true,
      delayMs: SIDEBAR_PEEK_OPEN_DELAY_MS,
    });
    expect(resolveSidebarPeekIntent(true, "pointer-enter")).toEqual({
      peeking: true,
      delayMs: 0,
    });
  });

  it("reopens immediately while the flyout is still leaving", () => {
    expect(resolveSidebarPeekIntent(false, "pointer-enter", true)).toEqual({
      peeking: true,
      delayMs: 0,
    });
  });

  it("keeps the flyout until the pointer has left for a beat", () => {
    expect(resolveSidebarPeekIntent(true, "pointer-leave")).toEqual({
      peeking: false,
      delayMs: SIDEBAR_PEEK_CLOSE_DELAY_MS,
    });
  });

  it("lets a project click show the flyout without waiting, and a pin-open dismisses it", () => {
    expect(resolveSidebarPeekIntent(false, "peek-now")).toEqual({ peeking: true, delayMs: 0 });
    expect(resolveSidebarPeekIntent(true, "hide-now")).toEqual({ peeking: false, delayMs: 0 });
  });

  it("keeps the overlay mounted while the close clip plays", () => {
    expect(sidebarPeekDatasetValue(true, true)).toBe("true");
    expect(sidebarPeekDatasetValue(true, false)).toBe("out");
    expect(sidebarPeekDatasetValue(false, false)).toBeUndefined();
    expect(SIDEBAR_PEEK_ANIMATION_MS).toBe(220);
  });
});
