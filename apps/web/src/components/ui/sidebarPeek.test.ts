import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarPeekIntent,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
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
});
