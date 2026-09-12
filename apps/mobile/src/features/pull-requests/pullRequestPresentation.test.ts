import { describe, expect, it } from "vite-plus/test";

import {
  describeChecksState,
  describeReviewDecision,
  formatDiffStat,
  formatReviewState,
  pullRequestLabelColor,
  resolvePullRequestState,
} from "./pullRequestPresentation";

describe("resolvePullRequestState", () => {
  it("ranks merged and closed above draft", () => {
    expect(resolvePullRequestState({ state: "merged", isDraft: true }).kind).toBe("merged");
    expect(resolvePullRequestState({ state: "closed", isDraft: true }).kind).toBe("closed");
  });

  it("names the base branch when the open pull request conflicts", () => {
    expect(
      resolvePullRequestState({
        state: "open",
        isDraft: false,
        mergeability: "conflicting",
        baseBranch: "main",
      }).label,
    ).toBe("Conflicts with main");
  });
});

describe("formatDiffStat", () => {
  it("omits a missing change set rather than drawing +0 −0", () => {
    expect(formatDiffStat(0, 0)).toBeNull();
    expect(formatDiffStat(12, 3)).toBe("+12 −3");
  });

  it("does not expose corrupt host counts as misleading diff stats", () => {
    expect(formatDiffStat(Number.NaN, 3)).toBeNull();
    expect(formatDiffStat(12, Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatDiffStat(-1, 3)).toBeNull();
    expect(formatDiffStat(1.5, 3)).toBeNull();
  });
});

describe("review and check labels", () => {
  it("reads a host review state as a short sentence", () => {
    expect(formatReviewState("CHANGES_REQUESTED")).toBe("Changes requested");
    expect(formatReviewState("approved")).toBe("Approved");
  });

  it("only names a review decision that somebody actually gave", () => {
    expect(describeReviewDecision("approved")).toBe("Approved");
    expect(describeReviewDecision("changes-requested")).toBe("Changes requested");
    expect(describeReviewDecision("review-required")).toBeNull();
    expect(describeReviewDecision(undefined)).toBeNull();
  });

  it("names a check rollup in the same voice as the detail page", () => {
    expect(describeChecksState("passing")).toBe("Checks passed");
    expect(describeChecksState("failing")).toBe("Checks failing");
    expect(describeChecksState(undefined)).toBeNull();
  });

  it("accepts only a six-digit host label colour", () => {
    expect(pullRequestLabelColor("1a2b3c")).toBe("#1a2b3c");
    expect(pullRequestLabelColor("#ff00aa")).toBe("#ff00aa");
    expect(pullRequestLabelColor("red")).toBeNull();
  });
});
