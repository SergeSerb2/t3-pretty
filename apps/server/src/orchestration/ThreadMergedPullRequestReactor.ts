// Merged PRs no longer auto-settle. This service stays wired into
// orchestration startup so the layer graph does not change; start and
// sweepOnce are no-ops.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import type { GitPullRequestBranchObservation } from "../git/GitManager.ts";
import type { ProjectionMergedPullRequestCandidate } from "./Services/ProjectionSnapshotQuery.ts";

export class ThreadMergedPullRequestReactor extends Context.Service<
  ThreadMergedPullRequestReactor,
  {
    /** Kept so orchestration startup wiring stays unchanged. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Kept so focused tests can still invoke a reconciliation pass. */
    readonly sweepOnce: Effect.Effect<void>;
  }
>()("t3/orchestration/ThreadMergedPullRequestReactor") {}

export function shouldSettleMergedPullRequest(
  _thread: ProjectionMergedPullRequestCandidate,
  _observation: GitPullRequestBranchObservation,
): boolean {
  // Merged PRs stay in the active list until the user settles them.
  return false;
}

export const make = Effect.succeed(
  ThreadMergedPullRequestReactor.of({
    start: () => Effect.void,
    sweepOnce: Effect.void,
  }),
);

export const layer = Layer.effect(ThreadMergedPullRequestReactor, make);
