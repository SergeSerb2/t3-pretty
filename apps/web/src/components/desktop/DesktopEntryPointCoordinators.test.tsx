import {
  type DesktopAppActivationRequest,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  primary: null as {
    environmentId: EnvironmentId;
    connection: { phase: "connected" };
    serverConfig: { environment: { platform: { os: "linux" } } };
  } | null,
  snapshotReady: false,
  navigate: vi.fn(async () => undefined),
  openThread: vi.fn(),
  scratchEnvironmentId: vi.fn(),
  openScratchProject: vi.fn(),
  openFile: vi.fn(),
  openUrl: vi.fn(),
  toast: vi.fn(),
  setLinksReady: vi.fn(async (_ready: boolean) => undefined),
  setActivationReady: vi.fn(async (_ready: boolean) => undefined),
  complete: vi.fn(async (_response: unknown) => undefined),
  linkListener: undefined as ((url: string) => void) | undefined,
  requestListener: undefined as ((request: DesktopAppActivationRequest) => void) | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: state.navigate, state: { matches: [] } }),
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironment: () => state.primary,
  useEnvironmentHttpBaseUrl: () => (state.primary === null ? null : "http://localhost:3773"),
}));
vi.mock("../../hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => state.openThread,
}));
vi.mock("../../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: state.scratchEnvironmentId,
    openScratchProject: state.openScratchProject,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../../state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("../../state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { create: {} } }));
vi.mock("../../state/shell", () => ({ environmentShell: { stateAtom: vi.fn() } }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.snapshotReady ? { snapshot: { _tag: "Some" } } : null,
  }),
}));
vi.mock("../../state/entities", () => ({
  readProjects: () => [{ id: "project-1", environmentId: "local", workspaceRoot: "/workspace" }],
  waitForProject: vi.fn(),
}));
vi.mock("../../lib/projectPaths", () => ({
  findProjectByPath: (projects: ReadonlyArray<unknown>) => projects[0],
  inferProjectTitleFromPath: vi.fn(),
}));
vi.mock("../../lib/utils", () => ({ newProjectId: vi.fn() }));
vi.mock("../../browser/openFileInPreview", () => ({
  openFileInPreview: state.openFile,
  openUrlInPreview: state.openUrl,
}));
vi.mock("../../browser/previewRuntime", () => ({ isPreviewAvailableFor: () => true }));
vi.mock("../../composerDraftStore", () => ({ useComposerDraftStore: { getState: vi.fn() } }));
vi.mock("../../rightPanelStore", () => ({
  selectActiveRightPanelSurface: vi.fn(),
  useRightPanelStore: { getState: () => ({ requestMaximize: vi.fn() }) },
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: state.toast },
}));

import { DesktopAppActivationCoordinator } from "./DesktopAppActivationCoordinator";
import { DesktopWebLinkCoordinator } from "./DesktopWebLinkCoordinator";

let renderer: ReactTestRenderer | undefined;

function bridge(localEnabled: boolean) {
  return {
    getLocalEnvironmentEnabled: () => localEnabled,
    webLinks: {
      setReady: state.setLinksReady,
      onOpen: (listener: (url: string) => void) => {
        state.linkListener = listener;
        return () => {
          state.linkListener = undefined;
        };
      },
    },
    appActivation: {
      setReady: state.setActivationReady,
      complete: state.complete,
      onRequest: (listener: (request: DesktopAppActivationRequest) => void) => {
        state.requestListener = listener;
        return () => {
          state.requestListener = undefined;
        };
      },
    },
  };
}

const request = {
  version: 1,
  requestId: "open-1",
  type: "open-workspace",
  workspaceRoot: "/workspace",
  platform: "linux",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  state.primary = null;
  state.snapshotReady = false;
  state.linkListener = undefined;
  state.requestListener = undefined;
  state.openThread.mockResolvedValue({ threadId: ThreadId.make("thread-1") });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { desktopBridge: bridge(false) });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("opens prompt and thread links without a primary local environment", async () => {
  await act(async () => {
    renderer = create(<DesktopWebLinkCoordinator />);
  });
  expect(state.setLinksReady).toHaveBeenCalledWith(true);
  await act(async () => {
    state.linkListener?.("t3code://new?prompt=hello");
    state.linkListener?.("t3code://threads/remote/thread-1");
  });
  expect(state.navigate.mock.calls).toEqual([
    [{ href: "/new?prompt=hello" }],
    [{ href: "/remote/thread-1" }],
  ]);
});

it("rejects a local file without creating a remote scratch thread", async () => {
  await act(async () => {
    renderer = create(<DesktopWebLinkCoordinator />);
  });
  await act(async () => {
    state.linkListener?.("file:///Users/test/index.html");
  });
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Could not open the link" }),
  );
  expect(state.scratchEnvironmentId).not.toHaveBeenCalled();
  expect(state.openFile).not.toHaveBeenCalled();
});

it("opens a web link in the available remote scratch project without a primary", async () => {
  const environmentId = EnvironmentId.make("remote");
  const projectId = ProjectId.make("scratch");
  state.scratchEnvironmentId.mockReturnValue(environmentId);
  state.openScratchProject.mockResolvedValue({ environmentId, id: projectId });
  state.openUrl.mockResolvedValue({ _tag: "Success" });
  await act(async () => {
    renderer = create(<DesktopWebLinkCoordinator />);
  });
  await act(async () => {
    state.linkListener?.("https://example.com");
  });
  expect(state.openThread).toHaveBeenCalledWith({ environmentId, projectId });
  expect(state.openUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      threadRef: { environmentId, threadId: ThreadId.make("thread-1") },
      url: "https://example.com",
    }),
  );
});

it("returns environment-unavailable for CLI requests when the local environment is off", async () => {
  await act(async () => {
    renderer = create(<DesktopAppActivationCoordinator />);
  });
  expect(state.setActivationReady).toHaveBeenCalledWith(true);
  await act(async () => {
    state.requestListener?.(request);
  });
  expect(state.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: request.requestId,
      ok: false,
      code: "environment-unavailable",
    }),
  );
  expect(state.openThread).not.toHaveBeenCalled();
});

it("keeps local startup requests queued until the primary shell is ready", async () => {
  vi.stubGlobal("window", { desktopBridge: bridge(true) });
  await act(async () => {
    renderer = create(
      <>
        <DesktopWebLinkCoordinator />
        <DesktopAppActivationCoordinator />
      </>,
    );
  });
  expect(state.setLinksReady).not.toHaveBeenCalled();
  expect(state.setActivationReady).not.toHaveBeenCalled();
  state.primary = {
    environmentId: EnvironmentId.make("local"),
    connection: { phase: "connected" },
    serverConfig: { environment: { platform: { os: "linux" } } },
  };
  state.snapshotReady = true;
  await act(async () => {
    renderer!.update(
      <>
        <DesktopWebLinkCoordinator />
        <DesktopAppActivationCoordinator />
      </>,
    );
  });
  await act(async () => {
    state.requestListener?.(request);
  });
  expect(state.complete).toHaveBeenCalledWith({
    version: 1,
    requestId: request.requestId,
    ok: true,
    projectId: ProjectId.make("project-1"),
    threadId: ThreadId.make("thread-1"),
  });
});
