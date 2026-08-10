import {
  ThreadId,
  type OrchestrationCommand,
  type VcsStatusRemoteResult,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GitPullRequestBranchObservation } from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionMergedPullRequestCandidate,
} from "./Services/ProjectionSnapshotQuery.ts";
import { layer, ThreadMergedPullRequestReactor } from "./ThreadMergedPullRequestReactor.ts";

const WORKSPACE_ROOT = "/workspace/project-1";
const BRANCH = "feature/merged-pr";
const BRANCH_OBSERVED_AT = "2026-01-01T00:00:00.000Z";
const PULL_REQUEST_MERGED_AT = "2026-01-02T00:00:00.000Z";

function makeCandidate(input: {
  readonly id: string;
  readonly branch?: string;
  readonly cwd?: string;
  readonly branchObservedAt?: string;
}): ProjectionMergedPullRequestCandidate {
  return {
    threadId: ThreadId.make(input.id),
    branch: input.branch ?? BRANCH,
    cwd: input.cwd ?? WORKSPACE_ROOT,
    branchObservedAt: input.branchObservedAt ?? BRANCH_OBSERVED_AT,
  };
}

function pullRequest(input: {
  readonly state: "open" | "closed" | "merged";
  readonly headRef?: string;
}): NonNullable<VcsStatusRemoteResult["pr"]> {
  return {
    number: 42,
    title: "Merged feature",
    url: "https://github.com/example/repo/pull/42",
    baseRef: "main",
    headRef: input.headRef ?? BRANCH,
    state: input.state,
  };
}

function observation(
  pullRequestValue: VcsStatusRemoteResult["pr"],
  mergedAt: string | null = PULL_REQUEST_MERGED_AT,
): GitPullRequestBranchObservation {
  return { pullRequest: pullRequestValue, mergedAt };
}

const branchKey = (cwd: string, branch: string) => `${cwd}\u0000${branch}`;

function runSweep(input: {
  readonly candidates: ReadonlyArray<ProjectionMergedPullRequestCandidate>;
  readonly pullRequestByBranch: ReadonlyMap<string, GitPullRequestBranchObservation>;
}) {
  const dispatched: OrchestrationCommand[] = [];

  const testLayer = layer.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getShellSnapshot: () => Effect.die("getShellSnapshot should not be called"),
        listMergedPullRequestCandidates: () => Effect.succeed(input.candidates),
      }),
    ),
    Layer.provide(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        pullRequestForBranch: ({ cwd, branch }) =>
          Effect.succeed(
            input.pullRequestByBranch.get(branchKey(cwd, branch)) ?? observation(null, null),
          ),
      }),
    ),
  );

  return Effect.gen(function* () {
    const reactor = yield* ThreadMergedPullRequestReactor;
    yield* reactor.sweepOnce;
    return dispatched;
  }).pipe(Effect.provide(testLayer));
}

describe("ThreadMergedPullRequestReactor", () => {
  it.effect("persists settlement and always dispatches guarded session cleanup", () =>
    Effect.gen(function* () {
      const commands = yield* runSweep({
        candidates: [makeCandidate({ id: "merged" })],
        pullRequestByBranch: new Map([
          [branchKey(WORKSPACE_ROOT, BRANCH), observation(pullRequest({ state: "merged" }))],
        ]),
      });

      expect(commands).toHaveLength(2);
      const settleCommand = commands[0];
      expect(settleCommand?.type).toBe("thread.settle");
      if (settleCommand?.type === "thread.settle") {
        expect(settleCommand.threadId).toBe("merged");
        expect(settleCommand.commandId.startsWith("server:auto-settle:pr-merged:")).toBe(true);
        expect(settleCommand.onlyIfAutoSettlementEligible).toBe(true);
        expect(settleCommand.expectedBranch).toBe(BRANCH);

        const stopCommand = commands[1];
        expect(stopCommand?.type).toBe("thread.session.stop");
        if (stopCommand?.type === "thread.session.stop") {
          expect(stopCommand.threadId).toBe("merged");
          expect(stopCommand.commandId).toBe(`session-stop-for-settle:${settleCommand.commandId}`);
          expect(stopCommand.onlyIfSettled).toBe(true);
          expect(Number.isNaN(Date.parse(stopCommand.createdAt))).toBe(false);
        }
      }
    }),
  );

  it.effect("uses a thread worktree instead of the project root", () =>
    Effect.gen(function* () {
      const worktreePath = "/workspace/project-1-worktree";
      const commands = yield* runSweep({
        candidates: [makeCandidate({ id: "worktree", cwd: worktreePath })],
        pullRequestByBranch: new Map([
          [branchKey(worktreePath, BRANCH), observation(pullRequest({ state: "merged" }))],
        ]),
      });

      expect(
        commands.flatMap((command) => (command.type === "thread.settle" ? [command.threadId] : [])),
      ).toEqual(["worktree"]);
    }),
  );

  it.effect("checks every stored branch when local-mode threads share a checkout", () =>
    Effect.gen(function* () {
      const otherBranch = "feature/merged-other";
      const commands = yield* runSweep({
        candidates: [
          makeCandidate({ id: "local-one" }),
          makeCandidate({ id: "local-two", branch: otherBranch }),
        ],
        pullRequestByBranch: new Map([
          [branchKey(WORKSPACE_ROOT, BRANCH), observation(pullRequest({ state: "merged" }))],
          [
            branchKey(WORKSPACE_ROOT, otherBranch),
            observation(pullRequest({ state: "merged", headRef: otherBranch })),
          ],
        ]),
      });

      expect(
        commands.flatMap((command) => (command.type === "thread.settle" ? [command.threadId] : [])),
      ).toEqual(["local-one", "local-two"]);
    }),
  );

  it.effect("accepts a merged PR resolved through a differently named upstream branch", () =>
    Effect.gen(function* () {
      const commands = yield* runSweep({
        candidates: [makeCandidate({ id: "renamed-upstream" })],
        pullRequestByBranch: new Map([
          [
            branchKey(WORKSPACE_ROOT, BRANCH),
            observation(pullRequest({ state: "merged", headRef: "feature/remote-name" })),
          ],
        ]),
      });

      expect(
        commands.flatMap((command) => (command.type === "thread.settle" ? [command.threadId] : [])),
      ).toEqual(["renamed-upstream"]);
    }),
  );

  it.effect("does not settle a reused branch from an older merged pull request", () =>
    Effect.gen(function* () {
      const commands = yield* runSweep({
        candidates: [
          makeCandidate({
            id: "reused-branch",
            branchObservedAt: "2026-01-03T00:00:00.000Z",
          }),
        ],
        pullRequestByBranch: new Map([
          [
            branchKey(WORKSPACE_ROOT, BRANCH),
            observation(pullRequest({ state: "merged" }), "2026-01-02T00:00:00.000Z"),
          ],
        ]),
      });

      expect(commands).toEqual([]);
    }),
  );

  it.effect("does not settle open, closed, or timestamp-less pull requests", () =>
    Effect.gen(function* () {
      const cases = [
        observation(pullRequest({ state: "open" })),
        observation(pullRequest({ state: "closed" })),
        observation(null),
        observation(pullRequest({ state: "merged" }), null),
      ];

      for (const [index, pullRequestObservation] of cases.entries()) {
        const commands = yield* runSweep({
          candidates: [makeCandidate({ id: `not-merged-${index}` })],
          pullRequestByBranch: new Map([
            [branchKey(WORKSPACE_ROOT, BRANCH), pullRequestObservation],
          ]),
        });
        expect(commands).toEqual([]);
      }
    }),
  );
});
