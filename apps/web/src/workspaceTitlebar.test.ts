// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  hideMacosWindowButtonsThenReleaseInset,
  shouldReserveMacosTrafficLights,
  shouldShowMacosWindowButtons,
} from "./workspaceTitlebar";

describe("macOS traffic lights vs collapsed sidebar", () => {
  it("keeps native lights for an expanded desktop sidebar", () => {
    expect(
      shouldReserveMacosTrafficLights({
        isFullscreen: false,
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: true,
      }),
    ).toBe(true);
  });

  it("releases native lights when the desktop sidebar is icon-only", () => {
    expect(
      shouldReserveMacosTrafficLights({
        isFullscreen: false,
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: false,
      }),
    ).toBe(false);
  });

  it("restores native lights while the collapsed desktop sidebar is peeking", () => {
    expect(
      shouldShowMacosWindowButtons({
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: false,
        sidebarPeeking: true,
      }),
    ).toBe(true);
    expect(
      shouldReserveMacosTrafficLights({
        isFullscreen: false,
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: false,
        sidebarPeeking: true,
      }),
    ).toBe(true);
  });

  it("keeps lights in fullscreen-off mobile chrome and drops the inset in fullscreen", () => {
    expect(
      shouldReserveMacosTrafficLights({
        isFullscreen: false,
        isMacosDesktop: true,
        isMobile: true,
        sidebarOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldReserveMacosTrafficLights({
        isFullscreen: true,
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: true,
      }),
    ).toBe(false);
  });

  it("does not latch native buttons hidden just because the window is fullscreen", () => {
    expect(
      shouldShowMacosWindowButtons({
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: true,
      }),
    ).toBe(true);
    expect(
      shouldShowMacosWindowButtons({
        isMacosDesktop: true,
        isMobile: false,
        sidebarOpen: false,
      }),
    ).toBe(false);
  });

  it("hides native lights before the collapsed toggle takes their slot", async () => {
    const order: string[] = [];
    let finishHide: () => void = () => {};
    const hidden = new Promise<void>((resolve) => {
      finishHide = resolve;
    });
    const done = hideMacosWindowButtonsThenReleaseInset({
      hide: () => hidden,
      releaseInset: () => {
        order.push("release");
      },
    });
    order.push("hide-started");
    expect(order).toEqual(["hide-started"]);
    finishHide();
    await done;
    expect(order).toEqual(["hide-started", "release"]);
  });

  it("hides the sidebar toggle while the project rail is at rest", () => {
    const css = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");

    expect(css).toContain(
      `[data-slot="sidebar"][data-collapsed]:not([data-peeking]) ~ [data-sidebar-control] {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}`,
    );
  });

  it("keeps the brand mark on the resting rail and folds only the wordmark", () => {
    const css = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");
    const header = NodeFS.readFileSync(
      new URL("./components/sidebar/SidebarChrome.tsx", import.meta.url),
      "utf8",
    );

    // The brand no longer rides the peek label fade, so the mark stays put.
    const brand = header.slice(
      header.indexOf("function SidebarBrand("),
      header.indexOf("type SidebarUtilityMenuOrientation"),
    );
    expect(brand).toContain('data-sidebar-brand=""');
    expect(brand).toContain('data-sidebar-brand-word=""');
    expect(brand).not.toContain('data-sidebar-peek="label"');

    expect(css).toContain(
      `[data-slot="sidebar"][data-collapsed]:not([data-peeking]) [data-sidebar-brand],
  [data-slot="sidebar"][data-opening]:not([data-opening-ready]) [data-sidebar-brand] {
    margin-left: calc((var(--sidebar-width-icon) - var(--sidebar-brand-mark-width)) / 2);
  }`,
    );
    expect(css).toContain(
      `[data-slot="sidebar"][data-collapsed]:not([data-peeking]) [data-sidebar-brand-word],
  [data-slot="sidebar"][data-opening]:not([data-opening-ready]) [data-sidebar-brand-word] {
    grid-template-columns: 0fr;
    opacity: 0;`,
    );
  });

  it("slides the sidebar toggle with the traffic-light inset", () => {
    const layout = NodeFS.readFileSync(
      new URL("./components/AppSidebarLayout.tsx", import.meta.url),
      "utf8",
    );
    const css = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");

    expect(layout).toContain("data-macos-traffic-lights");
    expect(layout).toContain("hideMacosWindowButtonsThenReleaseInset");
    expect(layout).toContain("setWindowButtonVisibility");
    expect(layout).toContain("sendWindowButtonVisibility(true)");
    expect(layout).toContain("sidebarPeeking: peeking");
    expect(layout).toContain('data-sidebar-control=""');
    expect(layout).not.toContain("MACOS_TRAFFIC_LIGHTS_LEFT_INSET");
    expect(css).toContain("html[data-macos-traffic-lights]");
    expect(css).toContain("var(--desktop-window-controls-inset, 90px)");
    expect(css).toContain("[data-sidebar-control]");
    expect(css).toContain("translate var(--sidebar-peek-duration, 280ms)");
    expect(css).toContain("opacity var(--sidebar-peek-duration, 280ms)");
  });

  it("keeps collapsed-sidebar hover alive through the traffic-light band", () => {
    const css = NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8");
    const header = NodeFS.readFileSync(
      new URL("./components/WorkspacePageHeader.tsx", import.meta.url),
      "utf8",
    );
    const sidebar = NodeFS.readFileSync(
      new URL("./components/ui/sidebar.tsx", import.meta.url),
      "utf8",
    );
    const layout = NodeFS.readFileSync(
      new URL("./components/AppSidebarLayout.tsx", import.meta.url),
      "utf8",
    );

    expect(css).toContain('[data-slot="sidebar"][data-collapsed] [data-slot="sidebar-header"]');
    expect(css).toContain("-webkit-app-region: no-drag");
    expect(header).toContain('data-sidebar-peek-drag-hole=""');
    expect(sidebar).toContain('data-sidebar-peek-hover-bridge=""');
    expect(sidebar).toContain("data-sidebar-peeking={peekFlyout");
    expect(layout).toContain("useSidebarPeekPointerBinding");
    expect(layout).toContain("onPointerEnter={peekPointer.onPointerEnter}");
  });
});
