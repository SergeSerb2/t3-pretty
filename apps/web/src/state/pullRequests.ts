import { useAtomValue } from "@effect/atom-react";
import { createPullRequestEnvironmentAtoms } from "@t3tools/client-runtime/state/pull-requests";
import {
  isSettledAtomQueryInterrupt,
  readAtomQueryResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestListInput,
  PullRequestListStatsInput,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  mergePullRequestLists,
  type EnvironmentPullRequestStat,
  type MergedPullRequestList,
} from "../components/pullRequest/pullRequestList.logic";
import { useRetryInterruptedQuery } from "./query";

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);
const MERGED_PULL_REQUEST_QUERY_IDLE_TTL_MS = 5 * 60_000;

export interface EnvironmentQueryTarget<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

interface MergedEnvironmentQueryView<A, Input> {
  /** One entry per environment that has answered, in the order the targets were given. */
  readonly values: ReadonlyArray<readonly [EnvironmentId, A]>;
  /** The first environment that failed. Others may still have answered — this is not fatal. */
  readonly error: string | null;
  readonly isPending: boolean;
  readonly retryTargets: ReadonlyArray<EnvironmentQueryTarget<Input>>;
}

/**
 * The same per-environment query read across several environments at once. React cannot subscribe
 * to a list of atoms whose length changes, so the fan-out happens inside one derived atom keyed by
 * the targets — the same shape the cross-environment thread search uses.
 *
 * An environment that fails contributes nothing rather than blanking the page: the pull request
 * list is a union, and one unreachable machine should not hide the others' rows.
 */
function createMergedEnvironmentQuery<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedEnvironmentQueryView<A, Input> => {
      const targets = JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>;
      const values: Array<readonly [EnvironmentId, A]> = [];
      const retryTargets: Array<EnvironmentQueryTarget<Input>> = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        const snapshot = readAtomQueryResult(result);
        isPending ||= snapshot.isPending;
        if (snapshot.error !== null && error === null) {
          error = snapshot.error;
        }
        if (snapshot.data !== null) values.push([target.environmentId, snapshot.data]);
        if (isSettledAtomQueryInterrupt(result)) retryTargets.push(target);
      }
      return { values, error, isPending, retryTargets };
      return { values, error, isPending, retryTargets };
    }).pipe(
      Atom.setIdleTTL(MERGED_PULL_REQUEST_QUERY_IDLE_TTL_MS),
      Atom.withLabel(`${label}:${key}`),
    ),
  );
  const empty = Atom.make<MergedEnvironmentQueryView<A, Input>>({
    values: [],
    error: null,
    isPending: false,
    retryTargets: [],
  }).pipe(Atom.withLabel(`${label}:empty`));
  return function useMergedQuery(targets: ReadonlyArray<EnvironmentQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = useCallback(() => {
      for (const target of JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>) {
        appAtomRegistry.refresh(atomFor(target));
      }
    }, [key]);
    useRetryInterruptedQuery(view.retryTargets.length > 0, refresh, key);
    return {
      values: view.values,
      error: view.error,
      isPending: view.isPending,
      refresh,
    };
  };
}

const usePullRequestListsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list",
  pullRequestEnvironment.list,
);

const usePullRequestStatsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list-stats",
  pullRequestEnvironment.listStats,
);

export interface MergedPullRequestListView {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

/** One listing per environment, merged into the single list the page renders. */
export function usePullRequestList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
): MergedPullRequestListView {
  const query = usePullRequestListsQuery(targets);
  const data = useMemo(() => mergePullRequestLists(query.values), [query.values]);
  return { data, error: query.error, isPending: query.isPending, refresh: query.refresh };
}

/** The line counts for the rows on screen, asked of each environment for its own rows. */
export function usePullRequestListStats(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
): {
  readonly stats: ReadonlyArray<EnvironmentPullRequestStat> | null;
  readonly refresh: () => void;
} {
  const query = usePullRequestStatsQuery(targets);
  const stats = useMemo(
    () =>
      query.values.length === 0
        ? null
        : query.values.flatMap(([environmentId, result]) =>
            result.stats.map((stat) => ({ ...stat, environmentId })),
          ),
    [query.values],
  );
  return { stats, refresh: query.refresh };
}
