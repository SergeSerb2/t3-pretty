import { describe, expect, it } from "vite-plus/test";

import { COLLAPSED_SWITCHER_CONTROL_CLASS } from "./collapsedSidebarDock";

describe("collapsed sidebar switcher", () => {
  it("keeps collapsed controls as a compact icon column", () => {
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).toContain("size-8!");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).not.toContain("w-full!");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).not.toContain("h-9!");
    expect(COLLAPSED_SWITCHER_CONTROL_CLASS).not.toContain("grid-cols-2");
  });
});
