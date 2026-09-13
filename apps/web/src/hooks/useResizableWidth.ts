import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

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
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: { readonly key: string; readonly shiftKey: boolean }) => void;
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
 * lifts the pointer or the drag is interrupted.
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
  const latestOptions = useRef({ clamp, storageKey });
  useLayoutEffect(() => {
    latestOptions.current = { clamp, storageKey };
  }, [clamp, storageKey]);

  const handlers = useResizeDrag<HTMLElement>(() => ({
    width: clampedWidth,
    edge,
    resize(value) {
      const nextWidth = latestOptions.current.clamp(value);
      setWidth(nextWidth);
      return nextWidth;
    },
    finish(finalWidth) {
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      try {
        setLocalStorageItem(latestOptions.current.storageKey, finalWidth, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
    },
  }));

  const activePointerIdRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onPointerDown(event);
      if (activePointerIdRef.current !== null || !event.isPrimary || event.button !== 0) return;
      activePointerIdRef.current = event.pointerId;
      setIsResizing(true);
    },
    [handlers],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onPointerUp(event);
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;
      setIsResizing(false);
    },
    [handlers],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onPointerCancel(event);
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;
      setIsResizing(false);
    },
    [handlers],
  );

  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onLostPointerCapture(event);
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;
      setIsResizing(false);
    },
    [handlers],
  );

  const onKeyDown = useCallback(
    (event: { readonly key: string; readonly shiftKey: boolean }) => {
      const nextWidth = resizableWidthFromKeyboard({
        key: event.key,
        currentWidth: clampedWidth,
        minWidth,
        maxWidth,
        edge,
        step: event.shiftKey ? 64 : 16,
      });
      if (nextWidth === null) return;
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
      onPointerMove: handlers.onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
}
