import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/**
 * Environment labels resolve to the machine's friendly name on the server, so a
 * normalized label is the only client-side key for "same machine".
 */
export function environmentMachineKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/gu, " ");
}

export interface ThreadEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly machineKey: string;
  readonly threadIds: ReadonlySet<ThreadId>;
}

/**
 * Prefer a live same-machine connection that already has this thread when the
 * catalog entry the row was scoped to has no session. Same thread id on another
 * catalog row for that hostname is the same server (regenerated id, leftover
 * LAN save, or a mesh twin), not a copied thread.
 */
export function resolveWritableThreadEnvironmentId(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly candidates: ReadonlyArray<ThreadEnvironmentCandidate>;
}): EnvironmentId {
  const current = input.candidates.find(
    (candidate) => candidate.environmentId === input.environmentId,
  );
  if (current?.connected === true) {
    return input.environmentId;
  }

  if (current === undefined) {
    return input.environmentId;
  }

  const sameMachine = input.candidates.find(
    (candidate) =>
      candidate.connected &&
      candidate.machineKey === current.machineKey &&
      candidate.threadIds.has(input.threadId),
  );
  return sameMachine?.environmentId ?? input.environmentId;
}
