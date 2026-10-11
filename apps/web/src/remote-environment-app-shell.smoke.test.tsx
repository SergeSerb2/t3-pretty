// @vitest-environment jsdom

import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

import { searchSidebarThreads } from "./components/Sidebar.logic";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
  shouldRenderServerThreadView,
} from "./threadRoutes";

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
const THREAD_ID = ThreadId.make("remote-thread-1");
const MESSAGE_CREATED_AT = "2026-10-11T22:21:00.000Z";

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
      title: "Serge remote launch",
    },
  ];
}

function RemoteEnvironmentAppShell(props: {
  readonly serverThreadShell: { readonly id: string } | null;
  readonly serverThreadDetail: { readonly messages: ReadonlyArray<string> } | null;
}) {
  const threads = remoteThreads();
  const listed = searchSidebarThreads(threads, "remote", new Set());
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete: isThreadRouteSnapshotAuthoritative("synchronizing"),
    serverThreadExists: props.serverThreadShell !== null || props.serverThreadDetail !== null,
    serverThreadDeleted: false,
    draftThreadExists: false,
  });
  const showThread = shouldRenderServerThreadView({
    renderState,
    serverThreadShell: props.serverThreadShell,
    serverThreadDetail: props.serverThreadDetail,
  });
  return (
    <div data-testid="remote-environment-app-shell">
      <ul aria-label="Thread list">
        {listed.map((thread) => (
          <li key={thread.id}>{thread.title}</li>
        ))}
      </ul>
      {showThread ? <RemoteThreadMessages /> : <div>blank</div>}
    </div>
  );
}

function RemoteThreadMessages() {
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
      timelineEntries={[
        {
          id: "entry-1",
          kind: "message",
          createdAt: MESSAGE_CREATED_AT,
          message: {
            id: MessageId.make("message-1"),
            role: "user",
            text: "Launch this remote thread",
            runId: null,
            createdAt: MESSAGE_CREATED_AT,
            updatedAt: MESSAGE_CREATED_AT,
            streaming: false,
          },
        },
      ]}
    />
  );
}

describe("remote environment app shell smoke", () => {
  it("lists remote threads and paints messages while the shell is only synchronizing", () => {
    const markup = renderToStaticMarkup(
      <RemoteEnvironmentAppShell
        serverThreadShell={{ id: THREAD_ID }}
        serverThreadDetail={{ messages: ["Launch this remote thread"] }}
      />,
    );

    expect(markup).toContain("Serge remote launch");
    expect(markup).toContain("Launch this remote thread");
    expect(markup).not.toContain(">blank<");
  });

  it("stays blank when a synchronizing remote has no shell row and no HTTP detail", () => {
    const markup = renderToStaticMarkup(
      <RemoteEnvironmentAppShell serverThreadShell={null} serverThreadDetail={null} />,
    );

    expect(markup).toContain("Serge remote launch");
    expect(markup).toContain("blank");
    expect(markup).not.toContain("Launch this remote thread");
  });
});
