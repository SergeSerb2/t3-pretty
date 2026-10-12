// @vitest-environment jsdom

import {
  EnvironmentId,
  MessageId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

import { searchSidebarThreads } from "./components/Sidebar.logic";
import {
  environmentUnavailableComposerPlaceholder,
  resolveEnvironmentUnavailableChrome,
} from "./components/ChatView.logic";
import { boundedSnapshotProjection } from "@t3tools/shared/orchestrationV2BoundedSnapshot";
import { deriveTimelineEntriesFromVisibleTurnItemsWithState } from "./session-logic";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
  shouldRenderServerThreadView,
} from "./threadRoutes";
import { resolveThreadSyncPhase } from "./threadSync";

vi.mock("./components/ui/tooltip", async (importOriginal) => {
  const original = await importOriginal<typeof import("./components/ui/tooltip")>();
  return {
    ...original,
    Tooltip: (props: { children?: ReactNode }) => props.children,
    TooltipTrigger: (props: { children?: ReactNode }) => props.children,
    TooltipPopup: (props: { children?: ReactNode }) => props.children,
  };
});

vi.mock("./components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: () => null,
}));

vi.mock("@legendapp/list/react", async () => {
  const LegendList = (props: {
    data: Array<{ id: string }>;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    ref?: Ref<LegendListRef>;
  }) => (
    <div data-testid="legend-list">
      {props.ListHeaderComponent}
      {props.data.map((item) => (
        <div key={item.id}>{props.renderItem({ item })}</div>
      ))}
      {props.ListFooterComponent}
    </div>
  );
  return { LegendList };
});

const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("7d1bf2b2");
const THREAD_ID = ThreadId.make("f50e7c5c-6a35-465d-a716-3bf474cea5be");
const MESSAGE_CREATED_AT = "2026-10-09T22:21:00.000Z";
const CACHED_MESSAGE = "Open Stremio on the Tesla";

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let MessagesTimeline: typeof import("./components/chat/MessagesTimeline").MessagesTimeline;

beforeAll(async () => {
  Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true });
  ({ MessagesTimeline } = await import("./components/chat/MessagesTimeline"));
}, 120_000);

function remoteThreads() {
  return [
    {
      environmentId: REMOTE_ENVIRONMENT_ID,
      id: THREAD_ID,
      title: "Remote Stremio Access on Tesla",
    },
  ];
}

function cachedRemoteProjection() {
  const occurredAt = DateTime.makeUnsafe(MESSAGE_CREATED_AT);
  const item = {
    id: TurnItemId.make("user-1"),
    threadId: THREAD_ID,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: occurredAt,
    completedAt: occurredAt,
    updatedAt: occurredAt,
    type: "user_message",
    messageId: MessageId.make("message-1"),
    inputIntent: "turn_start",
    text: CACHED_MESSAGE,
    attachments: [],
    createdBy: "user",
    creationSource: "web",
  } satisfies OrchestrationV2TurnItem;
  return {
    visibleTurnItems: [
      {
        position: 0,
        visibility: "local" as const,
        sourceThreadId: THREAD_ID,
        sourceItemId: item.id,
        item,
      },
    ],
  };
}

function remoteThreadView(input: {
  readonly shellStatus: "live" | "cached" | "synchronizing";
  readonly threadStatus: "live" | "cached" | "synchronizing" | "empty";
  readonly detail: {
    readonly visibleTurnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  } | null;
}) {
  const threads = remoteThreads();
  const listed = searchSidebarThreads(threads, "stremio", new Set());
  const serverThreadShell = { id: THREAD_ID };
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete: isThreadRouteSnapshotAuthoritative(input.shellStatus),
    serverThreadExists: true,
    serverThreadDeleted: false,
    draftThreadExists: false,
  });
  const showThread = shouldRenderServerThreadView({
    renderState,
    serverThreadShell,
    serverThreadDetail: input.detail,
  });
  const timeline = deriveTimelineEntriesFromVisibleTurnItemsWithState({
    visibleTurnItems: input.detail?.visibleTurnItems ?? [],
    optimisticMessages: [],
  });
  const syncPhase = resolveThreadSyncPhase({
    detailExists: input.detail !== null,
    shellExists: true,
    status: input.threadStatus,
  });
  return {
    listed,
    showThread,
    timeline,
    syncPhase,
    messageTexts: timeline.entries.flatMap((entry) =>
      entry.kind === "message" ? [entry.message.text] : [],
    ),
  };
}

function RemoteThreadMessages(props: {
  readonly entries: ReturnType<
    typeof deriveTimelineEntriesFromVisibleTurnItemsWithState
  >["entries"];
}) {
  return (
    <MessagesTimeline
      isWorking={false}
      activeTurnInProgress={false}
      listRef={createRef<LegendListRef | null>()}
      latestRun={null}
      turnDiffSummaries={[]}
      providerStatuses={[]}
      runs={[]}
      routeThreadKey={`${REMOTE_ENVIRONMENT_ID}:${THREAD_ID}`}
      onOpenTurnDiff={() => {}}
      onOpenThread={() => {}}
      onForkFromRun={async () => {}}
      onRollbackCheckpoint={() => {}}
      supportsConversationRollback={false}
      onRevertToTurnCount={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      activeThreadEnvironmentId={REMOTE_ENVIRONMENT_ID}
      markdownCwd={undefined}
      resolvedTheme="light"
      timestampFormat="locale"
      workspaceRoot={undefined}
      anchorMessageId={null}
      onAnchorReady={() => {}}
      onAnchorSizeChanged={() => {}}
      contentInsetEndAdjustment={0}
      liveFollowEnabled
      onIsAtEndChange={() => {}}
      onManualNavigation={() => {}}
      timelineEntries={props.entries}
    />
  );
}

describe("remote environment app shell smoke", () => {
  it("opens an older remote thread from the list and paints its messages while connected", () => {
    const view = remoteThreadView({
      shellStatus: "live",
      threadStatus: "live",
      detail: cachedRemoteProjection(),
    });
    expect(view.listed.map((thread) => thread.title)).toEqual(["Remote Stremio Access on Tesla"]);
    expect(view.showThread).toBe(true);
    expect(view.messageTexts).toEqual([CACHED_MESSAGE]);
    expect(view.syncPhase).toBeNull();

    const markup = renderToStaticMarkup(<RemoteThreadMessages entries={view.timeline.entries} />);
    expect(markup).toContain(CACHED_MESSAGE);
  });

  it("keeps the cached timeline after disconnect and marks the composer read-only", () => {
    const view = remoteThreadView({
      shellStatus: "cached",
      threadStatus: "cached",
      detail: cachedRemoteProjection(),
    });
    expect(view.showThread).toBe(true);
    expect(view.messageTexts).toEqual([CACHED_MESSAGE]);
    expect(view.syncPhase).toBe("syncing");

    const chrome = resolveEnvironmentUnavailableChrome({
      label: "serge",
      phase: "reconnecting",
      updateRunning: false,
      hadConnectedSession: false,
      reconnectGraceElapsed: false,
    });
    expect(chrome.bannerTitle).toBe("Reconnecting to serge...");
    expect(chrome.suppressBanner).toBe(false);
    expect(chrome.composerReadOnly).toBe(true);
    expect(
      environmentUnavailableComposerPlaceholder({ label: "serge", phase: "reconnecting" }),
    ).toBe("Reconnecting to serge...");

    const markup = renderToStaticMarkup(<RemoteThreadMessages entries={view.timeline.entries} />);
    expect(markup).toContain(CACHED_MESSAGE);
  });

  it("still paints the same cached messages after the remote reconnects", () => {
    const disconnected = remoteThreadView({
      shellStatus: "cached",
      threadStatus: "cached",
      detail: cachedRemoteProjection(),
    });
    const reconnected = remoteThreadView({
      shellStatus: "live",
      threadStatus: "live",
      detail: cachedRemoteProjection(),
    });
    expect(disconnected.messageTexts).toEqual(reconnected.messageTexts);
    expect(reconnected.messageTexts).toEqual([CACHED_MESSAGE]);
    expect(reconnected.showThread).toBe(true);
  });

  it("paints compact bounded snapshot messages from an older remote server", () => {
    const occurredAt = DateTime.makeUnsafe(MESSAGE_CREATED_AT);
    const item = {
      id: TurnItemId.make("user-compact"),
      threadId: THREAD_ID,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: occurredAt,
      completedAt: occurredAt,
      updatedAt: occurredAt,
      type: "user_message",
      messageId: MessageId.make("message-compact"),
      inputIntent: "turn_start",
      text: CACHED_MESSAGE,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    } satisfies OrchestrationV2TurnItem;
    const restored = boundedSnapshotProjection({
      turnItemsOmitLocalVisible: true,
      projection: {
        thread: { id: THREAD_ID },
        turnItems: [],
        visibleTurnItems: [
          {
            position: 0,
            visibility: "local",
            sourceThreadId: THREAD_ID,
            sourceItemId: item.id,
            item,
          },
        ],
        messages: [
          {
            id: MessageId.make("message-compact"),
            threadId: THREAD_ID,
            runId: null,
            nodeId: null,
            role: "user",
            text: CACHED_MESSAGE,
            attachments: [],
            streaming: false,
            createdBy: "user",
            creationSource: "web",
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        ],
      } as never,
    });
    const view = remoteThreadView({
      shellStatus: "live",
      threadStatus: "live",
      detail: restored,
    });
    expect(view.showThread).toBe(true);
    expect(view.messageTexts).toEqual([CACHED_MESSAGE]);
    expect(view.syncPhase).toBeNull();

    const markup = renderToStaticMarkup(<RemoteThreadMessages entries={view.timeline.entries} />);
    expect(markup).toContain(CACHED_MESSAGE);
    expect(markup).not.toContain("Send a message to start the conversation.");
  });

  it("paints conversation messages when an older remote snapshot has an empty visible window", () => {
    const occurredAt = DateTime.makeUnsafe(MESSAGE_CREATED_AT);
    const restored = boundedSnapshotProjection({
      projection: {
        thread: { id: THREAD_ID },
        turnItems: [],
        visibleTurnItems: [],
        messages: [
          {
            id: MessageId.make("message-legacy"),
            threadId: THREAD_ID,
            runId: null,
            nodeId: null,
            role: "user",
            text: CACHED_MESSAGE,
            attachments: [],
            streaming: false,
            createdBy: "user",
            creationSource: "web",
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        ],
      } as never,
    });
    const view = remoteThreadView({
      shellStatus: "live",
      threadStatus: "live",
      detail: restored,
    });
    expect(view.messageTexts).toEqual([CACHED_MESSAGE]);

    const markup = renderToStaticMarkup(<RemoteThreadMessages entries={view.timeline.entries} />);
    expect(markup).toContain(CACHED_MESSAGE);
  });

  it("stays blank when a synchronizing remote has no shell row and no HTTP detail", () => {
    const renderState = resolveThreadRouteRenderState({
      bootstrapComplete: isThreadRouteSnapshotAuthoritative("synchronizing"),
      serverThreadExists: false,
      serverThreadDeleted: false,
      draftThreadExists: false,
    });
    expect(
      shouldRenderServerThreadView({
        renderState,
        serverThreadShell: null,
        serverThreadDetail: null,
      }),
    ).toBe(false);
  });
});
