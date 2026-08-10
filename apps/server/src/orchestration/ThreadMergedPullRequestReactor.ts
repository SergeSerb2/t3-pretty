import { CommandId, type OrchestrationThreadShell, type VcsStatusResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { forkParked } from "../serverActivation.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

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
  thread: Pick<
    OrchestrationThreadShell,
    | "branch"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pinnedAt"
    | "session"
    | "settledOverride"
  >,
  status: VcsStatusResult | null,
): boolean {
  if (thread.branch === null || thread.settledOverride !== null || thread.pinnedAt != null) {
    return false;
  }
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
  if (thread.session?.status === "starting" || thread.session?.status === "running") return false;
  if (status?.refName !== thread.branch || status.pr?.headRef !== thread.branch) return false;
  return status.pr.state === "merged";
}

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;

  const settleThread = Effect.fn("ThreadMergedPullRequestReactor.settleThread")(function* (
    thread: OrchestrationThreadShell,
  ) {
    const commandId = CommandId.make(`server:auto-settle:pr-merged:${yield* crypto.randomUUIDv4}`);
    yield* orchestrationEngine
      .dispatch({
        type: "thread.settle",
        commandId,
        threadId: thread.id,
      })
      .pipe(
        Effect.tap(() =>
          Effect.logInfo("thread auto-settled after pull request merge", {
            threadId: thread.id,
          }),
        ),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.logDebug("merged pull request settlement lost a state race", {
            threadId: thread.id,
            cause: Cause.pretty(cause),
          });
        }),
      );
  });

  const sweep = Effect.gen(function* () {
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const statusByCwd = new Map<string, VcsStatusResult | null>();

    for (const thread of snapshot.threads) {
      if (thread.branch === null || thread.settledOverride !== null || thread.pinnedAt != null) {
        continue;
      }
      const cwd = resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
      if (cwd === undefined) continue;

      let status = statusByCwd.get(cwd);
      if (status === undefined) {
        status = yield* vcsStatusBroadcaster.peekStatus({ cwd });
        statusByCwd.set(cwd, status);
      }
      if (shouldSettleMergedPullRequest(thread, status)) {
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
