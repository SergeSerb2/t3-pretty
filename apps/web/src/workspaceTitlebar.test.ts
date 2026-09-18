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
    expect(layout).toContain('data-sidebar-control=""');
    expect(layout).not.toContain("MACOS_TRAFFIC_LIGHTS_LEFT_INSET");
    expect(css).toContain("html[data-macos-traffic-lights]");
    expect(css).toContain("var(--desktop-window-controls-inset, 90px)");
    expect(css).toContain("[data-sidebar-control]");
    expect(css).toContain("transition: translate");
  });
});
