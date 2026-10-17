import type { SidebarProjectLayout } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import {
  canonicalizeSidebarProjectLayout,
  compareSidebarProjectLayouts,
  mergeSidebarProjectOrder,
  nextSidebarProjectLayout,
  resolveSidebarProjectLayout,
} from "./sidebarProjectLayout.ts";

const original: SidebarProjectLayout = {
  version: 10,
  folders: [{ id: "work", name: "Work", collapsed: false }],
  assignments: { a: "work", b: "work" },
  projectOrder: ["a", "offline", "b"],
};

describe("shared project rail layout", () => {
  it("keeps folder membership when project identities replace machine paths", () => {
    const layout = {
      ...original,
      assignments: { "mac:/a": "work", "repo/a": "home", "offline:/b": "work" },
      projectOrder: ["mac:/a", "offline:/b", "repo/a"],
    };
    const aliases = new Map([["mac:/a", "repo/a"]]);
    const canonical = canonicalizeSidebarProjectLayout(layout, aliases);
    expect(canonical.assignments).toEqual({ "repo/a": "home", "offline:/b": "work" });
    expect(canonical.projectOrder).toEqual(["repo/a", "offline:/b"]);
    expect(canonicalizeSidebarProjectLayout(canonical, aliases)).toBe(canonical);
  });

  it("selects the same folder order and contents regardless of machine enumeration order", () => {
    const edited = nextSidebarProjectLayout(
      original,
      {
        ...original,
        folders: [{ id: "home", name: "Home", collapsed: true }, ...original.folders],
        assignments: { a: "home", b: "work" },
        projectOrder: ["b", "offline", "a"],
      },
      20,
    );
    expect(resolveSidebarProjectLayout([original, edited])).toEqual(edited);
    expect(resolveSidebarProjectLayout([edited, original])).toEqual(edited);
    expect(resolveSidebarProjectLayout([original, null, edited])).toEqual(edited);
  });

  it("keeps deletions and unassignments when an older machine reconnects", () => {
    const cleared = nextSidebarProjectLayout(
      original,
      { folders: [], assignments: {}, projectOrder: [] },
      20,
    );
    expect(resolveSidebarProjectLayout([cleared, original])).toEqual(cleared);
  });

  it("resolves concurrent edits in either direction and ignores record insertion order", () => {
    const left = { ...original, assignments: { b: "work", a: "work" } };
    expect(compareSidebarProjectLayouts(left, original)).toBe(0);
    const right = { ...original, folders: [{ ...original.folders[0]!, name: "Job" }] };
    expect(resolveSidebarProjectLayout([left, right])).toEqual(
      resolveSidebarProjectLayout([right, left]),
    );
    expect(compareSidebarProjectLayouts(left, right)).toBe(
      -compareSidebarProjectLayouts(right, left),
    );
  });

  it("advances past observed revisions even when this machine's clock is behind", () => {
    expect(nextSidebarProjectLayout(original, original, 1).version).toBe(11);
  });

  it("preserves offline projects when the visible subset is reordered", () => {
    expect(mergeSidebarProjectOrder(original.projectOrder, ["b", "a", "new"])).toEqual([
      "b",
      "offline",
      "a",
      "new",
    ]);
    expect(mergeSidebarProjectOrder(original.projectOrder, [])).toEqual(original.projectOrder);
  });
});
