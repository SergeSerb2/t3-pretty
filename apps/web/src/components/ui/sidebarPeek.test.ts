import { describe, expect, it } from "vite-plus/test";

import {
  pointerInSidebarNativeChrome,
  pointerStillInsideSidebarPeek,
  resolveSidebarPeekHold,
  resolveSidebarPeekIntent,
  resolveSidebarPeekLeave,
  shouldRetainSidebarPeek,
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

  it("holds the flyout when a leave fires while the pointer is still inside", () => {
    const anchor = { left: 0, top: 0 };
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 24, y: 200 },
        anchor,
        pointerOverSurface: true,
      }),
    ).toBe("hold");
    expect(
      pointerStillInsideSidebarPeek({
        point: { x: 24, y: 200 },
        rects: [{ left: 0, top: 0, right: 48, bottom: 800 }],
        hovered: false,
      }),
    ).toBe(true);
    expect(
      pointerStillInsideSidebarPeek({
        point: { x: 80, y: 200 },
        rects: [{ left: 0, top: 0, right: 48, bottom: 800 }],
        hovered: true,
      }),
    ).toBe(true);
  });

  it("keeps a hovered flyout across navigation and ignores the collapse click", () => {
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: false,
        peeking: true,
        flyoutPresent: true,
        hovered: true,
      }),
    ).toBe(true);
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: false,
        peeking: true,
        flyoutPresent: true,
        hovered: false,
      }),
    ).toBe(false);
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: true,
        peeking: false,
        flyoutPresent: false,
        hovered: true,
      }),
    ).toBe(false);
    expect(
      resolveSidebarPeekHold({
        peeking: true,
        flyoutPresent: true,
        suppressUntilExit: false,
      }),
    ).toBe("keep-open");
    expect(
      resolveSidebarPeekHold({
        peeking: false,
        flyoutPresent: false,
        suppressUntilExit: true,
      }),
    ).toBe("stay-closed");
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
