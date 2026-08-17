import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  mergePresentedThreadShells,
  optimisticStartingThreadKey,
  optimisticStartingThreadToShell,
  type OptimisticStartingThread,
} from "../lib/optimisticThreadSend";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { useThreadShells } from "./entities";

const optimisticStartingThreadsAtom = Atom.make<Readonly<Record<string, OptimisticStartingThread>>>(
  {},
).pipe(Atom.keepAlive, Atom.withLabel("mobile:optimistic-starting-threads"));

export function registerOptimisticStartingThread(thread: OptimisticStartingThread): void {
  const key = optimisticStartingThreadKey(thread);
  const current = appAtomRegistry.get(optimisticStartingThreadsAtom);
  if (current[key] === thread) {
    return;
  }
  appAtomRegistry.set(optimisticStartingThreadsAtom, {
    ...current,
    [key]: thread,
  });
}

export function clearOptimisticStartingThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): void {
  const key = scopedThreadKey(environmentId, threadId);
  const current = appAtomRegistry.get(optimisticStartingThreadsAtom);
  if (current[key] === undefined) {
    return;
  }
  const next = { ...current };
  delete next[key];
  appAtomRegistry.set(optimisticStartingThreadsAtom, next);
}

export function useOptimisticStartingThreads(): ReadonlyArray<OptimisticStartingThread> {
  const byKey = useAtomValue(optimisticStartingThreadsAtom);
  return useMemo(() => Object.values(byKey), [byKey]);
}

export function useOptimisticStartingThread(input: {
  readonly environmentId?: EnvironmentId | null;
  readonly threadId?: ThreadId | null;
}): OptimisticStartingThread | null {
  const byKey = useAtomValue(optimisticStartingThreadsAtom);
  if (input.environmentId == null || input.threadId == null) {
    return null;
  }
  return byKey[scopedThreadKey(input.environmentId, input.threadId)] ?? null;
}

export function useOptimisticStartingThreadShell(input: {
  readonly environmentId?: EnvironmentId | null;
  readonly threadId?: ThreadId | null;
}): EnvironmentThreadShell | null {
  const starting = useOptimisticStartingThread(input);
  return useMemo(
    () => (starting === null ? null : optimisticStartingThreadToShell(starting)),
    [starting],
  );
}

/**
 * Server shells plus local starting threads the list should treat as real.
 * Drain / outbox code must keep using `useThreadShells()` — a starting
 * overlay must not look like the creation command already landed.
 */
export function usePresentedThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const serverShells = useThreadShells();
  const startingThreads = useOptimisticStartingThreads();
  return useMemo(
    () => mergePresentedThreadShells(serverShells, startingThreads),
    [serverShells, startingThreads],
  );
}
