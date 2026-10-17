// @vitest-environment jsdom
import type { VcsStatusResult } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Native header item factories are only read when options are applied, so the fake
// navigation snapshots the right items at each setOptions, as native-stack does.
const harness = vi.hoisted(() => ({
  setOptionsCalls: 0,
  renderedRightItems: [] as Array<ReadonlyArray<Record<string, unknown>>>,
  navigatedRoutes: [] as string[],
  navigatedParams: [] as unknown[],
  menuItems: [] as Array<{ label: string; onPress: () => void }>,
}));

vi.mock("@react-navigation/native", () => {
  const navigation = {
    canGoBack: () => true,
    dispatch: () => {},
    goBack: () => {},
    navigate: (route: string, params: unknown) => {
      harness.navigatedRoutes.push(route);
      harness.navigatedParams.push(params);
    },
    addListener: () => () => {},
    setOptions: (options: { unstable_headerRightItems?: () => Array<Record<string, unknown>> }) => {
      harness.setOptionsCalls += 1;
      harness.renderedRightItems.push(options.unstable_headerRightItems?.() ?? []);
    },
  };
  return {
    StackActions: { replace: () => ({}) },
    useNavigation: () => navigation,
  };
});
vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => () => {} }));
vi.mock("../../lib/haptics", () => ({ hapticTap: vi.fn() }));
vi.mock("../../components/AppMenuHost", () => ({
  presentActionListMenu: (input: { items: typeof harness.menuItems }) => {
    harness.menuItems = input.items;
  },
}));
vi.mock("../pull-requests/useOpenNativePullRequest", () => ({
  useOpenNativePullRequest: () => vi.fn(),
}));

vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("react-native", () => ({ Alert: { alert: () => {} }, Linking: {}, Platform: {} }));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({
    layout: { usesSplitView: false },
    panes: { primarySidebarVisible: false, auxiliaryPaneVisible: false },
    togglePrimarySidebar: () => {},
    toggleAuxiliaryPane: () => {},
  }),
}));
vi.mock("../layout/native-mail-search-toolbar", () => ({
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED: true,
  createNativeMailSearchToolbarItem: () => ({}),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));

import { ThreadHeader } from "./ThreadHeader";

const projectScripts: never[] = [];

function status(
  files: ReadonlyArray<string>,
  overrides: Partial<VcsStatusResult> = {},
): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "master",
    hasWorkingTreeChanges: files.length > 0,
    workingTree: {
      files: files.map((path) => ({ path, insertions: 0, deletions: 0 })),
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  } as unknown as VcsStatusResult;
}

// Mirrors the route screen: every render passes fresh gitControls callbacks.
function Header(props: {
  readonly gitStatus: VcsStatusResult | null;
  readonly title?: string;
  readonly environmentId?: string;
  readonly threadId?: string;
}) {
  return (
    <ThreadHeader
      title={props.title ?? "Thread"}
      subtitle=""
      headerColor="#000"
      usesNativeHeaderGlass
      gitControls={{
        environmentId: props.environmentId ?? "environment-1",
        threadId: props.threadId ?? "thread-1",
        currentBranch: "master",
        gitStatus: props.gitStatus,
        gitOperationLabel: null,
        onPull: async () => {},
        onRunAction: async () => null,
        canOpenTerminal: true,
        canOperateTerminal: true,
        canOpenFiles: true,
        projectScripts,
        onOpenTerminal: () => {},
        onOpenNewTerminal: () => {},
        onRunProjectScript: async () => {},
        settlementSupported: false,
        snoozeSupported: false,
        settled: false,
        snoozed: false,
        canSettleThread: false,
        canSnoozeThread: false,
        onSettle: () => {},
        onUnsettle: () => {},
        onSnooze: () => {},
        onUnsnooze: () => {},
        storageSupported: false,
        stored: false,
        onStore: () => {},
        onUnstore: () => {},
      }}
      hasThreadCwd
      hasWorkspaceRoot
      fileInspectorSupported={false}
      inspectorMode={null}
      onToggleInspector={() => {}}
      onOpenGitInspector={() => {}}
      onOpenFilesInspector={() => {}}
    />
  );
}

function openRenderedPrMenu() {
  const items = harness.renderedRightItems.at(-1) ?? [];
  const pr = items.find((item) => item.identifier === "thread-right-pr") as
    | { onPress: () => void }
    | undefined;
  if (!pr) throw new Error("Expected the pull request button");
  act(() => pr.onPress());
  return harness.menuItems;
}

let root: Root | null = null;

function render(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  harness.setOptionsCalls = 0;
  harness.renderedRightItems = [];
  harness.navigatedRoutes = [];
  harness.navigatedParams = [];
  harness.menuItems = [];
});

describe("ThreadHeader", () => {
  it("re-applies native pull request menu items when Git status changes", () => {
    render(<Header gitStatus={status([])} />);
    expect(openRenderedPrMenu()[0]?.label).toBe("Create pull request");

    // A refreshed status (e.g. after reconnect) must reach the PR popover even
    // though nothing else in the header changed.
    render(
      <Header
        gitStatus={status([], {
          pr: { state: "open", number: 7, url: "https://example.com/pr/7" },
        } as Partial<VcsStatusResult>)}
      />,
    );
    expect(openRenderedPrMenu()[0]?.label).toBe("View PR #7");

    render(<Header gitStatus={status([])} />);
    expect(openRenderedPrMenu()[0]?.label).toBe("Create pull request");
  });

  it("does not re-apply options for re-renders with equivalent header content", () => {
    render(<Header gitStatus={status([])} />);
    const applied = harness.setOptionsCalls;

    // Streaming re-renders the route with fresh callbacks and equal Git content.
    for (let index = 0; index < 20; index += 1) {
      render(<Header gitStatus={status([])} />);
    }
    expect(harness.setOptionsCalls).toBe(applied);
  });

  it("routes a stable menu label to the current thread and environment", () => {
    render(<Header gitStatus={status([])} />);
    expect(openRenderedPrMenu().at(-1)?.label).toBe("More");

    render(<Header gitStatus={status([])} environmentId="remote-2" threadId="thread-2" />);
    const more = openRenderedPrMenu().at(-1);
    expect(more?.label).toBe("More");
    act(() => more?.onPress());
    expect(harness.navigatedRoutes).toEqual(["GitOverview"]);
    expect(harness.navigatedParams).toEqual([{ environmentId: "remote-2", threadId: "thread-2" }]);
  });
});
