import { describe, expect, it } from "vite-plus/test";

import {
  COLLAPSED_DOCK_BAR_BUTTON_CLASS,
  COLLAPSED_DOCK_COLLAPSED_MENU_CLASS,
  COLLAPSED_DOCK_CONTAINER_CLASS,
  COLLAPSED_DOCK_GRID_CLASS,
  COLLAPSED_DOCK_TILE_BUTTON_CLASS,
  COLLAPSED_DOCK_WIDE_LABEL_CLASS,
} from "./collapsedSidebarDock";

describe("collapsed sidebar dock", () => {
  it("switches to two columns once the rail is wider than a single icon strip", () => {
    expect(COLLAPSED_DOCK_CONTAINER_CLASS).toBe("@container/collapsed-dock");
    expect(COLLAPSED_DOCK_GRID_CLASS).toContain("grid-cols-1");
    expect(COLLAPSED_DOCK_GRID_CLASS).toContain("@[4rem]/collapsed-dock:grid-cols-2");
    expect(COLLAPSED_DOCK_COLLAPSED_MENU_CLASS).toContain(
      "group-data-[collapsible=icon]:@[4rem]/collapsed-dock:grid-cols-2",
    );
  });

  it("fills each cell instead of leaving a centered 32px control", () => {
    expect(COLLAPSED_DOCK_TILE_BUTTON_CLASS).toContain("w-full!");
    expect(COLLAPSED_DOCK_TILE_BUTTON_CLASS).toContain("size-auto!");
    expect(COLLAPSED_DOCK_BAR_BUTTON_CLASS).toContain("col-span-full");
    expect(COLLAPSED_DOCK_WIDE_LABEL_CLASS).toContain("@[4rem]/collapsed-dock:inline");
  });
});
