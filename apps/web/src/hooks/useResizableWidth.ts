import * as Schema from "effect/Schema";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

const WidthSchema = Schema.Finite;

export interface UseResizableWidthOptions {
  /** localStorage key the persisted width is stored under. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /**
   * Which edge of the host element carries the drag handle:
   *   - "left"  → panel grows leftward (right-anchored panels)
   *   - "right" → panel grows rightward (left-anchored panels)
   */
  readonly edge: "left" | "right";
}

export interface ResizableWidthHandlers {
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function resizableWidthFromKeyboard(input: {
  readonly key: string;
  readonly currentWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly edge: "left" | "right";
  readonly step: number;
}): number | null {
  const { currentWidth, edge, key, maxWidth, minWidth, step } = input;
  let next: number;
  if (key === "Home") next = minWidth;
  else if (key === "End") next = maxWidth;
  else if (key === "ArrowLeft") next = currentWidth + (edge === "left" ? step : -step);
  else if (key === "ArrowRight") next = currentWidth + (edge === "right" ? step : -step);
  else return null;
  return Math.max(minWidth, Math.min(maxWidth, next));
}

/**
 * Width state for a side-anchored panel resized via a drag handle on the
 * specified edge. Width is read from localStorage on mount and persisted on
 * drag-end (not on every rAF tick — would otherwise be ~60 writes/sec).
 *
 * The hook updates an internal `width` state during drag (so the panel
 * follows the cursor live) and only commits to localStorage when the user
 * lifts the pointer.
 */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly isResizing: boolean;
  readonly handlers: ResizableWidthHandlers;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge } = options;

  const clamp = useCallback(
    (value: number): number => {
      if (!Number.isFinite(value)) return defaultWidth;
      return Math.max(minWidth, Math.min(maxWidth, value));
    },
    [defaultWidth, maxWidth, minWidth],
  );

  // No cross-tab subscription: panel width is per-window state.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return clamp(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  });

  const clampedWidth = clamp(width);
  const [isResizing, setIsResizing] = useState(false);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    pending: number;
    rafId: number | null;
    target: HTMLElement;
    previousBodyCursor: string;
    previousBodyUserSelect: string;
  } | null>(null);

  const cleanupDrag = useCallback(() => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }
    try {
      if (state.target.hasPointerCapture(state.pointerId)) {
        state.target.releasePointerCapture(state.pointerId);
      }
    } catch {
      // pointer may already be released; harmless.
    }
    document.body.style.cursor = state.previousBodyCursor;
    document.body.style.userSelect = state.previousBodyUserSelect;
    dragStateRef.current = null;
  }, []);

  const releasePointer = useCallback(() => {
    cleanupDrag();
    setIsResizing(false);
  }, [cleanupDrag]);

  useEffect(
    () => () => {
      // A route or panel can disappear while it owns pointer capture. Release
      // every global side effect instead of leaving the whole app unselectable.
      cleanupDrag();
    },
    [cleanupDrag],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (dragStateRef.current !== null) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      const previousBodyCursor = document.body.style.cursor;
      const previousBodyUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: clampedWidth,
        pending: clampedWidth,
        rafId: null,
        target,
        previousBodyCursor,
        previousBodyUserSelect,
      };
    },
    [clampedWidth],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      const delta = edge === "left" ? state.startX - event.clientX : event.clientX - state.startX;
      state.pending = clamp(state.startWidth + delta);
      if (state.rafId !== null) return;
      state.rafId = requestAnimationFrame(() => {
        const active = dragStateRef.current;
        if (!active) return;
        active.rafId = null;
        setWidth(active.pending);
      });
    },
    [clamp, edge],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const finalWidth = clamp(state.pending);
      releasePointer();
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      try {
        setLocalStorageItem(storageKey, finalWidth, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
      setWidth(finalWidth);
    },
    [clamp, releasePointer, storageKey],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; revert to the start width.
      releasePointer();
      setWidth(state.startWidth);
    },
    [releasePointer],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const nextWidth = resizableWidthFromKeyboard({
        key: event.key,
        currentWidth: clampedWidth,
        minWidth,
        maxWidth,
        edge,
        step: event.shiftKey ? 64 : 16,
      });
      if (nextWidth === null) return;
      event.preventDefault();
      try {
        setLocalStorageItem(storageKey, nextWidth, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
      setWidth(nextWidth);
    },
    [clampedWidth, edge, maxWidth, minWidth, storageKey],
  );

  return {
    width: clampedWidth,
    isResizing,
    handlers: {
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
  };
}
