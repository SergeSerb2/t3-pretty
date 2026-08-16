/**
 * Tool-call identity shared by the server's snapshot compaction, its
 * persistence metadata (`projection_group_key`), and the client reducer's
 * live compaction of `tool.updated` rows: an explicit `data.toolCallId` when
 * the adapter emits one, otherwise the itemType/title/detail triple. Returns
 * null for rows with no identity at all — those never collapse anywhere.
 */
export function activityProjectionGroupKey(activity: {
  readonly payload: unknown;
  readonly summary: string;
}): string | null {
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
