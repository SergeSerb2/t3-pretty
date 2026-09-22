// @effect-diagnostics nodeBuiltinImport:off - Source contract reads sidebarPeek.ts from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  findSidebarPeekContainer,
  pointerInSidebarNativeChrome,
  pointerStillInsideSidebarPeek,
  resolveSidebarPeekHold,
  resolveSidebarPeekIntent,
  resolveSidebarPeekLeave,
  shouldKeepSidebarPeekCollapseSuppress,
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

  it("keeps collapse suppress while the last point is still inside the rail", () => {
    const rail = [{ left: 0, top: 0, right: 48, bottom: 800 }];
    expect(
      shouldKeepSidebarPeekCollapseSuppress({
        suppressUntilExit: true,
        point: { x: 24, y: 200 },
        rects: rail,
        hovered: false,
      }),
    ).toBe(true);
    expect(
      shouldKeepSidebarPeekCollapseSuppress({
        suppressUntilExit: true,
        point: { x: 80, y: 200 },
        rects: rail,
        hovered: false,
      }),
    ).toBe(false);
    expect(
      shouldKeepSidebarPeekCollapseSuppress({
        suppressUntilExit: false,
        point: { x: 24, y: 200 },
        rects: rail,
        hovered: false,
      }),
    ).toBe(false);
  });

  it("does not treat leaving-node :hover as inside on collapse leave", () => {
    const rail = [{ left: 0, top: 0, right: 48, bottom: 800 }];
    // Collapse leave passes hovered: false. A point outside the rail drops
    // the gate; the leaving node's :hover is not consulted.
    expect(
      shouldKeepSidebarPeekCollapseSuppress({
        suppressUntilExit: true,
        point: { x: 80, y: 200 },
        rects: rail,
        hovered: false,
      }),
    ).toBe(false);

    const source = NodeFS.readFileSync(new URL("./sidebarPeek.ts", import.meta.url), "utf8");
    const leave = source.slice(
      source.indexOf("const onPeekPointerLeave"),
      source.indexOf("const onPeekPointerHold"),
    );
    expect(leave).toContain("hovered: false");
    expect(leave).not.toContain("sidebarPeekSurfaceIsHovered()");

    const release = source.slice(
      source.indexOf("if (!suppressHoverOpen) return"),
      source.indexOf("}, [suppressHoverOpen]"),
    );
    expect(release).toContain("hovered: false");
    expect(release).not.toContain("sidebarPeekSurfaceIsHovered()");
  });

  it("forwards the pointer event on both peek enter and leave", () => {
    const sidebar = NodeFS.readFileSync(new URL("./sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("peekPointer.onPointerEnter(event)");
    expect(sidebar).toContain("peekPointer.onPointerLeave(event)");
  });

  it("walks only the event target chain for the peek container", () => {
    const source = NodeFS.readFileSync(new URL("./sidebarPeek.ts", import.meta.url), "utf8");
    expect(source).toContain("target.closest(\"[data-slot='sidebar-container']\")");
    expect(source).not.toContain("document.querySelector(\"[data-slot='sidebar-container']\")");
    expect(findSidebarPeekContainer(null)).toBeNull();
    expect(
      pointerStillInsideSidebarPeek({
        point: { x: 10, y: 10 },
        rects: [],
        hovered: false,
      }),
    ).toBe(false);
  });

  it("holds the flyout when a leave fires while the pointer is still inside", () => {
    const anchor = { left: 0, top: 0 };
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 24, y: 200 },
        anchor,
        pointerOverSurface: pointerStillInsideSidebarPeek({
          point: { x: 24, y: 200 },
          rects: [{ left: 0, top: 0, right: 48, bottom: 800 }],
          hovered: false,
        }),
      }),
    ).toBe("hold");
    expect(
      resolveSidebarPeekLeave({
        currentTarget: null,
        relatedTarget: null,
        pointer: { x: 80, y: 200 },
        anchor,
        pointerOverSurface: pointerStillInsideSidebarPeek({
          point: { x: 80, y: 200 },
          rects: [{ left: 0, top: 0, right: 48, bottom: 800 }],
          hovered: false,
        }),
      }),
    ).toBe("close");
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
    const rail = [{ left: 0, top: 0, right: 48, bottom: 800 }];
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: false,
        peeking: true,
        flyoutPresent: true,
        hovered: false,
        point: { x: 24, y: 200 },
        rects: rail,
      }),
    ).toBe(true);
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: false,
        peeking: true,
        flyoutPresent: true,
        hovered: false,
        point: { x: 80, y: 200 },
        rects: rail,
      }),
    ).toBe(false);
    expect(
      shouldRetainSidebarPeek({
        enabled: true,
        suppressUntilExit: true,
        peeking: false,
        flyoutPresent: false,
        hovered: false,
        point: { x: 24, y: 200 },
        rects: rail,
      }),
    ).toBe(false);

    const source = NodeFS.readFileSync(new URL("./sidebarPeek.ts", import.meta.url), "utf8");
    const retain = source.slice(
      source.indexOf("const retainPeekIfHovered"),
      source.indexOf("useEffect(() => {\n    if (!enabled) hideNow();"),
    );
    expect(retain).toContain("hovered: false");
    expect(retain).not.toContain("sidebarPeekSurfaceIsHovered()");
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
