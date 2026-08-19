import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  dismissHostedContextMenu,
  isAuthoredContextMenuOpen,
  readContextMenuState,
  registerContextMenuHost,
  requestContextMenu,
  resetContextMenuForTests,
  respondToContextMenu,
} from "./contextMenu";

function requireMenu(menu: Promise<string | null> | undefined): Promise<string | null> {
  if (!menu) {
    throw new Error("Expected a registered context-menu host.");
  }
  return menu;
}

describe("in-app context menu coordinator", () => {
  beforeEach(() => {
    resetContextMenuForTests();
  });

  it("returns undefined until a host is mounted", () => {
    expect(requestContextMenu([{ id: "rename", label: "Rename" }], { x: 1, y: 2 })).toBeUndefined();
    expect(readContextMenuState()).toEqual({ status: "idle" });
  });

  it("resolves the selected item id", async () => {
    const unregister = registerContextMenuHost();
    const selection = requireMenu(
      requestContextMenu([{ id: "rename", label: "Rename" }], { x: 4, y: 8 }),
    );

    expect(readContextMenuState()).toMatchObject({
      status: "open",
      source: "authored",
      position: { x: 4, y: 8 },
    });
    expect(isAuthoredContextMenuOpen()).toBe(true);

    respondToContextMenu("rename");
    await expect(selection).resolves.toBe("rename");
    expect(readContextMenuState()).toEqual({ status: "idle" });
    unregister();
  });

  it("ignores an edit-menu request while an authored menu owns the gesture", async () => {
    const unregister = registerContextMenuHost();
    const authored = requireMenu(
      requestContextMenu([{ id: "pin", label: "Pin thread" }], { x: 1, y: 1 }, "authored"),
    );
    const edit = requireMenu(
      requestContextMenu([{ id: "copy", label: "Copy" }], { x: 1, y: 1 }, "edit"),
    );

    await expect(edit).resolves.toBeNull();
    expect(isAuthoredContextMenuOpen()).toBe(true);

    respondToContextMenu("pin");
    await expect(authored).resolves.toBe("pin");
    unregister();
  });

  it("replaces an open menu when a new authored menu opens", async () => {
    const unregister = registerContextMenuHost();
    const first = requireMenu(
      requestContextMenu([{ id: "first", label: "First" }], { x: 0, y: 0 }),
    );
    const second = requireMenu(
      requestContextMenu([{ id: "second", label: "Second" }], { x: 2, y: 2 }),
    );

    await expect(first).resolves.toBeNull();
    respondToContextMenu("second");
    await expect(second).resolves.toBe("second");
    unregister();
  });

  it("lets a same-turn selection win over dismiss", async () => {
    const unregister = registerContextMenuHost();
    const selection = requireMenu(
      requestContextMenu([{ id: "rename", label: "Rename" }], { x: 1, y: 1 }),
    );

    dismissHostedContextMenu();
    respondToContextMenu("rename");

    await expect(selection).resolves.toBe("rename");
    expect(readContextMenuState()).toEqual({ status: "idle" });
    unregister();
  });

  it("does not cancel after a selection has already resolved", async () => {
    const unregister = registerContextMenuHost();
    const selection = requireMenu(
      requestContextMenu([{ id: "pin", label: "Pin thread" }], { x: 1, y: 1 }),
    );

    respondToContextMenu("pin");
    dismissHostedContextMenu();

    await expect(selection).resolves.toBe("pin");
    expect(readContextMenuState()).toEqual({ status: "idle" });
    unregister();
  });

  it("cancels when dismissed without a selection", async () => {
    const unregister = registerContextMenuHost();
    const selection = requireMenu(
      requestContextMenu([{ id: "rename", label: "Rename" }], { x: 1, y: 1 }),
    );

    dismissHostedContextMenu();

    await expect(selection).resolves.toBeNull();
    expect(readContextMenuState()).toEqual({ status: "idle" });
    unregister();
  });
});
