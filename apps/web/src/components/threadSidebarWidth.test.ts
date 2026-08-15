// @effect-diagnostics nodeBuiltinImport:off - Regression coverage compares the sidebar component with its width contract.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarCssWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_DEFAULT_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
} from "./threadSidebarWidth";

describe("thread sidebar width", () => {
  it("uses the default width when no preference is stored", () => {
    expect(resolveInitialThreadSidebarWidth(null)).toBe(THREAD_SIDEBAR_DEFAULT_WIDTH);
  });

  it("uses a stored width in the initial render", () => {
    expect(resolveInitialThreadSidebarWidth(360)).toBe(360);
  });

  it("clamps a stored width to the sidebar minimum", () => {
    expect(resolveInitialThreadSidebarWidth(120)).toBe(THREAD_SIDEBAR_MIN_WIDTH);
  });

  it("keeps stored widths above the current viewport maximum as preferences", () => {
    // The rendered clamp lives in CSS so a window resized without a resize
    // event cannot strand the sidebar; the preference survives to fill a
    // larger window later.
    expect(resolveInitialThreadSidebarWidth(900)).toBe(900);
  });

  it("resolves the maximum against the live viewport", () => {
    expect(resolveThreadSidebarMaximumWidth(1000)).toBe(1000 - THREAD_MAIN_CONTENT_MIN_WIDTH);
    expect(resolveThreadSidebarMaximumWidth(1800)).toBe(1800 - THREAD_MAIN_CONTENT_MIN_WIDTH);
  });

  it("keeps the sidebar minimum when the whole layout is narrower than its minimums", () => {
    expect(resolveThreadSidebarMaximumWidth(700)).toBe(THREAD_SIDEBAR_MIN_WIDTH);
  });

  it("expresses the width with a live viewport clamp", () => {
    expect(resolveThreadSidebarCssWidth(400)).toBe(
      `min(400px, max(${THREAD_SIDEBAR_MIN_WIDTH}px, calc(100vw - ${THREAD_MAIN_CONTENT_MIN_WIDTH}px)))`,
    );
  });

  it("shows the desktop wordmark across the sidebar's full legal width range", () => {
    const sidebarSource = NodeFS.readFileSync(
      new URL("./sidebar/SidebarChrome.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebarSource).toContain("hidden h-7 w-fit min-w-0 shrink-0 items-center gap-1");
    expect(sidebarSource).toContain("md:flex");
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(13 * 16);
  });

  it("puts the environment identification pill behind the stage-label container query", () => {
    // The pill Badge ships its own `inline-flex` utility, which outranks the
    // components-layer `sidebar-brand-stage` display rules — the class must sit
    // on a wrapper without a display utility, or the pill overflows the sidebar
    // header at narrow widths instead of hiding.
    const sidebarChrome = NodeFS.readFileSync(
      new URL("./sidebar/SidebarChrome.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebarChrome).toMatch(
      /className="sidebar-brand-stage[^"]*"[^>]*>\s*<Badge[^>]*data-environment-identification="pill"/s,
    );
  });
});
