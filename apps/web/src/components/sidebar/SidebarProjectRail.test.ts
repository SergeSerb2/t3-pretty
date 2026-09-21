// @effect-diagnostics nodeBuiltinImport:off - Module-scope source contract reads have no Effect test scope.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const railSource = NodeFS.readFileSync(
  new URL("./SidebarProjectRail.tsx", import.meta.url),
  "utf8",
);
const indexCssSource = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("project rail folders", () => {
  it("draws an open folder as a tray and leaves a closed folder as a plain icon", () => {
    expect(railSource).toContain(
      "bg-[color-mix(in_srgb,var(--sidebar-foreground)_12%,var(--sidebar))]",
    );
    expect(railSource).toContain("!item.folder.collapsed && RAIL_FOLDER_TRAY_CLASS");
    expect(railSource).not.toContain("FolderRailContentsPreview");
    expect(railSource).not.toContain("project-rail-folder");
    expect(railSource).not.toContain("folderRailPreviewProjects");
    expect(indexCssSource).not.toContain("project-rail-folder");
  });
});
