export type ComposerDispatchPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing-images"; readonly count: number }
  | {
      readonly kind: "sending";
      readonly creatingThread: boolean;
      readonly connected: boolean;
    };

/**
 * Caption for the composer while a send is in flight. The send control used
 * to grey out with no other signal; this copy names the wait so a slow
 * connection is not mistaken for a dead button.
 */
export function composerDispatchStatusLabel(phase: ComposerDispatchPhase): string | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "preparing-images":
      return phase.count === 1 ? "Preparing image..." : "Preparing images...";
    case "sending":
      if (phase.creatingThread) {
        return phase.connected ? "Starting thread..." : "Queueing task...";
      }
      return phase.connected ? "Sending..." : "Queueing...";
  }
}

/**
 * Keep the local send flag on until the outbox has either started delivering
 * this thread's message, parked it behind a running turn / offline queue, or
 * drained it. Closes the gap between enqueue (sync) and startTurn (slow).
 */
export function shouldKeepLocalComposerSendBusy(input: {
  readonly isDeliveringQueuedMessage: boolean;
  readonly connected: boolean;
  readonly threadBusy: boolean;
  readonly queueCount: number;
}): boolean {
  if (input.isDeliveringQueuedMessage) {
    return false;
  }
  if (!input.connected) {
    return false;
  }
  if (input.threadBusy && input.queueCount > 0) {
    return false;
  }
  return input.queueCount > 0;
}
