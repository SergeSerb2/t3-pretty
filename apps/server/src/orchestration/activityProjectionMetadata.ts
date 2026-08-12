import type { OrchestrationThreadActivity } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Stable identity shared by snapshot compaction and persistence metadata.
 * Persisting it keeps superseded tool payloads out of the snapshot read path:
 * SQLite can discard old updates before their potentially multi-megabyte JSON
 * bodies are copied into JavaScript and decoded.
 */
export function activityProjectionGroupKey(
  activity: Pick<OrchestrationThreadActivity, "payload" | "summary">,
): string | null {
  const payload = asRecord(activity.payload);
  if (!payload) {
    return null;
  }

  const toolCallId = asTrimmedString(asRecord(payload.data)?.toolCallId);
  if (toolCallId) {
    return `id:${toolCallId}`;
  }

  const itemType = asTrimmedString(payload.itemType) ?? "";
  const label = (asTrimmedString(payload.title) ?? activity.summary)
    .replace(/\s+(?:complete|completed)\s*$/iu, "")
    .trim();
  const detail = asTrimmedString(payload.detail) ?? "";
  if (itemType.length === 0 && label.length === 0 && detail.length === 0) {
    return null;
  }
  return [itemType, label, detail].join("\u001f");
}

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
