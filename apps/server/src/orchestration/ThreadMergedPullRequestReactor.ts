import { CommandId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import type { GitPullRequestBranchObservation } from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { forkParked } from "../serverActivation.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionMergedPullRequestCandidate,
} from "./Services/ProjectionSnapshotQuery.ts";

const RECONCILE_INTERVAL = Duration.minutes(1);

export class ThreadMergedPullRequestReactor extends Context.Service<
  ThreadMergedPullRequestReactor,
  {
    /** Start reconciling observed merged PRs into durable thread settlement. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Run one cache-only reconciliation pass. Intended for focused tests. */
    readonly sweepOnce: Effect.Effect<void>;
  }
>()("t3/orchestration/ThreadMergedPullRequestReactor") {}

export function shouldSettleMergedPullRequest(
  thread: ProjectionMergedPullRequestCandidate,
  observation: GitPullRequestBranchObservation,
): boolean {
  if (observation.pullRequest?.state !== "merged" || observation.mergedAt === null) {
    return false;
  }

  const threadCreatedAt = Date.parse(thread.createdAt);
  const pullRequestMergedAt = Date.parse(observation.mergedAt);
  return (
    Number.isFinite(threadCreatedAt) &&
    Number.isFinite(pullRequestMergedAt) &&
    pullRequestMergedAt >= threadCreatedAt
  );
}

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;

  const settleThread = Effect.fn("ThreadMergedPullRequestReactor.settleThread")(function* (
    thread: ProjectionMergedPullRequestCandidate,
  ) {
    const commandId = CommandId.make(`server:auto-settle:pr-merged:${yield* crypto.randomUUIDv4}`);
    const settled = yield* orchestrationEngine
      .dispatch({
        type: "thread.settle",
        commandId,
        threadId: thread.threadId,
        onlyIfAutoSettlementEligible: true,
        expectedBranch: thread.branch,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("thread auto-settled after pull request merge", {
            threadId: thread.threadId,
          }),
        ),
        Effect.as(true),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logDebug("merged pull request settlement lost a state race", {
            threadId: thread.threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(false));
        }),
      );
    if (!settled) return;

    yield* orchestrationEngine
      .dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make(`session-stop-for-settle:${commandId}`),
        threadId: thread.threadId,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        onlyIfSettled: true,
      })
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logWarning("failed to stop provider session during automatic settlement", {
            threadId: thread.threadId,
            cause: Cause.pretty(cause),
          });
        }),
      );
  });

  const sweep = Effect.gen(function* () {
    const candidates = yield* projectionSnapshotQuery.listMergedPullRequestCandidates();
    const pullRequestByBranch = new Map<string, GitPullRequestBranchObservation>();

    for (const thread of candidates) {
      const key = `${thread.cwd}\u0000${thread.branch}`;
      let observation = pullRequestByBranch.get(key);
      if (observation === undefined) {
        observation = yield* gitWorkflow
          .pullRequestForBranch({ cwd: thread.cwd, branch: thread.branch })
          .pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
              return Effect.logWarning("merged pull request branch lookup failed", {
                threadId: thread.threadId,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as({ pullRequest: null, mergedAt: null }));
            }),
          );
        pullRequestByBranch.set(key, observation);
      }
      if (shouldSettleMergedPullRequest(thread, observation)) {
        yield* settleThread(thread);
      }
    }
  });

  const sweepOnce: ThreadMergedPullRequestReactor["Service"]["sweepOnce"] = sweep.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      return Effect.logWarning("merged pull request settlement sweep failed", {
        cause: Cause.pretty(cause),
      });
    }),
  );

  const start: ThreadMergedPullRequestReactor["Service"]["start"] = () =>
    forkParked(sweepOnce.pipe(Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL)), Effect.asVoid));

  return ThreadMergedPullRequestReactor.of({ start, sweepOnce });
});

export const layer = Layer.effect(ThreadMergedPullRequestReactor, make);
