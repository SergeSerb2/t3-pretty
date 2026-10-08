import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  claimAtomQueryInterruptRetry,
  formatAtomQueryError,
  isSettledAtomQueryInterrupt,
  readAtomQueryResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-query:empty"),
);

export interface EnvironmentQueryView<A, E = unknown> {
  readonly data: A | null;
  readonly dataUpdatedAt: number | null;
  readonly error: string | null;
  readonly failure: E | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

export const formatEnvironmentQueryError = formatAtomQueryError;

export function useRetryInterruptedQuery(
  shouldRetry: boolean,
  refresh: () => void,
  generation: unknown,
): void {
  const claimedGeneration = useRef<unknown>(undefined);
  useEffect(() => {
    if (!shouldRetry) return;
    if (!claimAtomQueryInterruptRetry(claimedGeneration, generation)) return;
    refresh();
  }, [generation, refresh, shouldRetry]);
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A, E> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  const snapshot = readAtomQueryResult(result);
  useRetryInterruptedQuery(atom !== null && isSettledAtomQueryInterrupt(result), refresh, atom);

  return {
    data: snapshot.data,
    dataUpdatedAt: result._tag === "Success" ? result.timestamp : null,
    error: snapshot.error,
    failure:
      result._tag === "Failure" ? Option.getOrNull(Cause.findErrorOption(result.cause)) : null,
    isPending: atom !== null && snapshot.isPending,
    isSuccess: result._tag === "Success",
    refresh,
  };
}
