import type {
  MessageId,
  OrchestrationV2ProjectedTurnItem,
  ScopedThreadRef,
} from "@t3tools/contracts";

import type { QueuedThreadMessage } from "./thread-outbox-model";

/** A persisted message is not rendered until its V2 timeline item arrives. */
export function visibleUserMessageIds(rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>) {
  return new Set<MessageId>(
    rows.flatMap(({ item }) => (item.type === "user_message" ? [item.messageId] : [])),
  );
}

export function pruneTimelineAcknowledgments(
  messages: ReadonlyArray<QueuedThreadMessage>,
  ref: ScopedThreadRef | null,
  visibleIds: ReadonlySet<MessageId>,
): ReadonlyArray<QueuedThreadMessage> {
  if (ref === null || visibleIds.size === 0) return messages;
  const retained = messages.filter(
    (message) =>
      message.environmentId !== ref.environmentId ||
      message.threadId !== ref.threadId ||
      !visibleIds.has(message.messageId),
  );
  return retained.length === messages.length ? messages : retained;
}
