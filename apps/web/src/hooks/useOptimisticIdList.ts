import { useCallback, useEffect, useState } from "react";

/** Same ids regardless of order. */
export function sameIdMembers(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/**
 * Overlay for a server-owned id list that is written by full replacement.
 *
 * Successive edits chain off the last list the client sent rather than the
 * server value, which lags a round trip behind: without this a second toggle
 * made before the first one echoes back is computed from the stale list and
 * silently drops the first. The overlay also moves the switch immediately.
 * It clears itself once the server reports the same set; call `reset` when a
 * write fails so the UI falls back to the truth.
 */
export function useOptimisticIdList<T extends string>(serverIds: ReadonlyArray<T>) {
  const [pendingIds, setPendingIds] = useState<ReadonlyArray<T> | null>(null);
  useEffect(() => {
    if (pendingIds !== null && sameIdMembers(pendingIds, serverIds)) {
      setPendingIds(null);
    }
  }, [pendingIds, serverIds]);
  const reset = useCallback(() => setPendingIds(null), []);
  return {
    ids: pendingIds ?? serverIds,
    setIds: setPendingIds as (next: ReadonlyArray<T>) => void,
    reset,
  };
}
