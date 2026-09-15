import { describe, expect, it } from "vite-plus/test";

import { flattenNestedThreads, prNestExpansionKey } from "./sidebarThreadFolders";

function thread(
  id: string,
  updatedAt: string,
  pullRequests: Array<{
    number: number;
    linkedAt: string;
  }> = [],
) {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    pullRequests: pullRequests.map((entry) => ({
      host: "github.com",
      repository: "org/repo",
      number: entry.number,
      url: `https://github.com/org/repo/pull/${entry.number}`,
      source: "manual" as const,
      linkedAt: entry.linkedAt,
      snapshot: {
        state: "open" as const,
        title: `#${entry.number}`,
        headBranch: "feature",
        baseBranch: "main",
        isDraft: false,
        updatedAt: entry.linkedAt,
        syncedAt: entry.linkedAt,
      },
      stack: null,
    })),
  };
}

describe("flattenNestedThreads", () => {
  const main = thread("main", "2026-03-01T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-01T00:00:00.000Z" },
  ]);
  const review = thread("review", "2026-03-02T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-02T00:00:00.000Z" },
  ]);
  const other = thread("other", "2026-03-03T00:00:00.000Z");
  const flatten = (isPrNestExpanded: boolean, activeThreadKey: string | null = null) =>
    flattenNestedThreads({
      threads: [main, review, other],
      section: "active",
      isPrNestExpanded: () => isPrNestExpanded,
      activeThreadKey,
      threadKeyOf: (entry) => entry.id,
    });

  it("nests later PR threads under the first-linked parent", () => {
    const items = flatten(true);
    expect(items.map((item) => [item.thread.id, item.nest])).toEqual([
      ["main", "parent"],
      ["review", "child"],
      ["other", null],
    ]);
    expect(items[0]?.childKeys).toEqual(["review"]);
  });

  it("hides children when the PR nest is collapsed", () => {
    expect(flatten(false).map((item) => item.thread.id)).toEqual(["main", "other"]);
  });

  it("keeps an active child visible when its nest is collapsed", () => {
    expect(flatten(false, "review").map((item) => item.thread.id)).toEqual([
      "main",
      "review",
      "other",
    ]);
  });
});

describe("prNestExpansionKey", () => {
  it("prefixes the pull request key so it cannot collide with project keys", () => {
    expect(prNestExpansionKey("github.com/org/repo#4")).toBe("pr:github.com/org/repo#4");
  });
});
