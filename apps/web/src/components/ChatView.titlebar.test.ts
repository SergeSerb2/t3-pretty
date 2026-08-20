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
  const controlsRender =
    "{shouldUseRightPanelSheet && rightPanelOpen ? null : panelLayoutControls}";

  it("keeps the layout-control cluster on the workspace root across right-panel toggles", () => {
    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThan(rootStart);
    expect(headerEnd).toBeGreaterThan(headerStart);

    const headerSlice = source.slice(headerStart, headerEnd);
    const controlsIndex = source.indexOf(controlsRender, rootStart);

    expect(headerSlice).not.toContain("panelLayoutControls");
    expect(controlsIndex).toBeGreaterThan(headerEnd);
    expect(source.slice(rootStart, headerStart)).not.toContain(controlsRender);
  });

  it("lets clicks reach the cluster through the header drag region", () => {
    const clusterStart = source.indexOf("const panelLayoutControls = (");
    const cluster = source.slice(clusterStart, clusterStart + 900);
    const headerSlice = source.slice(headerStart, headerEnd);

    expect(clusterStart).toBeGreaterThanOrEqual(0);
    expect(cluster).toContain("pointer-events-none");
    expect(cluster).toContain("pointer-events-auto");
    expect(headerSlice).toContain("data-titlebar-controls-drag-hole");
    expect(headerSlice).toContain("[-webkit-app-region:no-drag]");
  });
});
