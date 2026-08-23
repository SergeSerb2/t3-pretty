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

  it("pretty-breaks chained bash in the expanded work row", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-pretty-bash"),
      projectId: ProjectId.make("project-1"),
      title: "Pretty bash",
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
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Ran command",
            itemType: "command_execution",
            detail: `echo "===== ISSUE 198 =====" && gh issue view 198 --repo SergeSerb2/t3-pretty`,
          },
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]?.getFullDetail()).toBe(
      `echo "===== ISSUE 198 =====" &&\n  gh issue view 198 --repo SergeSerb2/t3-pretty`,
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

  it("renders skill-loaded activities as package tool rows", () => {
    const turnId = TurnId.make("turn-skill");
    const thread = makeThread({
      id: ThreadId.make("thread-skill-loaded"),
      projectId: ProjectId.make("project-1"),
      title: "Skill loaded",
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
          id: EventId.make("skill-loaded"),
          kind: "skill.loaded",
          tone: "tool",
          summary: "Skill",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            title: "Skill",
            itemType: "skill_load",
            detail: "grill-me",
            status: "completed",
            skillName: "grill-me",
          },
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]?.icon).toBe("package");
    expect(group.activities[0]?.summary).toBe("Skill");
    expect(group.activities[0]?.detail).toBe("grill-me");
    expect(group.activities[0]?.status).toBe("success");
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

  it("suppresses the working row while assistant commentary signals activity", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const feed: ThreadFeedEntry[] = [
      {
        type: "message",
        id: "assistant-1",
        createdAt: "2026-04-01T00:00:02.000Z",
        message: makeMessage({
          id: MessageId.make("assistant-1"),
          text: "Looking into it",
          createdAt: "2026-04-01T00:00:02.000Z",
          streaming: true,
        }),
      },
    ];

    const presented = deriveThreadFeedPresentation(feed, null, new Set(), new Set(), startedAt);
    expect(presented.map((entry) => entry.type)).toEqual(["message"]);
  });

  it("keeps the working row while a tool call is in progress (the live tool is hidden here)", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-live",
        createdAt: "2026-04-01T00:00:02.000Z",
        turnId: null,
        activities: [
          {
            id: "activity-live",
            createdAt: "2026-04-01T00:00:02.000Z",
            turnId: null,
            summary: "Run command",
            detail: null,
            canExpand: false,
            getFullDetail: () => null,
            getCopyText: () => "Run command",
            icon: "command",
            toolLike: true,
            status: "neutral",
          },
        ],
      },
    ];

    const presented = deriveThreadFeedPresentation(feed, null, new Set(), new Set(), startedAt);
    expect(presented.some((entry) => entry.type === "working")).toBe(true);
  });

  it("keeps the working row when streaming text sits above a later tool group", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const feed: ThreadFeedEntry[] = [
      {
        type: "message",
        id: "assistant-1",
        createdAt: "2026-04-01T00:00:02.000Z",
        message: makeMessage({
          id: MessageId.make("assistant-1"),
          text: "I'll check that",
          createdAt: "2026-04-01T00:00:02.000Z",
          streaming: true,
        }),
      },
      {
        type: "activity-group",
        id: "work-group-after-text",
        createdAt: "2026-04-01T00:00:03.000Z",
        turnId: null,
        activities: [
          {
            id: "activity-live",
            createdAt: "2026-04-01T00:00:03.000Z",
            turnId: null,
            summary: "Run command",
            detail: null,
            canExpand: false,
            getFullDetail: () => null,
            getCopyText: () => "Run command",
            icon: "command",
            toolLike: true,
            status: "success",
          },
        ],
      },
    ];

    const presented = deriveThreadFeedPresentation(feed, null, new Set(), new Set(), startedAt);
    expect(presented.map((entry) => entry.type)).toEqual(["message", "activity-group", "working"]);
  });

  it("shows the working row again after a fresh user message", () => {
    const startedAt = "2026-04-01T00:00:05.000Z";
    const feed: ThreadFeedEntry[] = [
      {
        type: "message",
        id: "assistant-1",
        createdAt: "2026-04-01T00:00:02.000Z",
        message: makeMessage({
          id: MessageId.make("assistant-1"),
          text: "Done with the last request",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
      },
      {
        type: "message",
        id: "user-2",
        createdAt: "2026-04-01T00:00:04.000Z",
        message: makeMessage({
          id: MessageId.make("user-2"),
          role: "user",
          text: "Next task",
          createdAt: "2026-04-01T00:00:04.000Z",
        }),
      },
    ];

    const presented = deriveThreadFeedPresentation(feed, null, new Set(), new Set(), startedAt);
    expect(presented.at(-1)).toMatchObject({ type: "working" });
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

  it("keeps image generation rows visible without a zero-count toggle", () => {
    const activity = (
      id: string,
      createdAt: string,
      itemType?: ThreadFeedActivity["itemType"],
    ): ThreadFeedActivity => ({
      id,
      createdAt,
      turnId: null,
      summary: itemType === "image_generation" ? `Image ${id}` : `Tool ${id}`,
      detail: null,
      canExpand: false,
      getFullDetail: () => null,
      getCopyText: () => id,
      icon: itemType === "image_generation" ? "image" : "command",
      toolLike: true,
      status: "success",
      ...(itemType ? { itemType } : {}),
    });

    const imagesOnly = deriveThreadFeedPresentation(
      [
        {
          type: "activity-group",
          id: "work-group-images",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: null,
          activities: [
            activity("image-1", "2026-04-01T00:00:01.000Z", "image_generation"),
            activity("image-2", "2026-04-01T00:00:02.000Z", "image_generation"),
          ],
        },
      ],
      null,
      new Set(),
    );
    expect(imagesOnly.map((entry) => entry.id)).toEqual(["image-1", "image-2"]);

    const imagesAndTail = deriveThreadFeedPresentation(
      [
        {
          type: "activity-group",
          id: "work-group-images-tail",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: null,
          activities: [
            activity("image-1", "2026-04-01T00:00:01.000Z", "image_generation"),
            activity("tool-1", "2026-04-01T00:00:02.000Z"),
          ],
        },
      ],
      null,
      new Set(),
    );
    expect(imagesAndTail.map((entry) => entry.id)).toEqual(["image-1", "tool-1"]);

    const mixed = deriveThreadFeedPresentation(
      [
        {
          type: "activity-group",
          id: "work-group-mixed",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: null,
          activities: [
            activity("tool-1", "2026-04-01T00:00:01.000Z"),
            activity("image-1", "2026-04-01T00:00:02.000Z", "image_generation"),
            activity("tool-2", "2026-04-01T00:00:03.000Z"),
            activity("tool-3", "2026-04-01T00:00:04.000Z"),
          ],
        },
      ],
      null,
      new Set(),
    );
    expect(mixed.map((entry) => entry.id)).toEqual([
      "image-1",
      "tool-3",
      "work-toggle:work-group-mixed",
    ]);
    expect(mixed.at(-1)).toMatchObject({
      type: "work-toggle",
      hiddenCount: 2,
      expanded: false,
    });
  });

  it("keeps the feed identical when only dropped activity kinds stream in", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-dropped-append"),
      projectId: ProjectId.make("project-1"),
      title: "Dropped append",
      activities: [
        makeActivity({
          id: EventId.make("activity-visible"),
          kind: "runtime.warning",
          summary: "Visible",
          createdAt: "2026-04-01T00:00:01.000Z",
        }),
      ],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    const secondFeed = builder({
      ...thread,
      activities: [
        ...thread.activities,
        makeActivity({
          id: EventId.make("activity-progress"),
          kind: "tool.progress",
          summary: "Partial output",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
      ],
    });

    expect(secondFeed).toBe(firstFeed);
  });

  it("keeps the feed identical when a context-window row is superseded", () => {
    const warning = makeActivity({
      id: EventId.make("activity-warning-cw"),
      kind: "runtime.warning",
      summary: "Visible",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const contextWindow = (id: string, createdAt: string, usedTokens: number) =>
      makeActivity({
        id: EventId.make(id),
        kind: "context-window.updated",
        summary: "Context window updated",
        createdAt,
        turnId: TurnId.make("turn-1"),
        payload: { usedTokens },
      });
    const thread = makeThread({
      id: ThreadId.make("thread-cw-supersede"),
      projectId: ProjectId.make("project-1"),
      title: "Context window supersede",
      activities: [warning, contextWindow("activity-cw-1", "2026-04-01T00:00:02.000Z", 1_000)],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    // The reducer's supersede swaps the middle row out in place.
    const secondFeed = builder({
      ...thread,
      activities: [warning, contextWindow("activity-cw-2", "2026-04-01T00:00:03.000Z", 2_000)],
    });

    expect(secondFeed).toBe(firstFeed);
  });

  it("extends the work log incrementally for in-order activity appends", () => {
    const firstActivity = makeActivity({
      id: EventId.make("activity-incremental-first"),
      kind: "runtime.warning",
      summary: "First",
      createdAt: "2026-04-01T00:00:01.000Z",
    });
    const thread = makeThread({
      id: ThreadId.make("thread-incremental-append"),
      projectId: ProjectId.make("project-1"),
      title: "Incremental append",
      activities: [firstActivity],
    });
    const builder = createThreadFeedBuilder();
    const firstFeed = builder(thread);
    const nextThread = {
      ...thread,
      activities: [
        ...thread.activities,
        makeActivity({
          id: EventId.make("activity-incremental-second"),
          kind: "runtime.warning",
          summary: "Second",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
      ],
    };
    const secondFeed = builder(nextThread);

    // toEqual trips on the lazy detail closures; compare the serializable feed.
    expect(JSON.stringify(secondFeed)).toBe(JSON.stringify(buildThreadFeed(nextThread)));
    const workRowsById = (feed: ThreadFeedEntry[]) =>
      new Map(
        feed
          .flatMap((entry) => (entry.type === "activity-group" ? entry.activities : []))
          .map((activity) => [activity.id, activity]),
      );
    const firstRows = workRowsById(firstFeed);
    const secondRows = workRowsById(secondFeed);
    expect([...secondRows.keys()]).toEqual([
      "activity-incremental-first",
      "activity-incremental-second",
    ]);
    // Untouched rows keep their derived object identity across the append.
    expect(secondRows.get("activity-incremental-first")).toBe(
      firstRows.get("activity-incremental-first"),
    );
  });

  it("collapses a tool completion into its in-progress row across builder calls", () => {
    const payload = {
      title: "Run tests",
      itemType: "command_execution",
      detail: "bun run test",
    };
    const thread = makeThread({
      id: ThreadId.make("thread-incremental-collapse"),
      projectId: ProjectId.make("project-1"),
      title: "Incremental collapse",
      activities: [
        makeActivity({
          id: EventId.make("tool-updated-incremental"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Run tests",
          createdAt: "2026-04-01T00:00:01.000Z",
          payload,
        }),
      ],
    });
    const builder = createThreadFeedBuilder();
    builder(thread);
    const nextThread = {
      ...thread,
      activities: [
        ...thread.activities,
        makeActivity({
          id: EventId.make("tool-completed-incremental"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run tests completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          payload,
        }),
      ],
    };
    const secondFeed = builder(nextThread);

    expect(JSON.stringify(secondFeed)).toBe(JSON.stringify(buildThreadFeed(nextThread)));
    const group = secondFeed[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }
    expect(group.activities).toHaveLength(1);
    expect(group.activities[0]?.id).toBe("tool-completed-incremental");
  });

  it("falls back to a full rebuild when an activity arrives out of order", () => {
    // The array tail (warning) sorts before the fold's last kept row
    // (tool-updated); an append that only clears the array tail must not
    // extend the fold — the completion collapses differently in sort order.
    const payload = {
      title: "Run tests",
      itemType: "command_execution",
      detail: "bun run test",
    };
    const thread = makeThread({
      id: ThreadId.make("thread-out-of-order-activity"),
      projectId: ProjectId.make("project-1"),
      title: "Out-of-order activity",
      activities: [
        makeActivity({
          id: EventId.make("tool-updated-ooo"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Run tests",
          createdAt: "2026-04-01T00:00:03.000Z",
          payload,
        }),
        makeActivity({
          id: EventId.make("warning-ooo"),
          kind: "runtime.warning",
          summary: "Early warning",
          createdAt: "2026-04-01T00:00:01.000Z",
        }),
      ],
    });
    const builder = createThreadFeedBuilder();
    builder(thread);
    const nextThread = {
      ...thread,
      activities: [
        ...thread.activities,
        makeActivity({
          id: EventId.make("tool-completed-ooo"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run tests completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          payload,
        }),
      ],
    };
    const feed = builder(nextThread);

    expect(JSON.stringify(feed)).toBe(JSON.stringify(buildThreadFeed(nextThread)));
    const group = feed[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }
    expect(group.activities.map((activity) => activity.id)).toEqual([
      "warning-ooo",
      "tool-completed-ooo",
      "tool-updated-ooo",
    ]);
  });

  it("preserves presented row identity across derivations with unchanged inputs", () => {
    const activity = (id: string, createdAt: string): ThreadFeedActivity => ({
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
      status: "success",
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-identity",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("activity-1", "2026-04-01T00:00:01.000Z"),
          activity("activity-2", "2026-04-01T00:00:02.000Z"),
          activity("activity-3", "2026-04-01T00:00:03.000Z"),
        ],
      },
    ];

    const first = deriveThreadFeedPresentation(feed, null, new Set());
    const second = deriveThreadFeedPresentation(feed, null, new Set());
    expect(second).toEqual(first);
    expect(second).toHaveLength(first.length);
    first.forEach((entry, index) => expect(second[index]).toBe(entry));

    // Expansion remints only the toggle; single-activity rows are shared.
    const expanded = deriveThreadFeedPresentation(
      feed,
      null,
      new Set(),
      new Set(["work-group-identity"]),
    );
    expect(expanded.map((entry) => entry.id)).toEqual([
      "activity-1",
      "activity-2",
      "activity-3",
      "work-toggle:work-group-identity",
    ]);
    expect(expanded[2]).toBe(first[0]);
    expect(expanded[3]).not.toBe(first[1]);
    const expandedAgain = deriveThreadFeedPresentation(
      feed,
      null,
      new Set(),
      new Set(["work-group-identity"]),
    );
    expanded.forEach((entry, index) => expect(expandedAgain[index]).toBe(entry));
  });

  it("preserves turn-fold and working row identity across derivations", () => {
    const turnId = TurnId.make("turn-fold-identity");
    const thread = makeThread({
      id: ThreadId.make("thread-fold-identity"),
      projectId: ProjectId.make("project-1"),
      title: "Fold identity",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:05.000Z",
        assistantMessageId: MessageId.make("assistant-fold-final"),
      },
      messages: [
        {
          id: MessageId.make("assistant-fold-note"),
          role: "assistant",
          text: "Checking.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
        {
          id: MessageId.make("assistant-fold-final"),
          role: "assistant",
          text: "Done.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:04.000Z",
          updatedAt: "2026-04-01T00:00:05.000Z",
        },
      ],
    });
    const feed = buildThreadFeed(thread);

    const first = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(first[0]?.type).toBe("turn-fold");
    const second = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(second).toEqual(first);
    first.forEach((entry, index) => expect(second[index]).toBe(entry));

    // Toggling the fold reuses the matching expanded/collapsed variant.
    const expanded = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set([turnId]));
    expect(expanded[0]).toMatchObject({ type: "turn-fold", expanded: true });
    expect(expanded[0]).not.toBe(first[0]);
    const collapsedAgain = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(collapsedAgain[0]).toBe(first[0]);

    const withWorking = deriveThreadFeedPresentation(
      feed,
      thread.latestTurn,
      new Set(),
      new Set(),
      "2026-04-01T00:00:20.000Z",
    );
    const withWorkingAgain = deriveThreadFeedPresentation(
      feed,
      thread.latestTurn,
      new Set(),
      new Set(),
      "2026-04-01T00:00:20.000Z",
    );
    expect(withWorkingAgain.at(-1)).toBe(withWorking.at(-1));
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
