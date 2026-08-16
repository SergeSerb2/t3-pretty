import type { OrchestrationThreadActivity } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export { activityProjectionGroupKey } from "@t3tools/shared/activityProjection";

/** A null value deliberately marks malformed context-window rows as retainable. */
export function activityContextUsedTokens(
  activity: Pick<OrchestrationThreadActivity, "kind" | "payload">,
): number | null {
  if (activity.kind !== "context-window.updated") {
    return null;
  }
  const usedTokens = asRecord(activity.payload)?.usedTokens;
  return typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0
    ? usedTokens
    : null;
}
