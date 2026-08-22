/**
 * Guard and copy rules for reverting a thread to a checkpoint. Mirrors web's
 * ChatView.onRevertToTurnCount: the environment must be connected, and a
 * running turn must be interrupted first.
 */
export function checkpointRevertBlockReason(input: {
  readonly environmentAvailable: boolean;
  readonly environmentLabel: string | null;
  readonly sessionRunning: boolean;
}): string | null {
  if (!input.environmentAvailable) {
    return `Reconnect ${input.environmentLabel ?? "the environment"} before reverting checkpoints.`;
  }
  if (input.sessionRunning) {
    return "Interrupt the current turn before reverting checkpoints.";
  }
  return null;
}

export function checkpointRevertConfirmation(turnCount: number): {
  readonly title: string;
  readonly message: string;
} {
  return {
    title: `Revert this thread to checkpoint ${turnCount}?`,
    message:
      "This will discard newer messages and turn diffs in this thread. This action cannot be undone.",
  };
}
