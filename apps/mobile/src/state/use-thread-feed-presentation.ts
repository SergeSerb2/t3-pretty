import type { MessageId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import {
  appendPendingThreadMessages,
  type PendingThreadFeedEntry,
} from "../features/threads/pending-thread-feed";
import { scopedThreadKey } from "../lib/scopedEntities";
import { buildThreadFeed } from "../lib/threadActivity";
import { pendingThreadCreationMessage } from "./pending-thread-creation";
import type { QueuedThreadMessage } from "./thread-outbox-model";

type FeedOptions = NonNullable<Parameters<typeof buildThreadFeed>[1]>;
const EMPTY_FEED: ReadonlyArray<PendingThreadFeedEntry> = [];

export function useThreadFeedPresentation(input: {
  readonly visible: boolean;
  readonly threadKey: string | null;
  readonly visibleTurnItems: Parameters<typeof buildThreadFeed>[0];
  readonly echoedMessageIds: ReadonlySet<MessageId>;
  readonly attempts: FeedOptions["attempts"];
  readonly nodes: FeedOptions["nodes"];
  readonly pendingCreationMessage: QueuedThreadMessage | null;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
  readonly acknowledgedMessages: ReadonlyArray<QueuedThreadMessage>;
}): ReadonlyArray<PendingThreadFeedEntry> {
  const feed = useMemo(() => {
    if (!input.visible) return null;
    const pendingCreation =
      input.pendingCreationMessage !== null &&
      !input.echoedMessageIds.has(input.pendingCreationMessage.messageId)
        ? [pendingThreadCreationMessage(input.pendingCreationMessage)]
        : [];
    const nextFeed = buildThreadFeed(input.visibleTurnItems, {
      anchoredMessages: pendingCreation,
      attempts: input.attempts,
      nodes: input.nodes,
    });
    const pendingAcknowledgments = input.acknowledgedMessages.filter(
      (message) =>
        scopedThreadKey(message.environmentId, message.threadId) === input.threadKey &&
        !input.queuedMessages.some((queued) => queued.messageId === message.messageId),
    );
    if (pendingAcknowledgments.length === 0) return nextFeed;
    return appendPendingThreadMessages(nextFeed, nextFeed, pendingAcknowledgments).map((entry) =>
      entry.pendingMessage ? { ...entry, acknowledged: true } : entry,
    );
  }, [
    input.visible,
    input.threadKey,
    input.visibleTurnItems,
    input.echoedMessageIds,
    input.attempts,
    input.nodes,
    input.pendingCreationMessage,
    input.queuedMessages,
    input.acknowledgedMessages,
  ]);
  const [presentation, setPresentation] = useState<{
    readonly threadKey: string | null;
    readonly feed: ReadonlyArray<PendingThreadFeedEntry>;
  }>(() => ({ threadKey: input.threadKey, feed: feed ?? EMPTY_FEED }));
  // Retain only committed presentation. React discards this state adjustment
  // if a render is abandoned, and hidden updates keep the mounted screen intact.
  // Live projection, outbox, and acknowledgment processing stay with its owner.
  if (presentation.threadKey !== input.threadKey || (feed !== null && presentation.feed !== feed)) {
    const next = { threadKey: input.threadKey, feed: feed ?? EMPTY_FEED };
    setPresentation(next);
    return next.feed;
  }
  return presentation.feed;
}
