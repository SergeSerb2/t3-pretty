import type { EnvironmentId } from "@t3tools/contracts";

export interface VcsStatusTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}

/**
 * Whether an open thread should force a VCS refresh because its latest turn
 * just finished. Mounting or switching threads must not refresh — that would
 * hit the forge on every row navigation. A completedAt change on the same
 * thread is the moment an agent-created pull request is likely to exist.
 */
export function shouldRefreshGitStatusAfterTurnComplete(input: {
  readonly previousThreadId: string | null;
  readonly threadId: string | null;
  readonly previousCompletedAt: string | null;
  readonly completedAt: string | null;
}): boolean {
  if (input.threadId === null || input.threadId !== input.previousThreadId) {
    return false;
  }
  return input.completedAt !== null && input.completedAt !== input.previousCompletedAt;
}
