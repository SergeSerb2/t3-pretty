// @vitest-environment jsdom
import { act, createContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  os: "ios",
  split: false,
  isPad: false,
  width: 390,
  navigation: {
    navigate: vi.fn(),
    getState: () => ({ index: 1 }),
    dispatch: vi.fn(),
  },
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return harness.os;
    },
    get isPad() {
      return harness.isPad;
    },
  },
  View: "div",
  Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ width: harness.width }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => harness.navigation,
  StackActions: { popToTop: () => ({ type: "POP_TO_TOP" }) },
}));
vi.mock("react-native-keyboard-controller", () => ({ useKeyboardState: () => 0 }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaInsetsContext: createContext({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("../../native/native-layout-metrics", () => ({
  useNativeColumnLayoutMetrics: () => null,
  useNativeLayoutMetrics: () => null,
}));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("../../components/CompactBrandTitle", () => ({ CompactBrandTitle: () => null }));
vi.mock("../../components/AndroidScreenHeader", () => ({ AndroidScreenHeader: () => null }));
vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("../../components/MaterialScreenContent", () => ({
  MaterialScreenContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ fabClearance: 88 }),
}));
vi.mock("../pull-requests/MaterialPullRequestToolbar.android", () => ({
  MaterialPullRequestToolbar: () => null,
}));
vi.mock("../home/WorkspaceConnectionTitle", () => ({ WorkspaceConnectionTitle: () => null }));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({
  dispatchHardwareKeyboardCommand: vi.fn(),
}));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ layout: { usesSplitView: harness.split } }),
}));
vi.mock("../layout/native-mail-search-toolbar", () => ({
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED: false,
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("@expo/ui/swift-ui", () => ({
  Host: ({ children }: { children: ReactNode }) => <>{children}</>,
  Text: () => null,
  Picker: ({ onSelectionChange }: { onSelectionChange: (tab: string) => void }) => (
    <>
      <button onClick={() => onSelectionChange("threads")}>Threads tab</button>
      <button onClick={() => onSelectionChange("pullRequests")}>Pull requests tab</button>
    </>
  ),
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({ pickerStyle: vi.fn(), tag: vi.fn() }));
vi.mock("./WorkspaceSidebarTabs", async () => import("./WorkspaceSidebarTabs.ios"));
vi.mock("./AndroidWorkspaceNavigation", async () => {
  const { useWorkspaceTabs } = await import("./WorkspaceTabsContext");
  return {
    AndroidWorkspaceNavigation: () => {
      const workspace = useWorkspaceTabs()!;
      return (
        <>
          <button onClick={() => workspace.dispatch({ type: "select", tab: "threads" })}>
            Threads tab
          </button>
          <button onClick={() => workspace.dispatch({ type: "select", tab: "pullRequests" })}>
            Pull requests tab
          </button>
        </>
      );
    },
  };
});
vi.mock("./WorkspaceToolbar", () => ({
  WorkspaceToolbar: () => <button>Native workspace actions</button>,
}));
vi.mock("../home/HomeRouteScreen", async () => {
  const { useHomeTopBarActive } = await import("../home/home-toolbar-ownership");
  const { useWorkspaceTabs } = await import("./WorkspaceTabsContext");
  return {
    HomeRouteScreen: () => {
      const workspace = useWorkspaceTabs()!;
      const customToolbar = useHomeTopBarActive();
      return (
        <>
          <h1>Thread list</h1>
          {customToolbar ? <button>Custom Home actions</button> : null}
          <input aria-label="Thread query" value={workspace.state.tabs.threads.query} readOnly />
          <button onClick={() => workspace.dispatch({ type: "query", query: "retained" })}>
            Filter threads
          </button>
        </>
      );
    },
  };
});
vi.mock("../pull-requests/WorkspacePullRequestsScreen", async () => {
  const { useWorkspaceTabs } = await import("./WorkspaceTabsContext");
  return {
    WorkspacePullRequestsScreen: () => {
      const workspace = useWorkspaceTabs()!;
      return (
        <>
          <h1>Pull request list</h1>
          <p>{workspace.state.selectedTab}</p>
        </>
      );
    },
  };
});

import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { WorkspaceRootScreen } from "./WorkspaceRootScreen";
import { WorkspaceRootScreen as AndroidWorkspaceRootScreen } from "./WorkspaceRootScreen.android";
import { WorkspaceTabsProvider } from "./WorkspaceTabsContext";

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.split = false;
  harness.os = "ios";
  harness.isPad = false;
  harness.width = 390;
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => act(() => root?.unmount()));

function renderWorkspace(android = false) {
  act(() =>
    root!.render(
      <WorkspaceTabsProvider>
        <NativePrimaryColumnContext
          value={{ selectedThreadKey: null, selectedPullRequestKey: null }}
        >
          {android ? <AndroidWorkspaceRootScreen /> : <WorkspaceRootScreen />}
        </NativePrimaryColumnContext>
      </WorkspaceTabsProvider>,
    ),
  );
}

function press(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => button!.click());
}

describe("workspace Home entry", () => {
  it("opens Pull Requests from the iPad sidebar and returns to the retained thread filter", () => {
    harness.split = true;
    harness.isPad = true;
    harness.width = 1100;
    renderWorkspace();
    press("Filter threads");

    press("Pull requests tab");

    expect(container.querySelector("h1")?.textContent).toBe("Pull request list");
    expect(container.textContent).toContain("pullRequests");
    expect(harness.navigation.dispatch).toHaveBeenCalledWith({ type: "POP_TO_TOP" });
    press("Threads tab");
    expect(container.querySelector("h1")?.textContent).toBe("Thread list");
    expect(container.querySelector("input")?.value).toBe("retained");
  });

  it("uses only the workspace toolbar on compact iOS", () => {
    renderWorkspace();
    expect(container.textContent).toContain("Native workspace actions");
    expect(container.textContent).not.toContain("Custom Home actions");
  });

  it("keeps the selected Pull Requests list when the iPad rotates to compact width", () => {
    harness.split = true;
    harness.isPad = true;
    harness.width = 1100;
    renderWorkspace();
    press("Pull requests tab");
    harness.split = false;
    harness.width = 600;
    renderWorkspace();
    expect(container.querySelector("h1")?.textContent).toBe("Pull request list");
    expect(container.textContent).not.toContain("Thread list");
  });

  it("opens Pull Requests and returns to threads through Android's workspace tabs", () => {
    harness.os = "android";
    renderWorkspace(true);
    press("Pull requests tab");
    expect(container.querySelector("h1")?.textContent).toBe("Pull request list");
    press("Threads tab");
    expect(container.querySelector("h1")?.textContent).toBe("Thread list");
  });

  it("keeps Android's Pull Requests selection when rotating into the split workspace", () => {
    harness.os = "android";
    renderWorkspace(true);
    press("Pull requests tab");
    harness.split = true;
    harness.width = 1100;
    renderWorkspace(true);
    expect(container.querySelector("h1")?.textContent).toBe("Select a pull request");
    harness.split = false;
    harness.width = 390;
    renderWorkspace(true);
    expect(container.querySelector("h1")?.textContent).toBe("Pull request list");
  });
});
