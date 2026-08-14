import { describe, expect, it } from "vite-plus/test";

import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  buildPendingUserInputAnswers,
  buildThreadFeed,
  createThreadFeedBuilder,
  deriveThreadFeedPresentation,
  isPendingUserInputOptionSelected,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type ThreadFeedActivity,
  type ThreadFeedEntry,
} from "./threadActivity";

const singleSelectQuestion = {
  id: "runtime",
  header: "Runtime",
  question: "Which runtime should be used?",
  options: [
    { label: "Go", description: "One binary" },
    { label: "Node.js", description: "Reuse TypeScript" },
  ],
  multiSelect: false,
} as const;

const multiSelectQuestion = {
  id: "scope",
  header: "Scope",
  question: "Which data should be collected?",
  options: [
    { label: "Orders", description: "Receipts" },
    { label: "Listings", description: "Inventory" },
  ],
  multiSelect: true,
} as const;

describe("pending user input answers", () => {
  it("replaces single-select options and toggles multi-select options", () => {
    expect(
      togglePendingUserInputOptionSelection(
        singleSelectQuestion,
        { selectedOptionLabels: ["Go"] },
        "Node.js",
      ),
    ).toEqual({ customAnswer: "", selectedOptionLabels: ["Node.js"] });

    const orders = togglePendingUserInputOptionSelection(multiSelectQuestion, undefined, "Orders");
    const ordersAndListings = togglePendingUserInputOptionSelection(
      multiSelectQuestion,
      orders,
      "Listings",
    );
    expect(ordersAndListings).toEqual({
      customAnswer: "",
      selectedOptionLabels: ["Orders", "Listings"],
    });
    expect(
      togglePendingUserInputOptionSelection(multiSelectQuestion, ordersAndListings, "Orders"),
    ).toEqual({ customAnswer: "", selectedOptionLabels: ["Listings"] });

    const paddedOrders = togglePendingUserInputOptionSelection(
      multiSelectQuestion,
      undefined,
      "  Orders  ",
    );
    expect(paddedOrders).toEqual({ customAnswer: "", selectedOptionLabels: ["Orders"] });
    expect(
      togglePendingUserInputOptionSelection(multiSelectQuestion, paddedOrders, "  Orders  "),
    ).toEqual({ customAnswer: "" });
  });

  it("builds array answers for multi-select questions", () => {
    expect(
      buildPendingUserInputAnswers([singleSelectQuestion, multiSelectQuestion], {
        runtime: { selectedOptionLabels: ["Go"] },
        scope: { selectedOptionLabels: ["Orders", "Listings"] },
      }),
    ).toEqual({
      runtime: "Go",
      scope: ["Orders", "Listings"],
    });
  });

  it("clears selected options while a custom answer is active", () => {
    expect(
      setPendingUserInputCustomAnswer(
        { selectedOptionLabels: ["Orders", "Listings"] },
        "Orders first",
      ),
    ).toEqual({ customAnswer: "Orders first" });
  });

  it("matches selected chips against normalized option labels", () => {
    expect(
      isPendingUserInputOptionSelected({ selectedOptionLabels: ["Orders"] }, "  Orders  "),
    ).toBe(true);
    expect(
      isPendingUserInputOptionSelected(
        { selectedOptionLabels: ["Orders"], customAnswer: "Orders first" },
        "  Orders  ",
      ),
    ).toBe(false);
  });
});

function makeActivity(
  input: Partial<OrchestrationThreadActivity> &
    Pick<OrchestrationThreadActivity, "id" | "kind" | "summary" | "createdAt">,
): OrchestrationThreadActivity {
  return {
    tone: "info",
    payload: {},
    turnId: null,
    ...input,
  };
}

function makeThread(
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "projectId" | "title">,
): OrchestrationThread {
  return {
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    enabledSkillIds: [],
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...input,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledAt ?? null,
  };
}

type ThreadMessage = OrchestrationThread["messages"][number];

function makeMessage(
  input: Pick<ThreadMessage, "id" | "createdAt" | "text"> & Partial<ThreadMessage>,
): ThreadMessage {
  return {
    role: "assistant",
    turnId: null,
    streaming: false,
    updatedAt: input.createdAt,
    ...input,
  };
}

describe("buildThreadFeed", () => {
  it("reuses derived work entries across streaming message updates", () => {
    const activity = makeActivity({
      id: EventId.make("activity-cached"),
      kind: "runtime.warning",
      summary: "Runtime warning",
      createdAt: "2026-04-01T00:00:01.000Z",
      payload: { message: "Keep this work row" },
    });
    const thread = makeThread({
      id: ThreadId.make("thread-cached-feed"),
      projectId: ProjectId.make("project-1"),
      title: "Cached feed",
      activities: [activity],
      messages: [
        {
          id: MessageId.make("assistant-stream"),
          role: "assistant",
          text: "One",
          turnId: null,
          streaming: true,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
      ],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    const secondFeed = builder({
      ...thread,
      messages: [{ ...thread.messages[0]!, text: "One two" }],
    });
    const firstGroup = firstFeed.find((entry) => entry.type === "activity-group");
    const secondGroup = secondFeed.find((entry) => entry.type === "activity-group");

    expect(firstGroup?.type).toBe("activity-group");
    expect(secondGroup?.type).toBe("activity-group");
    if (firstGroup?.type !== "activity-group" || secondGroup?.type !== "activity-group") {
      return;
    }
    expect(secondGroup).toBe(firstGroup);
    expect(secondFeed.find((entry) => entry.type === "message")?.message.text).toBe("One two");
  });

  it("replaces only identity-changed message rows during streaming", () => {
    const firstMessage = makeMessage({
      id: MessageId.make("assistant-first"),
      text: "First",
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    const middleMessage = makeMessage({
      id: MessageId.make("assistant-middle"),
      text: "Middle",
      createdAt: "2026-04-01T00:00:02.000Z",
    });
    const streamingMessage = makeMessage({
      id: MessageId.make("assistant-streaming"),
      text: "One",
      streaming: true,
      createdAt: "2026-04-01T00:00:03.000Z",
    });
    const thread = makeThread({
      id: ThreadId.make("thread-incremental-message-feed"),
      projectId: ProjectId.make("project-1"),
      title: "Incremental messages",
      messages: [firstMessage, middleMessage, streamingMessage],
      activities: [
        makeActivity({
          id: EventId.make("activity-between-messages"),
          kind: "runtime.warning",
          summary: "Between",
          createdAt: "2026-04-01T00:00:01.000Z",
        }),
      ],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    const nextStreamingMessage = { ...streamingMessage, text: "One two" };
    const secondFeed = builder({
      ...thread,
      messages: [firstMessage, middleMessage, nextStreamingMessage],
    });
    const firstEntriesById = new Map(firstFeed.map((entry) => [entry.id, entry]));
    const secondEntriesById = new Map(secondFeed.map((entry) => [entry.id, entry]));

    expect(secondFeed).not.toBe(firstFeed);
    expect(secondEntriesById.get(firstMessage.id)).toBe(firstEntriesById.get(firstMessage.id));
    expect(secondEntriesById.get(middleMessage.id)).toBe(firstEntriesById.get(middleMessage.id));
    expect(secondEntriesById.get("activity-between-messages")).toBe(
      firstEntriesById.get("activity-between-messages"),
    );
    expect(secondEntriesById.get(streamingMessage.id)).not.toBe(
      firstEntriesById.get(streamingMessage.id),
    );
    expect(secondEntriesById.get(streamingMessage.id)).toMatchObject({
      type: "message",
      message: { text: "One two" },
    });
  });

  it("incrementally updates an older replayed message without changing sorted semantics", () => {
    const lateMessage = makeMessage({
      id: MessageId.make("assistant-late"),
      text: "Late",
      createdAt: "2026-04-01T00:00:03.000Z",
    });
    const earlyMessage = makeMessage({
      id: MessageId.make("assistant-early"),
      text: "Early",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const middleMessage = makeMessage({
      id: MessageId.make("assistant-middle"),
      text: "Middle",
      createdAt: "2026-04-01T00:00:02.000Z",
    });
    const thread = makeThread({
      id: ThreadId.make("thread-out-of-order-replay"),
      projectId: ProjectId.make("project-1"),
      title: "Out-of-order replay",
      messages: [lateMessage, earlyMessage, middleMessage],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    const replayedEarlyMessage = { ...earlyMessage, text: "Early replayed" };
    const replayedThread = {
      ...thread,
      messages: [lateMessage, replayedEarlyMessage, middleMessage],
    };
    const nextFeed = builder(replayedThread);
    const statelessFeed = buildThreadFeed(replayedThread);

    expect(nextFeed).toEqual(statelessFeed);
    expect(nextFeed.map((entry) => entry.id)).toEqual([
      earlyMessage.id,
      middleMessage.id,
      lateMessage.id,
    ]);
    expect(nextFeed.find((entry) => entry.id === lateMessage.id)).toBe(
      firstFeed.find((entry) => entry.id === lateMessage.id),
    );
    expect(nextFeed.find((entry) => entry.id === middleMessage.id)).toBe(
      firstFeed.find((entry) => entry.id === middleMessage.id),
    );
  });

  it("falls back to stable sorting when equal-timestamp messages reorder", () => {
    const firstMessage = makeMessage({
      id: MessageId.make("assistant-tied-first"),
      text: "First",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const secondMessage = makeMessage({
      id: MessageId.make("assistant-tied-second"),
      text: "Second",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const thread = makeThread({
      id: ThreadId.make("thread-tied-reorder"),
      projectId: ProjectId.make("project-1"),
      title: "Tied reorder",
      messages: [firstMessage, secondMessage],
    });
    const builder = createThreadFeedBuilder();
    builder(thread);

    const reorderedThread = { ...thread, messages: [secondMessage, firstMessage] };
    const reorderedFeed = builder(reorderedThread);
    expect(reorderedFeed).toEqual(buildThreadFeed(reorderedThread));
    expect(reorderedFeed.map((entry) => entry.id)).toEqual([secondMessage.id, firstMessage.id]);
  });

  it("keeps loaded-message windows equivalent as their boundary changes", () => {
    const oldestMessage = makeMessage({
      id: MessageId.make("assistant-oldest"),
      text: "Oldest",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const middleMessage = makeMessage({
      id: MessageId.make("assistant-window-middle"),
      text: "Middle",
      createdAt: "2026-04-01T00:00:03.000Z",
    });
    const newestMessage = makeMessage({
      id: MessageId.make("assistant-window-newest"),
      text: "Newest",
      streaming: true,
      createdAt: "2026-04-01T00:00:05.000Z",
    });
    const thread = makeThread({
      id: ThreadId.make("thread-loaded-window"),
      projectId: ProjectId.make("project-1"),
      title: "Loaded window",
      messages: [oldestMessage, middleMessage, newestMessage],
      activities: [
        makeActivity({
          id: EventId.make("activity-before-window"),
          kind: "runtime.warning",
          summary: "Before window",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
        makeActivity({
          id: EventId.make("activity-inside-window"),
          kind: "runtime.warning",
          summary: "Inside window",
          createdAt: "2026-04-01T00:00:04.000Z",
        }),
      ],
    });
    const builder = createThreadFeedBuilder();
    const initialLoadedMessages = [middleMessage, newestMessage];
    builder(thread, { loadedMessages: initialLoadedMessages });

    const nextNewestMessage = { ...newestMessage, text: "Newest delta" };
    const nextThread = {
      ...thread,
      messages: [oldestMessage, middleMessage, nextNewestMessage],
    };
    const nextLoadedMessages = [middleMessage, nextNewestMessage];
    expect(JSON.stringify(builder(nextThread, { loadedMessages: nextLoadedMessages }))).toBe(
      JSON.stringify(buildThreadFeed(nextThread, { loadedMessages: nextLoadedMessages })),
    );

    const expandedLoadedMessages = [oldestMessage, middleMessage, nextNewestMessage];
    expect(JSON.stringify(builder(nextThread, { loadedMessages: expandedLoadedMessages }))).toBe(
      JSON.stringify(buildThreadFeed(nextThread, { loadedMessages: expandedLoadedMessages })),
    );
  });

  it("rebuilds activity groups when a streaming message becomes visible", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-visible-stream"),
      projectId: ProjectId.make("project-1"),
      title: "Visible stream",
      activities: [
        makeActivity({
          id: EventId.make("activity-before-stream"),
          kind: "runtime.warning",
          summary: "Before",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: TurnId.make("turn-1"),
          payload: { message: "Before" },
        }),
        makeActivity({
          id: EventId.make("activity-after-stream"),
          kind: "runtime.warning",
          summary: "After",
          createdAt: "2026-04-01T00:00:03.000Z",
          turnId: TurnId.make("turn-1"),
          payload: { message: "After" },
        }),
      ],
      messages: [
        {
          id: MessageId.make("assistant-stream"),
          role: "assistant",
          text: "",
          turnId: TurnId.make("turn-1"),
          streaming: true,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
      ],
    });
    const builder = createThreadFeedBuilder();
    expect(builder(thread).map((entry) => entry.type)).toEqual(["activity-group"]);

    const visibleFeed = builder({
      ...thread,
      messages: [{ ...thread.messages[0]!, text: "Now visible" }],
    });

    expect(visibleFeed.map((entry) => entry.type)).toEqual([
      "activity-group",
      "message",
      "activity-group",
    ]);
  });

  it("keeps historic work entries attributed to their turns", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Runtime warning thread",
      latestTurn: {
        turnId: TurnId.make("turn-latest"),
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("activity-old"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-old"),
          payload: {
            message: "Old warning",
          },
        }),
        makeActivity({
          id: EventId.make("activity-latest"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:03.000Z",
          turnId: TurnId.make("turn-latest"),
          payload: {
            message: "Latest warning",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed).toMatchObject([
      {
        type: "activity-group",
        turnId: "turn-old",
        activities: [{ id: "activity-old", turnId: "turn-old" }],
      },
      {
        type: "activity-group",
        turnId: "turn-latest",
        activities: [{ id: "activity-latest", turnId: "turn-latest" }],
      },
    ]);
  });

  it("collapses matching tool lifecycle rows like desktop", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-2"),
      projectId: ProjectId.make("project-1"),
      title: "Collapsed tools",
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-updated"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Run tests",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run tests completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const group = feed[0];

    expect(group).toMatchObject({
      type: "activity-group",
    });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities).toHaveLength(1);
    expect(group.activities[0]).toMatchObject({
      id: "tool-completed",
      createdAt: "2026-04-01T00:00:02.000Z",
      turnId: "turn-1",
      summary: "Run tests",
      detail: "bun run test",
      canExpand: true,
      icon: "command",
      toolLike: true,
      status: "success",
    });
    expect(group.activities[0]?.getFullDetail()).toBe("/bin/zsh -lc 'bun run test'");
    expect(group.activities[0]?.getCopyText()).toBe(
      "Run tests\nbun run test\n/bin/zsh -lc 'bun run test'",
    );
  });

  it("keeps MCP inputs available to expanded mobile work rows", () => {
    const turnId = TurnId.make("turn-mcp");
    const thread = makeThread({
      id: ThreadId.make("thread-mcp"),
      projectId: ProjectId.make("project-1"),
      title: "Expandable MCP call",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("mcp-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Call repository tool",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            title: "Call repository tool",
            itemType: "mcp_tool_call",
            detail: "repository.search",
            status: "completed",
            data: {
              item: {
                server: "repository",
                tool: "search",
                arguments: { query: "work log" },
              },
            },
          },
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]?.icon).toBe("wrench");
    expect(group.activities[0]?.getFullDetail()).toContain('"query": "work log"');
    expect(group.activities[0]?.getFullDetail()).toContain("repository.search");
  });

  it("defers large tool output expansion until a work row is opened or copied", () => {
    let serializedToolOutputs = 0;
    const activities = Array.from({ length: 5_000 }, (_, index) =>
      makeActivity({
        id: EventId.make(`large-tool-${index}`),
        kind: "tool.completed",
        tone: "tool",
        summary: `Tool ${index}`,
        createdAt: new Date(Date.UTC(2026, 3, 1, 0, 0, index)).toISOString(),
        payload: {
          title: `Tool ${index}`,
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            item: {
              toJSON: () => {
                serializedToolOutputs += 1;
                return { output: "x".repeat(32_768) };
              },
            },
          },
        },
      }),
    );
    const thread = makeThread({
      id: ThreadId.make("thread-large-tools"),
      projectId: ProjectId.make("project-1"),
      title: "Large tools",
      activities,
    });

    const feed = buildThreadFeed(thread);
    expect(serializedToolOutputs).toBe(0);

    const group = feed[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities).toHaveLength(5_000);
    expect(group.activities[0]?.getFullDetail()).toContain('"output"');
    expect(serializedToolOutputs).toBe(1);
    expect(group.activities[0]?.getCopyText()).toContain('"output"');
    expect(serializedToolOutputs).toBe(1);
  });

  it("folds settled turn work while leaving the terminal answer visible", () => {
    const turnId = TurnId.make("turn-1");
    const thread = makeThread({
      id: ThreadId.make("thread-3"),
      projectId: ProjectId.make("project-1"),
      title: "Folded work",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:18.000Z",
        assistantMessageId: MessageId.make("assistant-final"),
      },
      messages: [
        {
          id: MessageId.make("assistant-commentary"),
          role: "assistant",
          text: "I am checking.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:03.000Z",
        },
        {
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: "Done.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:18.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Read files",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Read files",
            itemType: "file_read",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(collapsed.map((entry) => entry.id)).toEqual(["turn-fold:turn-1", "assistant-final"]);
    expect(collapsed[0]).toMatchObject({
      type: "turn-fold",
      label: "Worked for 17s",
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set([turnId]));
    expect(expanded.map((entry) => entry.id)).toEqual([
      "turn-fold:turn-1",
      "assistant-commentary",
      "tool-completed",
      "assistant-final",
    ]);
  });

  it("measures a steer-superseded turn from its user boundary through trailing work", () => {
    const firstTurnId = TurnId.make("turn-1");
    const secondTurnId = TurnId.make("turn-2");
    const thread = makeThread({
      id: ThreadId.make("thread-steered"),
      projectId: ProjectId.make("project-1"),
      title: "Steered work",
      latestTurn: {
        turnId: secondTurnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:14.000Z",
        startedAt: "2026-04-01T00:00:14.000Z",
        completedAt: null,
        assistantMessageId: MessageId.make("assistant-next"),
      },
      messages: [
        {
          id: MessageId.make("user-1"),
          role: "user",
          text: "Do it once more.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        {
          id: MessageId.make("assistant-commentary"),
          role: "assistant",
          text: "Kicking off call 1.",
          turnId: firstTurnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:09.000Z",
          updatedAt: "2026-04-01T00:00:09.000Z",
        },
        {
          id: MessageId.make("user-2"),
          role: "user",
          text: "Actually do 15.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:14.000Z",
          updatedAt: "2026-04-01T00:00:14.000Z",
        },
        {
          id: MessageId.make("assistant-next"),
          role: "assistant",
          text: "One down - adjusting.",
          turnId: secondTurnId,
          streaming: true,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:17.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("work-1"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          createdAt: "2026-04-01T00:00:12.000Z",
          turnId: firstTurnId,
          payload: {
            title: "Ran command",
            itemType: "command_execution",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(collapsed.find((entry) => entry.type === "turn-fold")).toMatchObject({
      turnId: firstTurnId,
      label: "Worked for 12s",
    });
  });

  it("keeps an active turn expanded and classifies error-shaped tool output", () => {
    const turnId = TurnId.make("turn-running");
    const thread = makeThread({
      id: ThreadId.make("thread-4"),
      projectId: ProjectId.make("project-1"),
      title: "Running work",
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-failed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run command",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Run command",
            itemType: "command_execution",
            detail: "zsh: command not found: nope",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(deriveThreadFeedPresentation(feed, thread.latestTurn, new Set())).toEqual(feed);
    expect(feed[0]).toMatchObject({
      type: "activity-group",
      activities: [{ status: "failure" }],
    });
  });

  it("appends active work as a normal timeline row", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const presented = deriveThreadFeedPresentation([], null, new Set(), new Set(), startedAt);

    expect(presented).toEqual([
      {
        type: "working",
        id: "working-indicator-row",
        createdAt: startedAt,
      },
    ]);
    expect(deriveThreadFeedPresentation(presented, null, new Set())).toEqual([]);
  });

  it("models work-log overflow as list rows", () => {
    const activity = (
      id: string,
      createdAt: string,
      status: ThreadFeedActivity["status"] = "success",
    ): ThreadFeedActivity => ({
      id,
      createdAt,
      turnId: null,
      summary: `Tool ${id}`,
      detail: null,
      canExpand: false,
      getFullDetail: () => null,
      getCopyText: () => id,
      icon: "command",
      toolLike: true,
      status,
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-1",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("activity-1", "2026-04-01T00:00:01.000Z"),
          activity("activity-neutral", "2026-04-01T00:00:02.000Z", "neutral"),
          activity("activity-2", "2026-04-01T00:00:03.000Z"),
          activity("activity-3", "2026-04-01T00:00:04.000Z"),
        ],
      },
    ];

    const collapsed = deriveThreadFeedPresentation(feed, null, new Set());
    expect(collapsed.map((entry) => entry.id)).toEqual(["activity-3", "work-toggle:work-group-1"]);
    expect(collapsed[1]).toMatchObject({
      type: "work-toggle",
      groupId: "work-group-1",
      hiddenCount: 2,
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(feed, null, new Set(), new Set(["work-group-1"]));
    expect(expanded.map((entry) => entry.id)).toEqual([
      "activity-1",
      "activity-2",
      "activity-3",
      "work-toggle:work-group-1",
    ]);
    expect(expanded.at(-1)).toMatchObject({
      type: "work-toggle",
      expanded: true,
    });
  });
});

describe("quiet timeline: nested agents", () => {
  it("keeps a nested agent's terminal row but hides its background work", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-nested"),
      projectId: ProjectId.make("project-1"),
      title: "Nested agents",
      activities: [
        // A subagent's own shell: internal, covered by the owner's liveness.
        makeActivity({
          id: EventId.make("shell-done"),
          kind: "task.completed",
          summary: "Task completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          payload: { taskId: "sh-1", agentId: "owner", agentKind: "background" },
        }),
        // A nested AGENT's completion: mobile has no Agents sheet, so this
        // terminal row is the only signal it ever finished.
        makeActivity({
          id: EventId.make("nested-done"),
          kind: "task.completed",
          summary: "Task completed",
          createdAt: "2026-04-01T00:00:03.000Z",
          payload: { taskId: "n-1", agentId: "owner", agentKind: "agent" },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const ids = feed.flatMap((entry) =>
      entry.type === "activity-group" ? entry.activities.map((row) => row.id) : [],
    );
    expect(ids).toContain("nested-done");
    expect(ids).not.toContain("shell-done");
  });
});
