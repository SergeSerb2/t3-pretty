import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  GIT_LIST_BRANCHES_MAX_LIMIT,
  VcsCreateWorktreeInput,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
  VcsListRefsResult,
  VcsStatusResult,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeVcsListRefsResult = Schema.decodeUnknownSync(VcsListRefsResult);
const decodeVcsStatusResult = Schema.decodeUnknownSync(VcsStatusResult);

function vcsStatusWithReview(automatedReview?: unknown) {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/codex-state",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "Surface Codex state",
      url: "https://github.com/t3tools/t3code/pull/42",
      baseRef: "main",
      headRef: "feature/codex-state",
      state: "open",
      ...(arguments.length > 0 ? { automatedReview } : {}),
    },
  };
}

describe("VcsCreateWorktreeInput", () => {
  it("accepts omitted newRefName for existing-refName worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newRefName).toBeUndefined();
    expect(parsed.refName).toBe("feature/existing");
  });

  it("accepts baseRefName metadata for a new worktree ref", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "0123456789abcdef",
      newRefName: "feature/new",
      baseRefName: "origin/main",
      path: "/tmp/worktree",
    });

    expect(parsed.baseRefName).toBe("origin/main");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("VcsStatusResult automated review state", () => {
  it("decodes an observed Codex signal", () => {
    expect(
      decodeVcsStatusResult(vcsStatusWithReview({ provider: "codex", state: "feedback" })).pr
        ?.automatedReview,
    ).toEqual({ provider: "codex", state: "feedback" });
  });

  it("preserves checked-with-no-signal and supports older omitted payloads", () => {
    expect(decodeVcsStatusResult(vcsStatusWithReview(null)).pr?.automatedReview).toBeNull();
    expect(decodeVcsStatusResult(vcsStatusWithReview()).pr?.automatedReview).toBeUndefined();
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});

describe("VcsListRefsResult", () => {
  it("rejects ref pages beyond the request limit", () => {
    const ref = {
      name: "main",
      current: false,
      isDefault: false,
      worktreePath: null,
    };

    expect(() =>
      decodeVcsListRefsResult({
        refs: Array.from({ length: GIT_LIST_BRANCHES_MAX_LIMIT + 1 }, () => ref),
        isRepo: true,
        hasPrimaryRemote: true,
        nextCursor: null,
        totalCount: GIT_LIST_BRANCHES_MAX_LIMIT + 1,
      }),
    ).toThrow();
  });
});
