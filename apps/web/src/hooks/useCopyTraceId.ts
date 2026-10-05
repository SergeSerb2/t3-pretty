import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function useCopyTraceId(): (traceId: string) => void {
  const { copyToClipboard } = useCopyToClipboard<{ traceId: string }>({
    target: "trace ID",
    onCopy: ({ traceId }) => {
      toastManager.add({
        type: "success",
        title: "Trace ID copied",
        description: traceId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy trace ID",
          description: error.message,
        }),
      );
    },
  });

  return useCallback(
    (traceId: string) => {
      copyToClipboard(traceId, { traceId });
    },
    [copyToClipboard],
  );
}
