// @effect-diagnostics nodeBuiltinImport:off - Module-scope raw CSS fixture loading has no Effect test scope.
import * as NodeFS from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth, PreviewPanelShell } from "./PreviewPanelShell";

// ?raw on a .css module yields "" under the test pipeline (the CSS transform
// wins), so the stylesheet contract reads the file straight from disk.
const indexCssSource = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");

function rightPanelCssBlock(): string {
  const start = indexCssSource.indexOf(".right-panel-inline-gap {");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = indexCssSource.indexOf(".terminal-drawer-inline-gap {", start);
  expect(end).toBeGreaterThan(start);
  return indexCssSource.slice(start, end);
}

function renderPreviewPanelShell(
  mode: ComponentProps<typeof PreviewPanelShell>["mode"],
  options?: { open?: boolean; maximized?: boolean; defaultWidth?: number },
): string {
  const props: ComponentProps<typeof PreviewPanelShell> = {
    mode,
    ...(options?.open !== undefined ? { open: options.open } : {}),
    ...(options?.maximized !== undefined ? { maximized: options.maximized } : {}),
    ...(options?.defaultWidth !== undefined ? { defaultWidth: options.defaultWidth } : {}),
    children: createElement("div", null, "Panel content"),
  };
  return renderToStaticMarkup(createElement(PreviewPanelShell, props));
}

describe("getPreviewPanelMaxWidth", () => {
  it("allows the panel to use 70% of an ultra-wide viewport without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(6_000)).toBe(4_200);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });

  it("keeps inline panels inside their containing workspace", () => {
    const html = renderPreviewPanelShell("inline", { defaultWidth: 1_000 });

    expect(html).toContain("max-w-full");
  });
});

describe("PreviewPanelShell", () => {
  it("isolates the inline panel surface from the animated layout gap", () => {
    const html = renderPreviewPanelShell("inline");

    expect(html).toContain("right-panel-inline-gap");
    expect(html).toContain("right-panel-inline-surface");
    expect(html).toContain("--right-panel-width:540px");
    expect(html).toContain('data-preview-panel-mode="inline"');
    expect(html).toContain('data-right-panel-open="true"');
  });

  it("exposes the closed state while the inline panel exits", () => {
    const html = renderPreviewPanelShell("inline", { open: false });

    expect(html).toContain('data-right-panel-open="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain("right-panel-inline-surface");
  });

  it("keeps stable inline wrappers when maximized state changes", () => {
    const inlineHtml = renderPreviewPanelShell("inline");
    const maximizedHtml = renderPreviewPanelShell("inline", { maximized: true });

    for (const html of [inlineHtml, maximizedHtml]) {
      expect(html).toContain("right-panel-inline-frame");
      expect(html).toContain("right-panel-inline-body");
      expect(html).toContain("Panel content");
    }
    expect(maximizedHtml).toContain('data-preview-panel-maximized="true"');
    expect(maximizedHtml).not.toContain("right-panel-inline-gap");
    expect(maximizedHtml).toContain("right-panel-inline-surface");
    expect(maximizedHtml).not.toContain("right-panel-inline-maximized-exit");
  });

  it("keeps a maximized panel full-width while its surface exits", () => {
    const html = renderPreviewPanelShell("inline", { open: false, maximized: true });

    expect(html).toContain("right-panel-inline-maximized-exit");
    expect(html).toContain("z-40");
    expect(html).not.toContain("z-10");
    expect(html).toContain("right-panel-inline-surface");
    expect(html).toContain('data-preview-panel-maximized="true"');
    expect(html).toContain('data-right-panel-open="false"');
    expect(html).not.toContain("right-panel-inline-gap");
  });

  it("does not apply the inline opening layout to sheet panels", () => {
    const html = renderPreviewPanelShell("sheet");

    expect(html).not.toContain("right-panel-inline-gap");
    expect(html).not.toContain("right-panel-inline-surface");
    expect(html).toContain('data-right-panel-open="true"');
  });

  it("defaults the inline gap closed so opening does not flash full width", () => {
    // The panel mounts closed and flips open a frame later, so closed must be
    // the base rule (open-as-base first-paints the full gap and snaps back).
    const css = rightPanelCssBlock();
    const gapRule = css.match(/\.right-panel-inline-gap \{[^}]+\}/)?.[0] ?? "";
    const openGapRule =
      css.match(/\.right-panel-inline-gap\[data-right-panel-open="true"\] \{[^}]+\}/)?.[0] ?? "";
    const surfaceRule = css.match(/\.right-panel-inline-surface \{[^}]+\}/)?.[0] ?? "";
    const openSurfaceRule =
      css.match(
        /\.right-panel-inline-frame\[data-right-panel-open="true"\] \.right-panel-inline-surface \{[^}]+\}/,
      )?.[0] ?? "";

    expect(gapRule).toContain("width: 0");
    expect(gapRule).not.toContain("var(--right-panel-width)");
    expect(openGapRule).toContain("width: var(--right-panel-width)");
    expect(surfaceRule).toContain("translate: 100%");
    expect(openSurfaceRule).toContain("translate: 0");
    expect(css).not.toContain('[data-right-panel-open="false"]');
    expect(css).not.toContain("@starting-style {");
  });

  it("reserves the sibling column minimum when the flex row is known", () => {
    // Fullscreen 14" MacBook: viewport 1512, sidebar ~256 → row of 1256.
    // The 70% fraction (1058) would leave the chat column only ~198px;
    // the container clamp caps the panel at 1256 − 360 instead.
    expect(getPreviewPanelMaxWidth(1_512, 1_256)).toBe(896);
  });

  it("keeps the fraction cap when the row is wide enough for both columns", () => {
    expect(getPreviewPanelMaxWidth(3_000, 2_900)).toBe(2_100);
  });

  it("rounds fractional row widths down", () => {
    expect(getPreviewPanelMaxWidth(1_512, 1_256.6)).toBe(896);
  });

  it("never drops below the panel minimum when the row cannot fit both columns", () => {
    // ~1000px window with an expanded sidebar → row of 700. The sibling
    // reservation (700 − 360 = 340) would undercut the panel's own 360
    // minimum and invert the resize clamp, so the floor wins.
    expect(getPreviewPanelMaxWidth(1_000, 700)).toBe(360);
  });

  it("stays at the panel minimum even when the row is narrower than the reservation", () => {
    expect(getPreviewPanelMaxWidth(1_512, 300)).toBe(360);
  });
});
