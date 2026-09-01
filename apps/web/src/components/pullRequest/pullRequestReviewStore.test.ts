import {
  PULL_REQUEST_REVIEW_MAX_COMMENTS,
  type EnvironmentId,
  type ProjectId,
  type PullRequestRef,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  type PendingReviewComment,
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

function comment(id: string, body = id): PendingReviewComment {
  return { id, body, path: "src/app.ts", position: { kind: "added", newLine: 1 } };
}

describe("pull request review drafts", () => {
  beforeEach(() => {
    usePullRequestReviewStore.setState({ drafts: {}, summaries: {} });
  });

  it("removes only the line comments included in a submitted snapshot", () => {
    const store = usePullRequestReviewStore.getState();
    store.addComment("review-a", comment("submitted"));
    const submittedIds =
      usePullRequestReviewStore.getState().drafts["review-a"]?.map((entry) => entry.id) ?? [];

    usePullRequestReviewStore.getState().addComment("review-a", comment("added-in-flight"));
    usePullRequestReviewStore.getState().removeComments("review-a", submittedIds);

    expect(usePullRequestReviewStore.getState().drafts["review-a"]).toEqual([
      comment("added-in-flight"),
    ]);
  });

  it("keeps one review draft within the submission contract", () => {
    const store = usePullRequestReviewStore.getState();
    for (let index = 0; index < PULL_REQUEST_REVIEW_MAX_COMMENTS; index += 1) {
      expect(store.addComment("review-a", comment(`comment-${index}`))).toBe(true);
    }

    expect(store.addComment("review-a", comment("overflow"))).toBe(false);
    expect(usePullRequestReviewStore.getState().drafts["review-a"]).toHaveLength(
      PULL_REQUEST_REVIEW_MAX_COMMENTS,
    );
  });

  it("keeps summary bodies isolated by review key", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Summary A");
    store.setSummary("review-b", "Summary B");
    store.clearSummary("review-a", "Summary A");

    expect(usePullRequestReviewStore.getState().summaries).toEqual({
      "review-b": "Summary B",
    });
  });

  it("does not clear a summary revised while submission is in flight", () => {
    const store = usePullRequestReviewStore.getState();
    store.setSummary("review-a", "Submitted body");
    usePullRequestReviewStore.getState().setSummary("review-a", "Revised body");
    usePullRequestReviewStore.getState().clearSummary("review-a", "Submitted body");

    expect(usePullRequestReviewStore.getState().summaries["review-a"]).toBe("Revised body");
  });

  it("isolates matching pull request identities from different environments", () => {
    const reference: PullRequestRef = {
      projectId: "project-1" as ProjectId,
      repository: "owner/repository",
      number: 42,
    };

    expect(pullRequestReviewKey("environment-a" as EnvironmentId, reference)).not.toBe(
      pullRequestReviewKey("environment-b" as EnvironmentId, reference),
    );
  });
});
