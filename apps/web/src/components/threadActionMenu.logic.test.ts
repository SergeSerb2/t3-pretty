import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  surface: "sidebar",
  branch: null,
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function visibleIds(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state)
    .filter((item) => item.separator !== true)
    .map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it("keeps the sidebar residual: no settle or snooze, nested copy", () => {
    expect(visibleIds(baseState)).toEqual([
      "pin",
      "rename",
      "regenerate-title",
      "mark-unread",
      "copy",
      "archive",
      "delete",
    ]);
  });

  it("adds settle and snooze on the header after pin", () => {
    expect(visibleIds({ ...baseState, surface: "header" })).toEqual([
      "pin",
      "settle",
      "snooze",
      "rename",
      "regenerate-title",
      "mark-unread",
      "copy",
      "archive",
      "delete",
    ]);
  });

  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      visibleIds({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toEqual(["rename", "mark-unread", "copy", "archive", "delete"]);
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = visibleIds({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(visibleIds(baseState)).not.toContain("new-thread-on-branch");

    const copy = buildThreadActionMenuItems({ ...baseState, branch: "feat/menu" }).find(
      (item) => item.id === "copy",
    );
    expect(copy?.children?.map((child) => child.id)).toEqual([
      "copy-path",
      "copy-branch",
      "copy-thread-id",
    ]);
    expect(
      buildThreadActionMenuItems(baseState)
        .find((item) => item.id === "copy")
        ?.children?.map((child) => child.id),
    ).toEqual(["copy-path", "copy-thread-id"]);
  });

  it("shortens the new-thread label so the branch name does not stretch the menu", () => {
    const item = buildThreadActionMenuItems({ ...baseState, branch: "t3code/very-long-name" }).find(
      (candidate) => candidate.id === "new-thread-on-branch",
    );
    expect(item?.label).toBe("New thread on this branch");
  });

  it("flips lifecycle labels with thread state", () => {
    expect(
      visibleIds({
        ...baseState,
        surface: "header",
        isPinned: true,
        isSettled: true,
        isSnoozed: true,
      }),
    ).toEqual(expect.arrayContaining(["unpin", "unsettle", "unsnooze"]));
    expect(visibleIds({ ...baseState, isPinned: true })).toEqual(expect.arrayContaining(["unpin"]));
    expect(visibleIds({ ...baseState, isPinned: true })).not.toEqual(
      expect.arrayContaining(["settle", "snooze"]),
    );
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({
      ...baseState,
      surface: "header",
      canSnoozeNow: false,
    }).find((item) => item.id === "snooze");
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("nests copy children without icons", () => {
    const copy = buildThreadActionMenuItems({ ...baseState, branch: "main" }).find(
      (item) => item.id === "copy",
    );
    expect(copy?.icon).toBe("copy");
    expect(copy?.children?.every((child) => child.icon === undefined)).toBe(true);
  });

  it("puts an icon on every top-level action", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      surface: "header",
      branch: "main",
    }).filter((item) => item.separator !== true);
    expect(items.every((item) => typeof item.icon === "string" && item.icon.length > 0)).toBe(true);
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });

  it("offers archive as a non-destructive action right before delete", () => {
    const items = buildThreadActionMenuItems(baseState);
    const archiveItem = items.at(-2);
    expect(archiveItem?.id).toBe("archive");
    expect(archiveItem?.destructive).toBeFalsy();
    expect(items.at(-1)?.id).toBe("delete");
  });

  it("keeps archive available even when the environment lacks every other capability", () => {
    expect(
      visibleIds({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toContain("archive");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});
