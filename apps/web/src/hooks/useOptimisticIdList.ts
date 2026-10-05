import { useCallback, useEffect, useState } from "react";

/** Same ids regardless of order. */
export function sameIdMembers(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

export interface OptimisticIdOverlay<T extends string> {
  readonly targetKey: string;
  readonly ids: ReadonlyArray<T>;
}

/**
 * Overlay ids for `targetKey`, or null when the overlay belongs to another
 * target or the server has already caught up.
 */
export function overlayIdsForTarget<T extends string>(
  overlay: OptimisticIdOverlay<T> | null,
  targetKey: string,
  serverIds: ReadonlyArray<T>,
): ReadonlyArray<T> | null {
  if (overlay === null || overlay.targetKey !== targetKey) {
    return null;
  }
  return sameIdMembers(overlay.ids, serverIds) ? null : overlay.ids;
}

export function resetOptimisticOverlayForFailedIds<T extends string>(
  overlay: OptimisticIdOverlay<T> | null,
  targetKey: string,
  failedIds?: ReadonlyArray<T>,
): OptimisticIdOverlay<T> | null {
  if (overlay === null || overlay.targetKey !== targetKey) return overlay;
  if (failedIds !== undefined && !sameIdMembers(overlay.ids, failedIds)) return overlay;
  return null;
}

/**
 * Overlay for a server-owned id list that is written by full replacement.
 *
 * Successive edits chain off the last list the client sent rather than the
 * server value, which lags a round trip behind: without this a second toggle
 * made before the first one echoes back is computed from the stale list and
 * silently drops the first. The overlay also moves the switch immediately.
 * It is keyed by `targetKey` (thread, environment, …) so a route change
 * cannot apply one target's pending list to another. It clears itself once
 * the server reports the same set; call `reset` with the failed write's ids
 * so an older failure cannot roll back a newer optimistic edit.
 */
export function useOptimisticIdList<T extends string>(
  serverIds: ReadonlyArray<T>,
  targetKey: string,
) {
  const [overlay, setOverlay] = useState<OptimisticIdOverlay<T> | null>(null);
  const pendingIds = overlayIdsForTarget(overlay, targetKey, serverIds);
  useEffect(() => {
    if (
      overlay !== null &&
      overlay.targetKey === targetKey &&
      sameIdMembers(overlay.ids, serverIds)
    ) {
      setOverlay(null);
    }
  }, [overlay, serverIds, targetKey]);
  const setIds = useCallback(
    (next: ReadonlyArray<T>) => {
      setOverlay({ targetKey, ids: next });
    },
    [targetKey],
  );
  const reset = useCallback(
    (failedIds?: ReadonlyArray<T>) => {
      setOverlay((current) => resetOptimisticOverlayForFailedIds(current, targetKey, failedIds));
    },
    [targetKey],
  );
  return {
    ids: pendingIds ?? serverIds,
    setIds,
    reset,
  };
}
