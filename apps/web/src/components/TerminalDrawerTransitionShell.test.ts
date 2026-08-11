// @effect-diagnostics nodeBuiltinImport:off - Module-scope raw CSS fixture loading has no Effect test scope.
import * as NodeFS from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TerminalDrawerTransitionShell } from "./TerminalDrawerTransitionShell";

// ?raw on a .css module yields "" under the test pipeline (the CSS transform
// wins), so the stylesheet contract reads the file straight from disk.
const indexCssSource = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");

function renderTerminalDrawerShell(
  options?: Partial<
    Pick<
      ComponentProps<typeof TerminalDrawerTransitionShell>,
      "active" | "height" | "open" | "resizing"
    >
  >,
): string {
  const props: ComponentProps<typeof TerminalDrawerTransitionShell> = {
    active: options?.active ?? true,
    height: options?.height ?? 320,
    open: options?.open ?? true,
    resizing: options?.resizing ?? false,
    onExitComplete: () => undefined,
    children: createElement("div", null, "Terminal content"),
  };
  return renderToStaticMarkup(TerminalDrawerTransitionShell(props));
}

function terminalDrawerCssBlock(): string {
  const start = indexCssSource.indexOf(".terminal-drawer-inline-gap {");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = indexCssSource.indexOf(".chat-composer-horizontal-inset", start);
  expect(end).toBeGreaterThan(start);
  return indexCssSource.slice(start, end);
}

describe("TerminalDrawerTransitionShell", () => {
  it("isolates the fixed-height terminal surface from the animated layout gap", () => {
    const html = renderTerminalDrawerShell();

    expect(html).toContain("terminal-drawer-inline-gap");
    expect(html).toContain("terminal-drawer-inline-surface");
    expect(html).toContain("--terminal-drawer-height:320px");
    expect(html).toContain('data-terminal-drawer-open="true"');
  });

  it("keeps the closing terminal mounted but non-interactive", () => {
    const html = renderTerminalDrawerShell({ open: false });

    expect(html).toContain('data-terminal-drawer-open="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain("Terminal content");
  });

  it("disables layout motion while the drawer is being resized", () => {
    const html = renderTerminalDrawerShell({ resizing: true });

    expect(html).toContain('data-terminal-drawer-resizing="true"');
  });

  it("keeps inactive thread terminals mounted and hidden", () => {
    const html = renderTerminalDrawerShell({ active: false });

    expect(html).toContain("terminal-drawer-inline-frame hidden");
    expect(html).toContain('data-terminal-drawer-active="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Terminal content");
  });

  it("defaults the drawer gap closed so opening does not flash full height", () => {
    // Open-as-base + @starting-style undoing it first-paints the full gap,
    // snaps to 0, then animates open — the docked composer wiggles up/down.
    const css = terminalDrawerCssBlock();
    const gapRule = css.match(/\.terminal-drawer-inline-gap \{[^}]+\}/)?.[0] ?? "";
    const openGapRule =
      css.match(
        /\.terminal-drawer-inline-gap\[data-terminal-drawer-open="true"\] \{[^}]+\}/,
      )?.[0] ?? "";
    const surfaceRule = css.match(/\.terminal-drawer-inline-surface \{[^}]+\}/)?.[0] ?? "";
    const openSurfaceRule =
      css.match(
        /\.terminal-drawer-inline-gap\[data-terminal-drawer-open="true"\] \.terminal-drawer-inline-surface \{[^}]+\}/,
      )?.[0] ?? "";

    expect(gapRule).toContain("height: 0");
    expect(gapRule).not.toContain("var(--terminal-drawer-height)");
    expect(openGapRule).toContain("height: var(--terminal-drawer-height)");
    expect(surfaceRule).toContain("translate: 0 100%");
    expect(openSurfaceRule).toContain("translate: 0");
    expect(css).not.toContain('[data-terminal-drawer-open="false"]');
  });
});
