// @effect-diagnostics nodeBuiltinImport:off - Module-scope source contract reads have no Effect test scope.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const railSource = NodeFS.readFileSync(
  new URL("./SidebarProjectRail.tsx", import.meta.url),
  "utf8",
);
const folderCssSource = NodeFS.readFileSync(
  new URL("./projectRailFolder.css", import.meta.url),
  "utf8",
);
const indexCssSource = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("project rail folders", () => {
  it("draws an open folder as a tray the same width as an icon button", () => {
    expect(railSource).toContain(
      "bg-[color-mix(in_srgb,var(--sidebar-foreground)_12%,var(--sidebar))]",
    );
    expect(railSource).toContain("rail-folder-tray relative isolate flex w-8");
    expect(railSource).toContain("rounded-[var(--control-radius)]");
    expect(railSource).not.toContain("px-1 py-1");
    expect(railSource).not.toContain("FolderRailContentsPreview");
    expect(railSource).not.toContain("project-rail-folder");
    expect(railSource).not.toContain("folderRailPreviewProjects");
    expect(indexCssSource).not.toContain("project-rail-folder");
    expect(folderCssSource).not.toContain("project-rail-folder");
    expect(folderCssSource).toContain("grid-template-rows: 0fr");
    expect(folderCssSource).toContain("grid-template-rows: 1fr");
    expect(folderCssSource).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(folderCssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(folderCssSource).not.toContain("scale(0)");
  });

  it("shows a live thread count instead of shortcut indexes", () => {
    expect(railSource).not.toContain("visibleProjectJumpNumbers");
    expect(railSource).not.toContain("jumpNumber");
    expect(railSource).toContain("projectRailActivityMark");
    expect(railSource).toContain("formatProjectRailActivity");
  });
});
