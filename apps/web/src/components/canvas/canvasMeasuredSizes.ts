/**
 * Client-measured node sizes for the canvas surface.
 *
 * Notes size to their text, so the document cannot describe their height; note
 * renderers report their layout size here (ResizeObserver, unscaled layout px
 * = world units) and hit-testing / selection math reads the immutable snapshot
 * through `CanvasMeasuredSizes`. One store instance per mounted viewport.
 */
import { createContext, useSyncExternalStore } from "react";

import type { CanvasMeasuredSizes } from "~/canvasDocSync";

export interface CanvasMeasuredSizesStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => CanvasMeasuredSizes;
  readonly report: (nodeId: string, size: { width: number; height: number }) => void;
  readonly clear: (nodeId: string) => void;
}

export function createCanvasMeasuredSizesStore(): CanvasMeasuredSizesStore {
  let snapshot = new Map<string, { width: number; height: number }>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    // Snapshot first: a listener may unsubscribe (or add one) while notifying.
    const current = Array.from(listeners);
    for (const listener of current) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    report(nodeId, size) {
      const current = snapshot.get(nodeId);
      // Sub-pixel jitter from ResizeObserver must not trigger render loops.
      if (
        current &&
        Math.abs(current.width - size.width) < 0.5 &&
        Math.abs(current.height - size.height) < 0.5
      ) {
        return;
      }
      snapshot = new Map(snapshot);
      snapshot.set(nodeId, size);
      emit();
    },
    clear(nodeId) {
      if (!snapshot.has(nodeId)) return;
      snapshot = new Map(snapshot);
      snapshot.delete(nodeId);
      emit();
    },
  };
}

export const CanvasMeasuredSizesContext = createContext<CanvasMeasuredSizesStore | null>(null);

/** Reactive snapshot; components re-render when any node's measured size changes. */
export function useCanvasMeasuredSizes(store: CanvasMeasuredSizesStore): CanvasMeasuredSizes {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
