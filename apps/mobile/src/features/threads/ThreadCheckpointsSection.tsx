import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useThreadDetail } from "../../state/use-thread-detail";
import { getReadyReviewCheckpoints } from "../review/reviewModel";
import { useThreadCheckpointRevert } from "./use-thread-checkpoint-revert";

/**
 * Checkpoints card on the existing-thread settings sheet: one row per ready
 * checkpoint (newest first, same order as Review) with a revert action per
 * row — mobile's stand-in for web's per-user-message revert, which has no
 * message context-menu surface here. Hidden entirely when the thread has no
 * ready checkpoints (new threads, or detail still loading).
 */
export const ThreadCheckpointsSection = memo(function ThreadCheckpointsSection(props: {
  readonly threadRef: ScopedThreadRef;
}) {
  const detailState = useThreadDetail({
    environmentId: props.threadRef.environmentId,
    threadId: props.threadRef.threadId,
  });
  const checkpoints = Option.getOrNull(detailState.data)?.checkpoints;
  const readyCheckpoints = useMemo(
    () => getReadyReviewCheckpoints(checkpoints ?? []),
    [checkpoints],
  );
  const { confirmRevertToCheckpoint, revertingTurnCount } = useThreadCheckpointRevert(
    props.threadRef,
  );

  if (readyCheckpoints.length === 0) {
    return null;
  }

  return (
    <>
      <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
        Checkpoints
      </Text>
      <View className="mx-4 overflow-hidden rounded-2xl bg-card">
        {readyCheckpoints.map((checkpoint, index) => {
          const revertingThis = revertingTurnCount === checkpoint.checkpointTurnCount;
          const fileCount = checkpoint.files.length;
          return (
            <Pressable
              key={checkpoint.checkpointTurnCount}
              accessibilityLabel={`Revert to turn ${checkpoint.checkpointTurnCount}`}
              accessibilityRole="button"
              disabled={revertingTurnCount !== null}
              onPress={() => confirmRevertToCheckpoint(checkpoint.checkpointTurnCount)}
              className={cn(
                "min-h-11 flex-row items-center gap-2 px-5 py-2.5 active:opacity-70 disabled:opacity-50",
                index < readyCheckpoints.length - 1 && "border-b border-border-subtle",
              )}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-t3-medium text-foreground">
                  Turn {checkpoint.checkpointTurnCount}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {fileCount} file{fileCount === 1 ? "" : "s"} changed
                </Text>
              </View>
              <Text
                className={cn(
                  "text-sm font-t3-medium",
                  revertingThis ? "text-foreground-muted" : "text-red-600 dark:text-red-400",
                )}
              >
                {revertingThis ? "Reverting…" : "Revert"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
});
