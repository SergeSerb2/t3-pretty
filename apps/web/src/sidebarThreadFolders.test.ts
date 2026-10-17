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

  it("accounts for every input thread as a parent, listed child, or nest childKey", () => {
    const items = flatten([main, review, other], { isPrNestExpanded: false });
    const accounted = new Set<string>();
    for (const item of items) {
      accounted.add(item.thread.id);
      for (const childKey of item.childKeys) accounted.add(childKey);
    }
    expect([...accounted].sort()).toEqual(["main", "other", "review"]);
  });

  it("still lists a standalone thread that is not a nest parent or child", () => {
    const ghost = thread("ghost", "2026-03-05T00:00:00.000Z");
    expect(flatten([other, ghost]).map((item) => item.thread.id)).toEqual(["other", "ghost"]);
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

  it("keeps Working rows distinct when environments share thread ids", () => {
    const local = { ...other, environmentId: "local", title: "Local work" };
    const remote = { ...other, environmentId: "remote", title: "Remote work" };
    const items = flattenNestedThreads({
      threads: [local, remote],
      section: "working",
      projectKeyOf: (entry) => `${entry.environmentId}:${entry.project}`,
      isPrNestExpanded: () => true,
      activeThreadKey: null,
      threadKeyOf: (entry) => `${entry.environmentId}:${entry.id}`,
    });

    expect(items.map((item) => item.thread)).toEqual([local, remote]);
  });

  it("does not hide another environment's row when its id matches a nested child", () => {
    const localMain = { ...main, environmentId: "local" };
    const localReview = { ...review, environmentId: "local" };
    const remote = { ...other, id: review.id, environmentId: "remote" };
    const items = flattenNestedThreads({
      threads: [localMain, localReview, remote],
      section: "working",
      projectKeyOf: (entry) => `${entry.environmentId}:${entry.project}`,
      isPrNestExpanded: () => false,
      activeThreadKey: null,
      threadKeyOf: (entry) => `${entry.environmentId}:${entry.id}`,
    });

    expect(items.map((item) => item.thread)).toEqual([localMain, remote]);
    expect(items[0]?.childKeys).toEqual(["local:review"]);
  });
});

describe("prNestExpansionKey", () => {
  it("prefixes the pull request key so it cannot collide with project keys", () => {
    expect(prNestExpansionKey("github.com/org/repo#4")).toBe("pr:github.com/org/repo#4");
  });
});
