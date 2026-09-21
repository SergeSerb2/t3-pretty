import { describe, expect, it } from "vite-plus/test";

import {
  pointerInSidebarNativeChrome,
  resolveSidebarPeekIntent,
  resolveSidebarPeekLeave,
  SIDEBAR_PEEK_ANIMATION_MS,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_NATIVE_CHROME_HEIGHT_PX,
  SIDEBAR_PEEK_NATIVE_CHROME_WIDTH_PX,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  shouldIgnoreSidebarPeekLeave,
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

  it("keeps the overlay mounted through the close width animation", () => {
    expect(SIDEBAR_PEEK_ANIMATION_MS).toBe(280);
  });

  it("does not ignore a leave into nowhere", () => {
    expect(shouldIgnoreSidebarPeekLeave(null, null)).toBe(false);
  });

  it("holds the flyout when the pointer enters the macOS traffic-light pad", () => {
    const anchor = { left: 0, top: 0 };
    expect(
      pointerInSidebarNativeChrome({ x: SIDEBAR_PEEK_NATIVE_CHROME_WIDTH_PX - 1, y: 20 }, anchor),
    ).toBe(true);
    expect(
      pointerInSidebarNativeChrome(
        { x: SIDEBAR_PEEK_NATIVE_CHROME_WIDTH_PX + 8, y: SIDEBAR_PEEK_NATIVE_CHROME_HEIGHT_PX },
        anchor,
      ),
    ).toBe(false);
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 40, y: 16 },
        anchor,
      }),
    ).toBe("hold");
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 180, y: 16 },
        anchor,
      }),
    ).toBe("close");
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 40, y: 200 },
        anchor,
      }),
    ).toBe("close");
  });
});
