import { appAtomRegistry } from "./atom-registry";
import { rememberOutgoingMessageDraftAttachments } from "./outgoing-message-previews";
import { createThreadOutboxManager } from "./thread-outbox-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
});

/**
 * Lands queued outbox mutations before the JS runtime is torn down (app update
 * restart). An enqueued message is published to the atom immediately but its
 * durable write waits behind the mutation queue, so draining only the writes
 * already mid-file would miss it.
 */
export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.serialize(async () => {});
  await flushThreadOutboxWrites();
}

export function ensureThreadOutboxLoaded(): void {
  void threadOutboxManager.load();
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  // A startup read failure resets the manager's memoized load. Retry before a
  // new enqueue so persisted prompts cannot remain hidden for the whole active
  // session merely because the app has not backgrounded yet.
  ensureThreadOutboxLoaded();
  rememberOutgoingMessageDraftAttachments(message.messageId, message.attachments);
  return threadOutboxManager.enqueue(message);
}

/** Waits for pending writes to settle; false if the message was rolled back. */
export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.confirmQueued(message);
}

/**
 * Rewrite a queued message; no-op (false) if it was removed in the meantime,
 * or (with `expectedRevision` from `threadOutboxRevision`) if any other write
 * was accepted since the revision was read.
 */
export function updateThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
): Promise<boolean> {
  rememberOutgoingMessageDraftAttachments(message.messageId, message.attachments);
  return threadOutboxManager.update(message, expectedRevision);
}

/** Snapshot of a queued message's write revision, for update's CAS. */
export function threadOutboxRevision(messageId: QueuedThreadMessage["messageId"]): number {
  return threadOutboxManager.revisionOf(messageId);
}

// Removal lives in `thread-outbox-removal.ts`: taking a message out of the
// outbox must also release its local attachment files, and that owner needs
// the composer draft state this module must not depend on.
