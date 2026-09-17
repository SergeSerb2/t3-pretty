import { describe, expect, it } from "vite-plus/test";

import { COLLAPSED_SWITCHER_CONTROL_CLASS } from "./collapsedSidebarDock";

describe("collapsed sidebar switcher", () => {
  it("fills the icon rail as a single column of full-bleed rows", () => {
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).toContain("w-full!");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).toContain("h-9!");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).not.toContain("grid-cols-2");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).not.toContain("aspect-square");
  });
});
