import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadSidebarCssWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
} from "../threadSidebarWidth";
import { clampSidebarWidth, formatSidebarWidth } from "./sidebarResize";

describe("sidebar resize width", () => {
  it("resolves a max-width getter on every clamp", () => {
    let viewport = 1000;
    const options = {
      minWidth: THREAD_SIDEBAR_MIN_WIDTH,
      maxWidth: () => viewport - THREAD_MAIN_CONTENT_MIN_WIDTH,
    };

    expect(clampSidebarWidth(400, options)).toBe(360);
    viewport = 1400;
    expect(clampSidebarWidth(400, options)).toBe(400);
  });

  it("keeps a preference-backed CSS expression instead of a static pixel width", () => {
    expect(formatSidebarWidth(900, resolveThreadSidebarCssWidth)).toBe(
      `min(900px, max(${THREAD_SIDEBAR_MIN_WIDTH}px, calc(100vw - ${THREAD_MAIN_CONTENT_MIN_WIDTH}px)))`,
    );
  });
});
