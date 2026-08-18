import { describe, expect, it } from "@effect/vitest";

import {
  originCheckStatus,
  originMergeability,
  originStateAndDraft,
  toOriginDetail,
  toOriginListItem,
} from "./originPullRequestJson.ts";

describe("origin pull request JSON", () => {
  it("maps draft and merged CLI statuses", () => {
    expect(originStateAndDraft("draft")).toEqual({ state: "open", isDraft: true });
    expect(originStateAndDraft("merged")).toEqual({ state: "merged", isDraft: false });
    expect(originStateAndDraft("open")).toEqual({ state: "open", isDraft: false });
  });

  it("maps mergeability and check conclusions", () => {
    expect(originMergeability({ mergeable: true, hasMergeConflicts: false })).toBe("mergeable");
    expect(originMergeability({ hasMergeConflicts: true })).toBe("conflicting");
    expect(originCheckStatus({ status: "completed", conclusion: "success" })).toBe("success");
    expect(originCheckStatus({ status: "completed", conclusion: "skipped" })).toBe("skipped");
    expect(originCheckStatus({ status: "in_progress", conclusion: null })).toBe("pending");
  });

  it("reads a CLI list row", () => {
    const item = toOriginListItem({
      number: 35,
      title: "chore(sync): merge upstream",
      status: "merged",
      headRef: "automation/upstream",
      baseRef: "main",
      authorId: "google-oauth2|user_01",
      createdAt: "2026-08-18T05:13:03Z",
      updatedAt: "2026-08-18T05:13:05Z",
      additions: 16,
      deletions: 33,
      url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
      repo: { org: "serbinenko", name: "t3-pretty" },
    });

    expect(item).toMatchObject({
      number: 35,
      state: "merged",
      isDraft: false,
      headBranch: "automation/upstream",
      baseBranch: "main",
      additions: 16,
      deletions: 33,
      url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
    });
    expect(item?.author?.login).toBe("google-oauth2|user_01");
  });

  it("reads a detail row including description and checks", () => {
    const detail = toOriginDetail({
      number: "35",
      title: "chore(sync): merge upstream",
      description: "Automated integration",
      status: "merged",
      headRef: "automation/upstream",
      baseRef: "main",
      createdAt: "2026-08-18T05:13:03Z",
      updatedAt: "2026-08-18T05:13:05Z",
      mergedAt: "2026-08-18T05:13:05Z",
      additions: 16,
      deletions: 33,
      changedFiles: 4,
      url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
      ciState: {
        checkRunGroups: [
          {
            checkRuns: [
              {
                name: "t3-pretty #70",
                status: "completed",
                conclusion: "success",
                detailsUrl: "https://buildkite.com/example",
                output: { title: "Build #70 passed" },
              },
            ],
          },
        ],
      },
    });

    expect(detail?.body).toBe("Automated integration");
    expect(detail?.changedFiles).toBe(4);
    expect(detail?.checks).toEqual([
      {
        name: "t3-pretty #70",
        status: "success",
        description: "Build #70 passed",
        url: "https://buildkite.com/example",
      },
    ]);
  });
});
