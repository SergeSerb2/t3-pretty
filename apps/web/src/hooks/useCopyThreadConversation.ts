import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { loadThreadConversationText } from "../components/threadConversationCopy";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboard";

function copyConversationFailed(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Failed to copy conversation",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useCopyThreadConversation() {
  const { copyToClipboard } = useCopyToClipboard<{ title: string }>({
    onCopy: ({ title }) => {
      toastManager.add({
        type: "success",
        title: "Conversation copied",
        description: title,
      });
    },
    onError: (error) => copyConversationFailed(error),
  });

  return useCallback(
    (threadRef: ScopedThreadRef, title: string) => {
      void loadThreadConversationText(threadRef, title).then(
        (text) => {
          if (text === null) {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "No conversation to copy",
                description: "This thread has no messages yet.",
              }),
            );
            return;
          }
          copyToClipboard(text, { title });
        },
        (error: unknown) => copyConversationFailed(error),
      );
    },
    [copyToClipboard],
  );
}
