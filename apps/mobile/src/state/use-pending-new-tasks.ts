import { useMemo } from "react";

import { deriveThreadTitleFromPrompt } from "../lib/projectThreadStartTurn";
import { optimisticStartingThreadKey } from "../lib/optimisticThreadSend";
import { compareTimestamps } from "../lib/time";
import {
  flattenQueuedThreadMessages,
  type QueuedThreadCreation,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { useOptimisticStartingThreads } from "./optimistic-thread-send";
import { useThreadOutboxMessages } from "./use-thread-outbox";

/** A queued new-task creation, shaped for thread-list presentation. */
export interface PendingNewTask {
  readonly message: QueuedThreadMessage;
  readonly creation: QueuedThreadCreation;
  readonly title: string;
}

export function usePendingNewTasks(): ReadonlyArray<PendingNewTask> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const startingThreads = useOptimisticStartingThreads();
  return useMemo(() => {
    const startingThreadKeys = new Set(
      startingThreads.map((thread) => optimisticStartingThreadKey(thread)),
    );
    const tasks: PendingNewTask[] = [];
    for (const message of flattenQueuedThreadMessages(queuedMessagesByThreadKey)) {
      if (!message.creation) {
        continue;
      }
      if (startingThreadKeys.has(optimisticStartingThreadKey(message))) {
        continue;
      }
      tasks.push({
        message,
        creation: message.creation,
        title: deriveThreadTitleFromPrompt(message.text),
      });
    }
    tasks.sort((left, right) => compareTimestamps(right.message.createdAt, left.message.createdAt));
    return tasks;
  }, [queuedMessagesByThreadKey, startingThreads]);
}
