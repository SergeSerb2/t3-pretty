/**
 * The one rule that decides whether an automation run's thread has settled.
 * Shared by the event-driven tracker and the 30 s tick sweep so a completion
 * the tracker missed (server restart mid-turn) is picked up identically.
 */
import type { AutomationRunFinishedStatus, OrchestrationThreadShell } from "@t3tools/contracts";

export interface AutomationRunCompletion {
  readonly status: AutomationRunFinishedStatus;
  readonly error: string | null;
}

/**
 * Null while the run is still going. A settled latest turn maps to its
 * outcome; a session that errored before any turn started is a failure.
 */
export function resolveAutomationRunCompletion(
  thread: Pick<OrchestrationThreadShell, "latestTurn" | "session">,
): AutomationRunCompletion | null {
  const turn = thread.latestTurn;
  if (turn !== null) {
    switch (turn.state) {
      case "running":
        return null;
      case "completed":
        return { status: "completed", error: null };
      case "error":
        return { status: "failed", error: thread.session?.lastError ?? "Turn failed" };
      case "interrupted":
        return { status: "interrupted", error: null };
    }
  }
  if (thread.session?.status === "error") {
    return {
      status: "failed",
      error: thread.session.lastError ?? "Provider session failed before the turn started",
    };
  }
  return null;
}
