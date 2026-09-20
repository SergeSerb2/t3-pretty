// @effect-diagnostics nodeBuiltinImport:off - Module-scope source/CSS contract reads have no Effect test scope.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const railSource = NodeFS.readFileSync(new URL("./SidebarProjectRail.tsx", import.meta.url), "utf8");
const indexCssSource = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("folder rail stacking", () => {
  it("keeps every folder glyph on a positioned layer above the glass sheen", () => {
    expect(railSource).toContain(
      'const FOLDER_RAIL_GLYPH_CLASS = "relative z-10 drop-shadow-[0_0_1.5px_var(--sidebar)]"',
    );
    expect(railSource).toMatch(
      /kind === "monogram"[\s\S]*?<span aria-hidden className=\{FOLDER_RAIL_GLYPH_CLASS\}>[\s\S]*?<ProjectMonogram/,
    );
    expect(railSource).toContain(
      "<FolderRailContentsPreview projects={projects} collapsed={folder.collapsed} />",
    );

    const utilityStart = indexCssSource.indexOf("@utility project-rail-folder");
    expect(utilityStart).toBeGreaterThanOrEqual(0);
    const utility = indexCssSource.slice(utilityStart, utilityStart + 1_200);
    expect(utility).toMatch(/&::after\s*\{[^}]*z-index:\s*1;/s);
  });
});
