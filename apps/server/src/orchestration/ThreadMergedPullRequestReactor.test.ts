import { EventId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  layer,
  shouldSettleMergedPullRequest,
  ThreadMergedPullRequestReactor,
} from "./ThreadMergedPullRequestReactor.ts";

describe("ThreadMergedPullRequestReactor", () => {
  it("never auto-settles a merged pull request", () => {
    expect(
      shouldSettleMergedPullRequest(
        {
          threadId: ThreadId.make("merged"),
          branch: "feature/merged-pr",
          cwd: "/workspace/project-1",
          branchObservedAt: "2026-01-01T00:00:00.000Z",
          branchEventId: EventId.make("event-merged"),
          branchHeadRef: null,
          branchHeadRepository: null,
          branchHeadOwner: null,
          branchHeadIsCrossRepository: null,
        },
        {
          pullRequest: {
            number: 42,
            title: "Merged feature",
            url: "https://github.com/example/repo/pull/42",
            baseRef: "main",
            headRef: "feature/merged-pr",
            state: "merged",
          },
          mergedAt: "2026-01-02T00:00:00.000Z",
          headAssociation: {
            headRef: "feature/merged-pr",
            repositoryNameWithOwner: null,
            ownerLogin: null,
            isCrossRepository: false,
          },
        },
      ),
    ).toBe(false);
  });

  it.effect("does not dispatch settlement during a sweep", () =>
    Effect.gen(function* () {
      const reactor = yield* ThreadMergedPullRequestReactor;
      yield* reactor.sweepOnce;
    }).pipe(Effect.provide(layer)),
  );
});
