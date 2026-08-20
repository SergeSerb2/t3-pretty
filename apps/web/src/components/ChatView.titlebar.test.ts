// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("thread titlebar layout controls", () => {
  it("keeps the layout-control cluster on the workspace root across right-panel toggles", () => {
    const source = NodeFS.readFileSync(new URL("./ChatView.tsx", import.meta.url), "utf8");
    const rootStart = source.indexOf(
      '"relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"',
    );
    const headerStart = source.indexOf("data-chat-header", rootStart);
    const headerEnd = source.indexOf("<ChatHeader", headerStart);

    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(headerStart).toBeGreaterThan(rootStart);
    expect(headerEnd).toBeGreaterThan(headerStart);

    const rootSlice = source.slice(rootStart, headerStart);
    const headerSlice = source.slice(headerStart, headerEnd);

    expect(rootSlice).toContain(
      "{shouldUseRightPanelSheet && rightPanelOpen ? null : panelLayoutControls}",
    );
    expect(headerSlice).not.toContain("panelLayoutControls");
  });
});
