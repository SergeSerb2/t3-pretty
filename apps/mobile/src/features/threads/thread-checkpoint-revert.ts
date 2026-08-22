import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

/**
 * Guard and copy rules for reverting a thread to a checkpoint. Mirrors web's
 * ChatView.onRevertToTurnCount: the environment must be connected, and a
 * running turn must be interrupted first.
 *
 * Local/on-device threads have no remote runtime, so `connectionState` is
 * null — treat those as available, matching ThreadRouteScreen's
 * `?? "available"` fallback. A known remote is available only when connected.
 * A saved remote whose runtime has not loaded yet is "connecting", not local.
 */
export function checkpointRemoteConnectionState(
  runtimeConnectionState: EnvironmentConnectionPhase | undefined,
  savedRemotePresent: boolean,
): EnvironmentConnectionPhase | null {
  return runtimeConnectionState ?? (savedRemotePresent ? "connecting" : null);
}

export function checkpointEnvironmentAvailable(
  remoteConnectionState: EnvironmentConnectionPhase | null,
): boolean {
  return remoteConnectionState === null || remoteConnectionState === "connected";
}

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
