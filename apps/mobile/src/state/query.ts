import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  formatAtomQueryError,
  isAtomCauseInterrupted,
  readAtomQueryResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("mobile-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export const formatEnvironmentQueryError = formatAtomQueryError;

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  const snapshot = readAtomQueryResult(result);
  const shouldRetryInterrupt =
    atom !== null &&
    result._tag === "Failure" &&
    !result.waiting &&
    isAtomCauseInterrupted(result.cause);

  useEffect(() => {
    if (!shouldRetryInterrupt) return;
    refresh();
  }, [refresh, shouldRetryInterrupt]);

  return {
    data: snapshot.data,
    error: snapshot.error,
    isPending: atom !== null && snapshot.isPending,
    refresh,
  };
}
