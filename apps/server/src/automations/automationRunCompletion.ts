/**
 * The one rule that decides whether an automation run's thread has settled.
 * Shared by the event-driven tracker and the 30 s tick sweep so a completion
 * the tracker missed (server restart mid-turn) is picked up identically.
 */
import type { AutomationRunFinishedStatus } from "@t3tools/contracts";

export interface AutomationRunCompletion {
  readonly status: AutomationRunFinishedStatus;
  readonly error: string | null;
}

/**
 * Null while the run is still going. A settled latest turn maps to its
 * outcome; a session that errored before any turn started is a failure.
 */
export function resolveAutomationRunCompletion(
  thread: Pick<
    import("@t3tools/contracts").OrchestrationV2ThreadShell,
    "status" | "lastError" | "latestRunId" | "activeRunId"
  >,
): AutomationRunCompletion | null {
  if (thread.activeRunId !== null || thread.latestRunId === null) return null;
  switch (thread.status) {
    case "completed":
      return { status: "completed", error: null };
    case "failed":
      return { status: "failed", error: thread.lastError ?? "Run failed" };
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return { status: "interrupted", error: null };
    default:
      return null;
  }
}
