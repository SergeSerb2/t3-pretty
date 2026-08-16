import { describe, expect, it } from "vite-plus/test";

import { overlayIdsForTarget, sameIdMembers } from "./useOptimisticIdList";

describe("sameIdMembers", () => {
  it("treats the same ids as equal regardless of order", () => {
    expect(sameIdMembers(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdMembers(["a"], ["a", "b"])).toBe(false);
    expect(sameIdMembers(["a", "b"], ["a", "c"])).toBe(false);
  });
});

describe("overlayIdsForTarget", () => {
  it("ignores an overlay written for a different target", () => {
    expect(
      overlayIdsForTarget({ targetKey: "thread-a", ids: ["skill-a"] }, "thread-b", ["skill-b"]),
    ).toBeNull();
  });

  it("keeps the overlay until the matching target's server list catches up", () => {
    expect(
      overlayIdsForTarget({ targetKey: "thread-a", ids: ["skill-a", "skill-b"] }, "thread-a", [
        "skill-a",
      ]),
    ).toEqual(["skill-a", "skill-b"]);
    expect(
      overlayIdsForTarget({ targetKey: "thread-a", ids: ["skill-a"] }, "thread-a", ["skill-a"]),
    ).toBeNull();
  });
});
