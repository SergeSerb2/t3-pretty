import { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Result from "effect/Result";

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  buildReviewCommentTarget,
  clearReviewCommentTarget,
  formatReviewSelectedRangeLabel,
  getSelectedReviewCommentLines,
  setReviewCommentTarget,
  useReviewCommentTarget,
} from "./reviewCommentSelection";
import type {
  NativeReviewDiffData,
  NativeReviewDiffCommentTarget,
} from "./nativeReviewDiffAdapter";
import type { ReviewSectionItem } from "./reviewModel";

interface PendingNativeCommentSelection extends NativeReviewDiffCommentTarget {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly rowId: string;
}

export function useReviewCommentSelectionController(input: {
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly selectedSection: ReviewSectionItem | null;
  readonly nativeReviewDiffData: NativeReviewDiffData;
}) {
  const { environmentId, nativeReviewDiffData, selectedSection, threadId } = input;
  const navigation = useNavigation();
  const activeCommentTarget = useReviewCommentTarget();
  const [pendingNativeCommentSelection, setPendingNativeCommentSelection] =
    useState<PendingNativeCommentSelection | null>(null);
  // A refresh can reuse row IDs while replacing the source lines. Drop the
  // anchor before rendering actions or accepting an end line from a new file.
  if (
    pendingNativeCommentSelection &&
    nativeReviewDiffData.commentTargetsByRowId.get(pendingNativeCommentSelection.rowId)?.lines !==
      pendingNativeCommentSelection.lines
  ) {
    setPendingNativeCommentSelection(null);
  }

  const openReviewCommentSheet = useCallback(() => {
    if (!environmentId || !threadId) {
      return;
    }

    navigation.navigate("ThreadReviewComment", {
      environmentId,
      threadId,
    });
  }, [environmentId, navigation, threadId]);

  const selectedRowIds = useMemo(() => {
    if (
      activeCommentTarget &&
      activeCommentTarget.sectionTitle === selectedSection?.title &&
      activeCommentTarget.startIndex !== activeCommentTarget.endIndex
    ) {
      return pipe(
        getSelectedReviewCommentLines(activeCommentTarget),
        Arr.filterMap((line) => {
          const rowId = nativeReviewDiffData.rowIdByCommentLineId.get(line.id);
          return rowId ? Result.succeed(rowId) : Result.failVoid;
        }),
      );
    }

    return pendingNativeCommentSelection ? [pendingNativeCommentSelection.rowId] : [];
  }, [
    activeCommentTarget,
    nativeReviewDiffData.rowIdByCommentLineId,
    pendingNativeCommentSelection,
    selectedSection?.title,
  ]);

  const selectionAction = useMemo(() => {
    if (
      activeCommentTarget &&
      activeCommentTarget.sectionTitle === selectedSection?.title &&
      activeCommentTarget.startIndex !== activeCommentTarget.endIndex
    ) {
      return {
        title: `Comment on ${formatReviewSelectedRangeLabel(activeCommentTarget)}`,
        onOpenComment: openReviewCommentSheet,
      };
    }

    if (
      pendingNativeCommentSelection &&
      pendingNativeCommentSelection.sectionTitle === selectedSection?.title
    ) {
      return {
        title: "Select range end",
        onOpenComment: null,
      };
    }

    return null;
  }, [
    activeCommentTarget,
    openReviewCommentSheet,
    pendingNativeCommentSelection,
    selectedSection?.title,
  ]);

  useEffect(() => {
    clearReviewCommentTarget();
    setPendingNativeCommentSelection(null);
    return () => {
      clearReviewCommentTarget();
    };
  }, [environmentId, selectedSection?.id, threadId]);

  const onPressLine = useCallback(
    (
      event: NativeSyntheticEvent<{
        readonly rowId?: string;
        readonly gesture?: "tap" | "longPress";
      }>,
    ) => {
      if (!selectedSection) {
        return;
      }

      const { rowId, gesture } = event.nativeEvent;
      if (!rowId) {
        return;
      }

      const target = nativeReviewDiffData.commentTargetsByRowId.get(rowId);
      if (!target) {
        return;
      }

      if (gesture === "longPress") {
        clearReviewCommentTarget();
        setPendingNativeCommentSelection({
          ...target,
          sectionId: selectedSection.id,
          sectionTitle: selectedSection.title,
          rowId,
        });
        return;
      }

      if (
        pendingNativeCommentSelection &&
        pendingNativeCommentSelection.sectionId === selectedSection.id &&
        pendingNativeCommentSelection.sectionTitle === selectedSection.title &&
        pendingNativeCommentSelection.filePath === target.filePath &&
        pendingNativeCommentSelection.lines === target.lines
      ) {
        setReviewCommentTarget(
          buildReviewCommentTarget(
            {
              sectionTitle: pendingNativeCommentSelection.sectionTitle,
              sectionId: pendingNativeCommentSelection.sectionId,
              filePath: pendingNativeCommentSelection.filePath,
              lines: pendingNativeCommentSelection.lines,
            },
            pendingNativeCommentSelection.lineIndex,
            target.lineIndex,
          ),
        );
        // The anchor belongs only to an unfinished range. Clearing it here
        // avoids reusing it after dismissal, without erasing a new long press.
        setPendingNativeCommentSelection(null);
        return;
      }

      setPendingNativeCommentSelection(null);
      setReviewCommentTarget({
        sectionTitle: selectedSection.title,
        sectionId: selectedSection.id,
        filePath: target.filePath,
        lines: target.lines,
        startIndex: target.lineIndex,
        endIndex: target.lineIndex,
      });
      openReviewCommentSheet();
    },
    [
      nativeReviewDiffData.commentTargetsByRowId,
      openReviewCommentSheet,
      pendingNativeCommentSelection,
      selectedSection,
    ],
  );

  const clearSelection = useCallback(() => {
    clearReviewCommentTarget();
    setPendingNativeCommentSelection(null);
  }, []);

  return {
    selectedRowIds,
    selectionAction,
    onPressLine,
    clearSelection,
  };
}
