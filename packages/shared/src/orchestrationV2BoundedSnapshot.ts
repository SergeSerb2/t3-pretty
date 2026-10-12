import type {
  OrchestrationV2ConversationMessage,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { isOrchestrationV2TurnItemVisible } from "./orchestrationV2Timeline.ts";

/** Local timeline rows also carry their item in `projection.turnItems`. */
function isLocalTimelineRow(
  projection: Pick<OrchestrationV2ThreadProjection, "thread">,
  row: OrchestrationV2ProjectedTurnItem,
): boolean {
  return row.visibility === "local" || row.sourceThreadId === projection.thread.id;
}

/**
 * Server half of the opt-in compact bounded snapshot. Bounded `turnItems` start
 * with the items of the window's local visible rows, so those entries can be
 * dropped and rebuilt by `restoreLocalVisibleTurnItems`. Returns null when the
 * projection does not have that exact shape, or when nothing would be omitted;
 * callers then send the unchanged projection without a marker.
 */
export function omitLocalVisibleTurnItems(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection | null {
  let omitted = 0;
  for (const row of projection.visibleTurnItems) {
    if (!isLocalTimelineRow(projection, row)) continue;
    // Same object, not merely the same id: restoring from the row must
    // reproduce the original entry exactly.
    if (projection.turnItems[omitted] !== row.item) return null;
    omitted += 1;
  }
  if (omitted === 0) return null;
  return { ...projection, turnItems: projection.turnItems.slice(omitted) };
}

/**
 * Client half: call on a decoded snapshot that carries the
 * `turnItemsOmitLocalVisible` marker, before reducers or caches see it.
 */
export function restoreLocalVisibleTurnItems(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection {
  const local = projection.visibleTurnItems
    .filter((row) => isLocalTimelineRow(projection, row))
    .map((row) => row.item);
  if (local.length === 0) return projection;
  return { ...projection, turnItems: [...local, ...projection.turnItems] };
}

function visibleRowFromItem(
  item: OrchestrationV2TurnItem,
  position: number,
): OrchestrationV2ProjectedTurnItem {
  return {
    position,
    visibility: "local",
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  };
}

function conversationMessageToTurnItem(
  message: OrchestrationV2ConversationMessage,
  ordinal: number,
): OrchestrationV2TurnItem | null {
  if (message.role === "system") return null;
  const base = {
    id: TurnItemId.make(String(message.id)),
    threadId: message.threadId,
    runId: message.runId,
    nodeId: message.nodeId,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: message.createdAt,
    completedAt: message.updatedAt,
    updatedAt: message.updatedAt,
  };
  if (message.role === "user") {
    return {
      ...base,
      createdBy: message.createdBy,
      creationSource: message.creationSource,
      type: "user_message",
      messageId: message.id,
      inputIntent: "turn_start",
      text: message.text,
      attachments: message.attachments,
      ...(message.scheduledTaskId === undefined
        ? {}
        : { scheduledTaskId: message.scheduledTaskId }),
      ...(message.senderThreadId === undefined ? {} : { senderThreadId: message.senderThreadId }),
    };
  }
  return {
    ...base,
    type: "assistant_message",
    messageId: message.id,
    text: message.text,
    attachments: message.attachments,
    streaming: message.streaming,
  };
}

function visibleRowsFromTurnItems(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection["visibleTurnItems"] {
  const rows: OrchestrationV2ProjectedTurnItem[] = [];
  for (const item of projection.turnItems) {
    if (item.threadId !== projection.thread.id && item.threadId !== null) continue;
    if (
      !isOrchestrationV2TurnItemVisible({
        item,
        runs: projection.runs ?? [],
        attempts: projection.attempts ?? [],
        items: projection.turnItems ?? [],
      })
    ) {
      continue;
    }
    rows.push(visibleRowFromItem(item, rows.length));
  }
  return rows;
}

function projectedEpochMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value !== null && typeof value === "object" && "epochMilliseconds" in value) {
    const millis = Reflect.get(value, "epochMilliseconds");
    if (typeof millis === "number" && Number.isFinite(millis)) return millis;
  }
  try {
    return DateTime.toEpochMillis(value as DateTime.Utc);
  } catch {
    return 0;
  }
}

function visibleRowsFromMessages(projection: OrchestrationV2ThreadProjection): {
  readonly rows: OrchestrationV2ThreadProjection["visibleTurnItems"];
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
} {
  const items: OrchestrationV2TurnItem[] = [];
  const rows: OrchestrationV2ProjectedTurnItem[] = [];
  const ordered = [...(projection.messages ?? [])].sort((left, right) => {
    const leftMs = projectedEpochMillis(left.createdAt);
    const rightMs = projectedEpochMillis(right.createdAt);
    return leftMs === rightMs ? String(left.id).localeCompare(String(right.id)) : leftMs - rightMs;
  });
  for (const message of ordered) {
    const item = conversationMessageToTurnItem(message, items.length);
    if (item === null) continue;
    items.push(item);
    rows.push(visibleRowFromItem(item, rows.length));
  }
  return { rows, items };
}

/**
 * Older servers (and compact payloads that lost their marker) can arrive with
 * conversation data in `turnItems` or `messages` but an empty visible window.
 * The thread view reads only `visibleTurnItems`, so rebuild that list before
 * reducers or the UI see the projection.
 */
export function ensureVisibleTurnItems(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection {
  if (projection.visibleTurnItems.length > 0) return projection;
  const fromTurnItems = visibleRowsFromTurnItems(projection);
  if (fromTurnItems.length > 0) {
    return { ...projection, visibleTurnItems: fromTurnItems };
  }
  const fromMessages = visibleRowsFromMessages(projection);
  if (fromMessages.rows.length === 0) return projection;
  return {
    ...projection,
    turnItems: [...fromMessages.items, ...projection.turnItems],
    visibleTurnItems: fromMessages.rows,
  };
}

/**
 * A later bounded/progressive socket snapshot must not blank a thread the
 * HTTP install already painted. A legacy full snapshot (`resetHistory`) still
 * replaces the window, including a genuine empty thread.
 */
export function retainVisibleTimeline(
  previous: OrchestrationV2ThreadProjection | null,
  incoming: OrchestrationV2ThreadProjection,
  options?: { readonly resetHistory?: boolean },
): OrchestrationV2ThreadProjection {
  const next = ensureVisibleTurnItems(incoming);
  if (next.visibleTurnItems.length > 0 || options?.resetHistory === true) return next;
  if (
    previous === null ||
    previous.thread.id !== next.thread.id ||
    previous.visibleTurnItems.length === 0
  ) {
    return next;
  }
  return {
    ...next,
    visibleTurnItems: previous.visibleTurnItems,
    turnItems: previous.turnItems.length > 0 ? previous.turnItems : next.turnItems,
  };
}

/** The usable projection of a decoded bounded snapshot, compact or not. */
export function boundedSnapshotProjection(snapshot: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly turnItemsOmitLocalVisible?: true | undefined;
}): OrchestrationV2ThreadProjection {
  const restored =
    snapshot.turnItemsOmitLocalVisible === true
      ? restoreLocalVisibleTurnItems(snapshot.projection)
      : snapshot.projection;
  return ensureVisibleTurnItems(restored);
}
