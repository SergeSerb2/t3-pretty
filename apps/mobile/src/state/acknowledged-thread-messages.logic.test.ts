import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { appendPendingThreadMessages } from "../features/threads/pending-thread-feed";
import { buildThreadFeed } from "../lib/threadActivity";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import {
  pruneTimelineAcknowledgments,
  visibleUserMessageIds,
} from "./acknowledged-thread-messages.logic";

const ref = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const pending: QueuedThreadMessage = {
  ...ref,
  messageId: MessageId.make("sent"),
  commandId: CommandId.make("send"),
  text: "Run checks",
  attachments: [],
  createdAt: "2026-10-03T00:00:00.000Z",
};
const now = DateTime.makeUnsafe(pending.createdAt);
const row: OrchestrationV2ProjectedTurnItem = {
  position: 0,
  visibility: "local",
  sourceThreadId: ref.threadId,
  sourceItemId: TurnItemId.make("user"),
  item: {
    id: TurnItemId.make("user"),
    threadId: ref.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "user_message",
    messageId: pending.messageId,
    text: pending.text,
    attachments: [],
    createdBy: "user",
    creationSource: "mobile",
    inputIntent: "turn_start",
  },
};

describe("acknowledged timeline messages", () => {
  it("keeps the sent prompt visible until the V2 timeline row arrives", () => {
    // message.updated can acknowledge persistence while the separate timeline
    // event has not arrived yet. No visible row means no rendered server echo.
    const acknowledgments = [pending];
    const before = pruneTimelineAcknowledgments(acknowledgments, ref, visibleUserMessageIds([]));
    expect(before).toBe(acknowledgments);
    expect(
      appendPendingThreadMessages([], [], before).find((entry) => entry.type === "message")?.message
        .text,
    ).toBe("Run checks");

    const delivered = buildThreadFeed([row]);
    const after = pruneTimelineAcknowledgments(before, ref, visibleUserMessageIds([row]));
    const feed = appendPendingThreadMessages(delivered, delivered, after);
    expect(feed).toHaveLength(1);
    expect(feed.find((entry) => entry.type === "message")?.message.text).toBe("Run checks");
    expect(feed[0]?.pendingMessage).toBeUndefined();
  });

  it("does not retire another environment or thread's prompt with the same id", () => {
    const anotherEnvironment = { ...pending, environmentId: EnvironmentId.make("other-env") };
    const anotherThread = { ...pending, threadId: ThreadId.make("other-thread") };
    expect(
      pruneTimelineAcknowledgments(
        [pending, anotherEnvironment, anotherThread],
        ref,
        visibleUserMessageIds([row]),
      ),
    ).toEqual([anotherEnvironment, anotherThread]);
  });
});
