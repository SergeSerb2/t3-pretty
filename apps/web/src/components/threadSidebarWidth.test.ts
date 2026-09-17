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

    expect(sidebarSource).toContain(
      "hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden",
    );
    expect(sidebarSource).toContain("inline-flex min-w-0 items-center gap-1");
    expect(sidebarSource).toContain("md:flex");
    expect(sidebarSource).toContain('src="/t3-pretty-mark.png"');
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(16 * 16);
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

  it("keeps the rail listening after a tooltip preventDefault", () => {
    const sidebarSource = NodeFS.readFileSync(new URL("./ui/sidebar.tsx", import.meta.url), "utf8");

    expect(sidebarSource).toContain("resize.onPointerDown(event)");
    expect(sidebarSource).toContain("resize.onPointerUp(event)");
    expect(sidebarSource).not.toContain("if (!event.defaultPrevented) resize.onPointerDown");
    expect(sidebarSource).not.toContain("if (!event.defaultPrevented) resize.onPointerUp");
    expect(sidebarSource).toContain("formatSidebarWidth");
    expect(sidebarSource).toContain("options.getCssWidth");
  });

  it("keeps the collapsed icon rail at 3rem and lets the titlebar cover the rest", () => {
    const sidebarSource = NodeFS.readFileSync(new URL("./ui/sidebar.tsx", import.meta.url), "utf8");
    const inset = NodeFS.readFileSync(new URL("../workspaceTitlebar.ts", import.meta.url), "utf8");

    expect(sidebarSource).toContain('"--sidebar-width-icon": SIDEBAR_WIDTH_ICON');
    expect(sidebarSource).not.toContain(
      "`max(${SIDEBAR_WIDTH_ICON}, var(--workspace-controls-left, 0px))`",
    );
    expect(inset).toContain(
      "max(0px,calc(var(--workspace-titlebar-content-left)-var(--sidebar-width-icon)))",
    );
  });

  it("peeks by animating width over an overflow clip, not clip-path", () => {
    const sidebar = NodeFS.readFileSync(new URL("./ui/sidebar.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain("group-data-collapsed:w-(--sidebar-width-icon)");
    expect(sidebar).toContain("group-data-collapsed:group-data-peeking:w-(--sidebar-width)!");
    expect(sidebar).toContain("group-data-collapsed:overflow-hidden");
    expect(sidebar).toContain("group-data-present:overflow-hidden");
    expect(sidebar).toContain("group-data-opening:overflow-hidden");
    expect(sidebar).toContain("w-(--sidebar-width) min-w-(--sidebar-width)");
    expect(sidebar).toContain("motion-safe:transition-[width,box-shadow]");
    expect(sidebar).toContain("group-data-present:z-40");
    expect(sidebar).toContain("group-data-present:shadow-[12px_0_40px_rgba(0,0,0,0.12)]");
    expect(sidebar).toContain("data-opening-ready");
    expect(sidebar).toContain("shouldIgnoreSidebarPeekLeave");
    expect(sidebar).not.toContain("clip-path");
    expect(sidebar).not.toContain("data-compact");
  });

  it("fades the thread pane and settings copy with the peek width", () => {
    const threadSidebar = NodeFS.readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    const settings = NodeFS.readFileSync(
      new URL("./settings/SettingsSidebarNav.tsx", import.meta.url),
      "utf8",
    );
    const chrome = NodeFS.readFileSync(
      new URL("./sidebar/SidebarChrome.tsx", import.meta.url),
      "utf8",
    );
    const css = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");

    expect(threadSidebar).toContain('data-sidebar-peek="pane"');
    expect(settings).toContain('data-sidebar-peek="copy"');
    expect(settings).not.toContain("invisible");
    expect(chrome).toContain('data-sidebar-peek="label"');
    expect(css).toContain('[data-sidebar-peek="pane"]');
    expect(css).toContain("[data-opening]:not([data-opening-ready])");
    expect(css).not.toContain("--sidebar-peek-duration: 280ms");
    expect(css).toContain("var(--sidebar-peek-duration)");
    expect(css).toContain("var(--sidebar-peek-ease)");
  });

  it("keeps the project rail one column whether the sidebar is icon-only or open", () => {
    const rail = NodeFS.readFileSync(
      new URL("./sidebar/SidebarProjectRail.tsx", import.meta.url),
      "utf8",
    );
    const threadSidebar = NodeFS.readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

    expect(rail).not.toContain("variant");
    expect(rail).not.toContain("group-data-compact");
    expect(rail).toContain("w-12 shrink-0");
    expect(threadSidebar).toContain('<SidebarUtilityMenu orientation="vertical" />');
    expect(threadSidebar).not.toContain("showThreadList");
  });
});
