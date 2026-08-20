// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("thread titlebar layout controls", () => {
  const source = NodeFS.readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");
  const rootStart = source.indexOf(
    '"relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"',
  );
  const headerStart = source.indexOf("data-chat-header", rootStart);
  const headerEnd = source.indexOf("<ChatHeader", headerStart);
  const headerClose = source.indexOf("</header>", headerStart);
  const controlsRender = "{parkTitlebarLayoutControls ? panelLayoutControls : null}";

  it("keeps the layout-control cluster on the workspace root across right-panel toggles", () => {
    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThan(rootStart);
    expect(headerEnd).toBeGreaterThan(headerStart);

    const headerSlice = source.slice(headerStart, headerEnd);
    const controlsIndex = source.indexOf(controlsRender, rootStart);

    expect(headerSlice).not.toContain("panelLayoutControls");
    expect(controlsIndex).toBeGreaterThan(headerEnd);
    expect(source.slice(rootStart, headerStart)).not.toContain(controlsRender);
    expect(source).toContain(
      "const parkTitlebarLayoutControls = !(shouldUseRightPanelSheet && rightPanelOpen)",
    );
  });

  it("lets clicks reach the cluster through the header drag region", () => {
    const clusterStart = source.indexOf("const panelLayoutControls = (");
    const cluster = source.slice(clusterStart, clusterStart + 900);
    const headerSlice = source.slice(headerStart, headerClose);
    const holeIndex = source.indexOf("data-titlebar-controls-drag-hole", headerStart);

    expect(clusterStart).toBeGreaterThanOrEqual(0);
    expect(cluster).toContain("pointer-events-none");
    expect(cluster).toContain("pointer-events-auto");
    expect(headerSlice).toContain("data-titlebar-controls-drag-hole");
    expect(headerSlice).toContain("[-webkit-app-region:no-drag]");
    expect(headerSlice).toContain("isElectron && parkTitlebarLayoutControls");
    expect(headerSlice).not.toContain("isElectron && !rightPanelOpen");
    expect(headerSlice).not.toContain("w-16");
    expect(headerSlice).toContain("drag-region relative flex");
    expect(holeIndex).toBeGreaterThan(headerEnd);
    expect(holeIndex).toBeLessThan(headerClose);
    expect(headerSlice).toContain(
      "data-titlebar-layout-control-count={titlebarLayoutControlCount}",
    );
  });

  it("sizes the Electron no-drag hole from the mounted control count", () => {
    const css = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toContain("--workspace-titlebar-layout-control-count");
    expect(css).toContain("--workspace-titlebar-layout-cluster-width");
    expect(css).toContain(
      "var(--workspace-titlebar-layout-control-count) * var(--workspace-titlebar-control-size)",
    );
    expect(css).toContain(
      '[data-titlebar-controls-drag-hole][data-titlebar-layout-control-count="3"]',
    );
    expect(source).toContain(
      "const titlebarLayoutControlCount =\n    rightPanelOpen && !shouldUseRightPanelSheet ? 3 : 2",
    );
  });
});
