import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
  highlightNativeReviewDiffVisibleRows,
  type NativeReviewDiffHighlightEngine,
  type NativeReviewDiffHighlightScheme,
} from "../diffs/nativeReviewDiffHighlighter";
import type { NativeReviewDiffRow } from "../diffs/nativeReviewDiffSurface";
import type { NativeReviewDiffFile } from "../diffs/nativeReviewDiffTypes";

import {
  createReviewDiffHighlightScheduler,
  type NativeReviewVisibleRange,
} from "./reviewDiffHighlightScheduler";

function subscribeAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}
const getAppIsActive = () => AppState.currentState === "active";

function createEmptyTokenPatch(resetKey: string): string {
  return JSON.stringify({ resetKey, tokensByRowId: {} });
}

function isReviewDiffDebugLoggingEnabled(): boolean {
  return typeof __DEV__ !== "undefined" ? __DEV__ : false;
}

function logReviewDiffDiagnostic(message: string, details?: Record<string, unknown>): void {
  if (!isReviewDiffDebugLoggingEnabled()) {
    return;
  }

  if (details) {
    console.log(`[review-sheet] ${message}`, details);
    return;
  }

  console.log(`[review-sheet] ${message}`);
}

export function useNativeReviewDiffHighlighting(input: {
  readonly files: ReadonlyArray<NativeReviewDiffFile>;
  readonly rows: ReadonlyArray<NativeReviewDiffRow>;
  readonly scheme: NativeReviewDiffHighlightScheme;
  readonly resetKey: string;
  readonly enabled: boolean;
}) {
  const { enabled, files, resetKey, rows, scheme } = input;
  const focused = useIsFocused();
  const appIsActive = useSyncExternalStore(subscribeAppState, getAppIsActive);
  const active = enabled && focused && appIsActive;
  const highlightedRowIdsRef = useRef<Set<string>>(new Set());
  const [visibleRange, setVisibleRange] = useState<NativeReviewVisibleRange>({
    firstRowIndex: 0,
    lastRowIndex: 80,
  });
  const visibleChunkIndexRef = useRef(0);
  const [tokensPatchJson, setTokensPatchJson] = useState(() => createEmptyTokenPatch(resetKey));
  const [scheduler] = useState(() => createReviewDiffHighlightScheduler(setVisibleRange));
  const previousContent = useRef({ resetKey, rowCount: rows.length });

  useEffect(() => {
    if (
      previousContent.current.resetKey !== resetKey ||
      previousContent.current.rowCount !== rows.length
    ) {
      previousContent.current = { resetKey, rowCount: rows.length };
      scheduler.reset();
      highlightedRowIdsRef.current = new Set();
      visibleChunkIndexRef.current = 0;
      setVisibleRange({ firstRowIndex: 0, lastRowIndex: 80 });
      setTokensPatchJson(createEmptyTokenPatch(resetKey));
    }
    return () => scheduler.cancel();
  }, [resetKey, rows.length, scheduler]);

  useEffect(() => {
    if (!active) scheduler.cancel();
  }, [active, scheduler]);

  useEffect(() => {
    if (!active || rows.length === 0) {
      return;
    }

    const abortController = new AbortController();
    const requestRange = visibleRange;
    const engine: NativeReviewDiffHighlightEngine = "native";

    void (async () => {
      try {
        const result = await highlightNativeReviewDiffVisibleRows({
          files,
          rows,
          scheme,
          engine,
          firstRowIndex: requestRange.firstRowIndex,
          lastRowIndex: requestRange.lastRowIndex,
          alreadyHighlightedRowIds: highlightedRowIdsRef.current,
          signal: abortController.signal,
        });

        if (abortController.signal.aborted || !getAppIsActive() || result.rowCount === 0) {
          return;
        }

        for (const rowId of Object.keys(result.tokensByRowId)) {
          highlightedRowIdsRef.current.add(rowId);
        }

        const chunkIndex = visibleChunkIndexRef.current;
        visibleChunkIndexRef.current += 1;
        setTokensPatchJson(
          JSON.stringify({
            resetKey,
            chunkIndex,
            fileId: "visible",
            filePath: "visible rows",
            language: "diff",
            lineCount: result.rowCount,
            durationMs: result.durationMs,
            tokensByRowId: result.tokensByRowId,
          }),
        );
      } catch (error) {
        if (!abortController.signal.aborted) {
          logReviewDiffDiagnostic("native visible highlight failed", {
            error,
            resetKey,
            scheme,
            firstRowIndex: requestRange.firstRowIndex,
            lastRowIndex: requestRange.lastRowIndex,
          });
        }
      }
    })();

    return () => abortController.abort();
  }, [active, files, resetKey, rows, scheme, visibleRange]);

  const updateVisibleRange = useCallback(
    (range: NativeReviewVisibleRange) => {
      if (active) scheduler.update(range);
    },
    [active, scheduler],
  );

  return {
    tokensPatchJson,
    updateVisibleRange,
  };
}
