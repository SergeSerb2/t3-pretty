import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useRemoteEnvironmentRuntime,
  useSavedRemoteConnection,
} from "../../state/use-remote-environment-registry";
import {
  checkpointEnvironmentAvailable,
  checkpointRemoteConnectionState,
  checkpointRevertBlockReason,
  checkpointRevertConfirmation,
} from "./thread-checkpoint-revert";

/**
 * Revert action for one thread's checkpoints. Guards mirror web
 * (ChatView.onRevertToTurnCount): environment connected, no live turn; the
 * destructive confirm keeps web's wording. Failures surface the mobile way —
 * an alert, same as the thread-list command failures.
 */
export function useThreadCheckpointRevert(threadRef: ScopedThreadRef | null): {
  /** Turn count currently reverting, so the list can disable and mark its row. */
  readonly revertingTurnCount: number | null;
  readonly confirmRevertToCheckpoint: (turnCount: number) => void;
} {
  const revertMutation = useAtomCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const thread = useThreadShell(threadRef);
  const runtime = useRemoteEnvironmentRuntime(threadRef?.environmentId ?? null);
  const connection = useSavedRemoteConnection(threadRef?.environmentId ?? null);
  const [revertingTurnCount, setRevertingTurnCount] = useState<number | null>(null);
  const environmentAvailable = checkpointEnvironmentAvailable(
    checkpointRemoteConnectionState(runtime?.connectionState, connection != null),
  );

  const revertToCheckpoint = useCallback(
    async (turnCount: number) => {
      if (threadRef === null || revertingTurnCount !== null) {
        return;
      }
      setRevertingTurnCount(turnCount);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const result = await revertMutation({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, turnCount },
        });
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not revert checkpoint",
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "The thread could not be reverted.",
          );
        }
      } finally {
        setRevertingTurnCount(null);
      }
    },
    [revertMutation, revertingTurnCount, threadRef],
  );

  const confirmRevertToCheckpoint = useCallback(
    (turnCount: number) => {
      if (threadRef === null) {
        return;
      }
      const blockReason = checkpointRevertBlockReason({
        environmentAvailable,
        environmentLabel: connection?.environmentLabel ?? null,
        sessionRunning:
          thread?.session?.status === "running" || thread?.session?.status === "starting",
      });
      if (blockReason !== null) {
        Alert.alert("Could not revert checkpoint", blockReason);
        return;
      }
      const confirmation = checkpointRevertConfirmation(turnCount);
      if (process.env.EXPO_OS === "ios") {
        Alert.alert(confirmation.title, confirmation.message, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revert",
            style: "destructive",
            onPress: () => {
              void revertToCheckpoint(turnCount);
            },
          },
        ]);
        return;
      }
      showConfirmDialog({
        title: confirmation.title,
        message: confirmation.message,
        confirmText: "Revert",
        destructive: true,
        onConfirm: () => {
          void revertToCheckpoint(turnCount);
        },
      });
    },
    [
      connection?.environmentLabel,
      environmentAvailable,
      revertToCheckpoint,
      thread?.session?.status,
      threadRef,
    ],
  );

  return { confirmRevertToCheckpoint, revertingTurnCount };
}
