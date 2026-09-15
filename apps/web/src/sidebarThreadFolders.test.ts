import { describe, expect, it } from "vite-plus/test";

import {
  flattenSectionFolders,
  groupSectionThreadsIntoProjectFolders,
  prNestExpansionKey,
  sidebarFolderId,
} from "./sidebarThreadFolders";

function thread(
  id: string,
  project: string,
  updatedAt: string,
  pullRequests: Array<{
    number: number;
    linkedAt: string;
  }> = [],
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

describe("groupSectionThreadsIntoProjectFolders", () => {
  it("sorts project folders by latest thread activity", () => {
    const older = thread("old", "alpha", "2026-01-01T00:00:00.000Z");
    const newer = thread("new", "beta", "2026-03-01T00:00:00.000Z");
    const folders = groupSectionThreadsIntoProjectFolders({
      threads: [older, newer],
      projectKeyOf: (entry) => entry.project,
      projectSortOrder: "updated_at",
      getActivityTimestamp: (entry) => Date.parse(entry.updatedAt),
    });
    expect(folders.map((folder) => folder.projectKey)).toEqual(["beta", "alpha"]);
  });

  it("nests later PR threads under the first-linked parent inside a project", () => {
    const main = thread("main", "alpha", "2026-03-01T00:00:00.000Z", [
      { number: 4, linkedAt: "2026-03-01T00:00:00.000Z" },
    ]);
    const review = thread("review", "alpha", "2026-03-02T00:00:00.000Z", [
      { number: 4, linkedAt: "2026-03-02T00:00:00.000Z" },
    ]);
    const other = thread("other", "alpha", "2026-03-03T00:00:00.000Z");
    const [folder] = groupSectionThreadsIntoProjectFolders({
      threads: [main, review, other],
      projectKeyOf: (entry) => entry.project,
      projectSortOrder: "updated_at",
      getActivityTimestamp: (entry) => Date.parse(entry.updatedAt),
    });
    expect(folder?.threads.map((nest) => nest.thread.id)).toEqual(["main", "other"]);
    expect(folder?.threads[0]?.children.map((child) => child.id)).toEqual(["review"]);
  });
});

describe("flattenSectionFolders", () => {
  const main = thread("main", "alpha", "2026-03-01T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-01T00:00:00.000Z" },
  ]);
  const review = thread("review", "alpha", "2026-03-02T00:00:00.000Z", [
    { number: 4, linkedAt: "2026-03-02T00:00:00.000Z" },
  ]);
  const folders = groupSectionThreadsIntoProjectFolders({
    threads: [main, review],
    projectKeyOf: (entry) => entry.project,
    projectSortOrder: "updated_at",
    getActivityTimestamp: (entry) => Date.parse(entry.updatedAt),
  });

  it("hides children when the PR nest is collapsed", () => {
    const items = flattenSectionFolders({
      folders,
      section: "active",
      showProjectFolders: true,
      isProjectExpanded: () => true,
      isPrNestExpanded: () => false,
      activeThreadKey: null,
      threadKeyOf: (entry) => entry.id,
    });
    expect(
      items.map((item) => (item.kind === "folder" ? item.projectKey : item.thread.id)),
    ).toEqual(["alpha", "main"]);
  });

  it("keeps an active child visible when its nest is collapsed", () => {
    const items = flattenSectionFolders({
      folders,
      section: "active",
      showProjectFolders: true,
      isProjectExpanded: () => true,
      isPrNestExpanded: () => false,
      activeThreadKey: "review",
      threadKeyOf: (entry) => entry.id,
    });
    expect(items.filter((item) => item.kind === "thread").map((item) => item.thread.id)).toEqual([
      "main",
      "review",
    ]);
  });
});

describe("sidebar folder keys", () => {
  it("prefixes structural ids so they cannot collide with thread keys", () => {
    expect(sidebarFolderId("active", "github.com/org/repo")).toBe(
      "sidebar-folder-active-github.com/org/repo",
    );
    expect(prNestExpansionKey("github.com/org/repo#4")).toBe("pr:github.com/org/repo#4");
  });
});
