import { describe, expect, it, vi } from "vite-plus/test";

import { flattenMenuActions, homeListFilterItemsToActions } from "./anchored-menu.logic";

describe("flattenMenuActions", () => {
  it("drops hidden actions and flattens inline groups under a section header", () => {
    const rows = flattenMenuActions([
      { id: "visible", title: "Pin" },
      { id: "secret", title: "Hidden", attributes: { hidden: true } },
      {
        id: "group",
        title: "Codex",
        displayInline: true,
        subactions: [
          { id: "a", title: "Opus" },
          { id: "b", title: "Sonnet", attributes: { hidden: true } },
        ],
      },
    ]);

    expect(rows).toEqual([
      { type: "action", action: { id: "visible", title: "Pin" } },
      { type: "header", title: "Codex" },
      { type: "action", action: { id: "a", title: "Opus" } },
    ]);
  });

  it("keeps nested submenus as drill-in actions when they are not inline", () => {
    const nested = {
      id: "project",
      title: "Project",
      subactions: [{ id: "all", title: "All projects" }],
    };
    expect(flattenMenuActions([nested])).toEqual([{ type: "action", action: nested }]);
  });
});

describe("homeListFilterItemsToActions", () => {
  it("assigns stable ids and preserves submenu onPress handlers", () => {
    const onAll = vi.fn();
    const onOne = vi.fn();
    const { actions, handlers } = homeListFilterItemsToActions([
      {
        type: "submenu",
        title: "Project",
        items: [
          { type: "action", title: "All projects", state: "off", onPress: onAll },
          { type: "action", title: "Codething", state: "on", onPress: onOne },
        ],
      },
    ]);

    expect(actions).toMatchObject([
      {
        id: "0",
        title: "Project",
        subactions: [
          { id: "0:0", title: "All projects", state: undefined },
          { id: "0:1", title: "Codething", state: "on" },
        ],
      },
    ]);
    handlers.get("0:0")?.();
    handlers.get("0:1")?.();
    expect(onAll).toHaveBeenCalledOnce();
    expect(onOne).toHaveBeenCalledOnce();
  });
});
