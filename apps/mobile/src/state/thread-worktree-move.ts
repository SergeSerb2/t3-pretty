import type { OrchestrationSessionStatus } from "@t3tools/contracts";

/**
 * Stop the provider session only when both worktree paths are known and
 * differ. An unloaded current path is not a move — treating
 * `null !== nextPath` as a change would kill a live session on a create
 * that stayed put.
 */
export function shouldStopSessionOnWorktreeMove(input: {
  readonly sessionStatus: OrchestrationSessionStatus | undefined;
  readonly currentWorktreePath: string | null;
  readonly nextWorktreePath: string;
}): boolean {
  if (input.sessionStatus == null || input.sessionStatus === "stopped") {
    return false;
  }
  return input.currentWorktreePath != null && input.currentWorktreePath !== input.nextWorktreePath;
}
