import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentShellState } from "./shell.ts";
import {
  applyPendingThreadLifecycleToSnapshot,
  type ThreadLifecyclePendingByEnvironment,
} from "./threadLifecycleOutbox.ts";
export function createEnvironmentSnapshotAtom<E>(
  shellStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentShellState, E>>,
  pendingLifecycleAtom?: Atom.Atom<ThreadLifecyclePendingByEnvironment>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): OrchestrationV2ShellSnapshot | null => {
      const snapshot = Option.match(AsyncResult.value(get(shellStateAtom(environmentId))), {
        onNone: () => null,
        onSome: (state) => Option.getOrNull(state.snapshot),
      });
      if (snapshot === null || pendingLifecycleAtom === undefined) return snapshot;
      return applyPendingThreadLifecycleToSnapshot(
        snapshot,
        get(pendingLifecycleAtom).get(environmentId) ?? [],
      );
    }).pipe(Atom.withLabel(`environment-snapshot:${environmentId}`)),
  );
}
