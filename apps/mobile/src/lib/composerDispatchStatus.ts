export type ComposerDispatchPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "preparing-images"; readonly count: number }
  | {
      readonly kind: "sending";
      readonly creatingThread: boolean;
      readonly connected: boolean;
      readonly hasImages: boolean;
    };

/**
 * Caption for the composer while images are still being read or a send is in
 * flight. The send control greys out in these states; this copy is the
 * reason, so a stalled-looking button is not the only signal.
 */
export function composerDispatchStatusLabel(phase: ComposerDispatchPhase): string | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "preparing-images":
      return phase.count === 1 ? "Preparing image..." : "Preparing images...";
    case "sending":
      if (phase.creatingThread) {
        if (!phase.connected) {
          return phase.hasImages ? "Queueing images..." : "Queueing task...";
        }
        return phase.hasImages ? "Sending images..." : "Starting thread...";
      }
      return phase.hasImages ? "Sending images..." : "Sending...";
  }
}
