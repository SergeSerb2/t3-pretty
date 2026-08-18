import type { OrchestrationThreadShell, ProjectId } from "@t3tools/contracts";

/**
 * First-send bootstrap reuses a persisted draft thread id. Remote clients often
 * retry that same id after a timeout, or reopen a draft whose server thread
 * already exists but has not reached the client snapshot yet.
 */
export function isCompatibleBootstrapThread(input: {
  readonly existing: Pick<OrchestrationThreadShell, "projectId">;
  readonly projectId: ProjectId;
}): boolean {
  return input.existing.projectId === input.projectId;
}

/**
 * A thread that already has a workspace or a started session must not get a
 * second worktree from a retry of `bootstrap.prepareWorktree`.
 */
export function shouldSkipBootstrapWorktreePrepare(
  existing: Pick<OrchestrationThreadShell, "worktreePath" | "latestTurn" | "session">,
): boolean {
  return (
    existing.worktreePath !== null || existing.latestTurn !== null || existing.session !== null
  );
}
