import { describe, expect, it } from "vite-plus/test";

import { flattenNestedThreads, prNestExpansionKey } from "./sidebarThreadFolders";

function thread(
  id: string,
  updatedAt: string,
  pullRequests: Array<{
    number: number;
    linkedAt: string;
  }> = [],
  project = "alpha",
) {
  return {
    id,
    project,
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

type Thread = ReturnType<typeof thread>;

function flatten(
  threads: Thread[],
  options: { isPrNestExpanded?: boolean; activeThreadKey?: string | null } = {},
) {
  return flattenNestedThreads({
    threads,
    section: "active",
    projectKeyOf: (entry) => entry.project,
    isPrNestExpanded: () => options.isPrNestExpanded ?? true,
    activeThreadKey: options.activeThreadKey ?? null,
    threadKeyOf: (entry) => entry.id,
  });
}

describe("flattenNestedThreads", () => {
  const main = thread("main", "2026-03-01T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-01T00:00:00.000Z" },
  ]);
  const review = thread("review", "2026-03-02T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-02T00:00:00.000Z" },
  ]);
  const other = thread("other", "2026-03-03T00:00:00.000Z");

  it("nests later PR threads under the first-linked parent", () => {
    const items = flatten([main, review, other]);
    expect(items.map((item) => [item.thread.id, item.nest])).toEqual([
      ["main", "parent"],
      ["review", "child"],
      ["other", null],
    ]);
    expect(items[0]?.childKeys).toEqual(["review"]);
  });

  it("keeps the section order and moves a child under a parent listed later", () => {
    expect(flatten([review, other, main]).map((item) => item.thread.id)).toEqual([
      "other",
      "main",
      "review",
    ]);
  });

  it("hides children when the PR nest is collapsed", () => {
    expect(
      flatten([main, review, other], { isPrNestExpanded: false }).map((item) => item.thread.id),
    ).toEqual(["main", "other"]);
  });

  it("keeps an active child visible when its nest is collapsed", () => {
    expect(
      flatten([main, review, other], { isPrNestExpanded: false, activeThreadKey: "review" }).map(
        (item) => item.thread.id,
      ),
    ).toEqual(["main", "review", "other"]);
  });

  it("does not nest across projects that share a pull request", () => {
    const elsewhere = thread(
      "elsewhere",
      "2026-03-04T00:00:00.000Z",
      [{ number: 4, linkedAt: "2026-03-04T00:00:00.000Z" }],
      "beta",
    );
    const items = flatten([main, review, elsewhere], { isPrNestExpanded: false });
    expect(items.map((item) => [item.thread.id, item.nest])).toEqual([
      ["main", "parent"],
      ["elsewhere", null],
    ]);
  });
});

describe("prNestExpansionKey", () => {
  it("prefixes the pull request key so it cannot collide with project keys", () => {
    expect(prNestExpansionKey("github.com/org/repo#4")).toBe("pr:github.com/org/repo#4");
  });
});
