import type { EnvironmentId, OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentShellState } from "./shell.ts";
import {
  applyPendingThreadLifecycleToSnapshot,
  EMPTY_THREAD_LIFECYCLE_PENDING,
  type ThreadLifecyclePendingByEnvironment,
} from "./threadLifecycleOutbox.ts";

export function createEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
  pendingLifecycleAtom?: Atom.Atom<ThreadLifecyclePendingByEnvironment>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): OrchestrationShellSnapshot | null => {
      const snapshot = Option.match(AsyncResult.value(get(shellStateAtom(environmentId))), {
        onNone: () => null,
        onSome: (state) => Option.getOrNull(state.snapshot),
      });
      if (snapshot === null || pendingLifecycleAtom === undefined) {
        return snapshot;
      }
      const pending =
        get(pendingLifecycleAtom).get(environmentId) ??
        EMPTY_THREAD_LIFECYCLE_PENDING.get(environmentId) ??
        [];
      return applyPendingThreadLifecycleToSnapshot(snapshot, pending);
    }).pipe(Atom.withLabel(`environment-snapshot:${environmentId}`)),
  );
}
