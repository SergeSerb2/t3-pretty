import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type SidebarProjectLayout,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { act, useLayoutEffect, useSyncExternalStore } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  client: null as unknown as typeof DEFAULT_CLIENT_SETTINGS,
  environments: [] as Array<{
    environmentId: EnvironmentId;
    connection: { phase: "connected" | "disconnected" };
    serverConfig: {
      environment: { capabilities: { sidebarProjectLayout: boolean } };
      settings: typeof DEFAULT_SERVER_SETTINGS;
    };
  }>,
  hydrated: true,
  writable: new Set<EnvironmentId>(),
  listeners: new Set<() => void>(),
  persist: vi.fn(),
  localOrder: [] as string[],
  projects: [] as import("../../types").Project[],
}));

function notify() {
  for (const listener of state.listeners) listener();
}
function subscribe(listener: () => void) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (selector = (value: typeof DEFAULT_CLIENT_SETTINGS) => value) =>
    selector(useSyncExternalStore(subscribe, () => state.client)),
  useClientSettingsHydrated: () => useSyncExternalStore(subscribe, () => state.hydrated),
  getClientSettings: () => state.client,
  persistClientSettingsPatch: async (patch: Partial<typeof DEFAULT_CLIENT_SETTINGS>) => {
    state.client = { ...state.client, ...patch };
    notify();
  },
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: useSyncExternalStore(subscribe, () => state.environments),
  }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => useSyncExternalStore(subscribe, () => state.projects),
}));
vi.mock("../../state/session", () => ({ useEnvironmentsWithScope: () => state.writable }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: Symbol("updateSettings") },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.persist }));
vi.mock("../../uiStateStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../uiStateStore")>()),
  useUiStateStore: Object.assign(
    (selector: (value: { projectOrder: string[] }) => unknown) =>
      selector({ projectOrder: state.localOrder }),
    {
      getState: () => ({ projectOrder: state.localOrder }),
    },
  ),
}));
vi.mock("../../localApi", () => ({ readLocalApi: () => null }));
vi.mock("./ProjectFolderNameDialog", () => ({
  requestProjectFolderIcon: vi.fn(),
  requestProjectFolderName: vi.fn(),
}));

import { useSidebarProjectFolders } from "../../hooks/useSidebarProjectFolders";
import { SidebarProjectLayoutSync } from "./SidebarProjectLayoutSync";

const mac = EnvironmentId.make("mac");
const windows = EnvironmentId.make("windows");
const initial: SidebarProjectLayout = {
  version: 10,
  folders: [
    { id: "work", name: "Work", collapsed: false },
    { id: "home", name: "Home", collapsed: false },
  ],
  assignments: { a: "work", b: "home", offline: "work" },
  projectOrder: ["a", "offline", "b"],
};
const project = (id: string, environmentId: EnvironmentId, workspaceRoot: string) => ({
  id: ProjectId.make(id),
  environmentId,
  workspaceRoot,
  title: id,
  repositoryIdentity: {
    canonicalKey: `example.com/org/${id}`,
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: `https://example.com/org/${id}.git`,
    },
    provider: "other",
    owner: "org",
    name: id,
    displayName: id,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

let renderer: ReactTestRenderer | undefined;
let rail: ReturnType<typeof useSidebarProjectFolders>;
function Client() {
  const current = useSidebarProjectFolders();
  useLayoutEffect(() => {
    rail = current;
  });
  return <SidebarProjectLayoutSync />;
}
function environment(environmentId: EnvironmentId, layout: SidebarProjectLayout | null) {
  return {
    environmentId,
    connection: { phase: "connected" as const },
    serverConfig: {
      environment: { capabilities: { sidebarProjectLayout: true } },
      settings: { ...DEFAULT_SERVER_SETTINGS, sidebarProjectLayout: layout },
    },
  };
}
async function mount() {
  await act(() => {
    renderer = create(<Client />);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.client = DEFAULT_CLIENT_SETTINGS;
  state.environments = [environment(mac, initial), environment(windows, initial)];
  state.hydrated = true;
  state.writable = new Set([mac, windows]);
  state.localOrder = [];
  state.projects = [];
  state.persist.mockReset();
  state.persist.mockImplementation(
    async ({
      environmentId,
      input,
    }: {
      environmentId: EnvironmentId;
      input: { patch: ServerSettingsPatch };
    }) => {
      state.environments = state.environments.map((entry) =>
        entry.environmentId === environmentId
          ? {
              ...entry,
              serverConfig: {
                ...entry.serverConfig,
                settings: applyServerSettingsPatch(entry.serverConfig.settings, input.patch),
              },
            }
          : entry,
      );
      notify();
      return { _tag: "Success" };
    },
  );
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  state.listeners.clear();
  vi.unstubAllGlobals();
});

describe("project rail replica sync", () => {
  it("uses the saved grouping mode before migrating machine-specific folder assignments", async () => {
    const separated = {
      ...initial,
      groupingMode: "separate" as const,
      groupingOverrides: {},
      assignments: { "mac:/repo/a": "work" },
      projectOrder: ["mac:/repo/a"],
    };
    state.environments = [environment(mac, separated)];
    state.projects = [project("a", mac, "/repo/a")];
    await mount();
    expect(state.client.sidebarProjectGroupingMode).toBe("separate");
    expect(rail.settings.assignments).toEqual(separated.assignments);
    expect(state.client.sidebarProjectLayout).toEqual(separated);
    expect(state.persist).not.toHaveBeenCalled();
  });
  it("migrates machine paths when identities arrive and retains order with a different machine's projects", async () => {
    state.environments = [];
    state.client = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarProjectLayout: {
        ...initial,
        assignments: { "mac:/repo/a": "work", offline: "work" },
        projectOrder: ["mac:/repo/a", "offline", "legacy-project-cwd:/repo/b"],
      },
    };
    await mount();
    await act(() => {
      state.projects = [project("a", mac, "/repo/a"), project("b", mac, "/repo/b")];
      notify();
    });
    expect(state.client.sidebarProjectLayout?.projectOrder).toEqual([
      "example.com/org/a",
      "offline",
      "example.com/org/b",
    ]);
    expect(rail.settings.assignments).toEqual({ "example.com/org/a": "work", offline: "work" });
    await act(() =>
      rail.reorderProjects(
        ["example.com/org/a", "example.com/org/b"],
        ["example.com/org/b"],
        ["example.com/org/a"],
      ),
    );
    const saved = state.client.sidebarProjectLayout;
    expect(saved?.projectOrder).toEqual(["example.com/org/b", "offline", "example.com/org/a"]);
    await act(() => {
      state.projects = [project("a", windows, "C:\\repo\\a"), project("b", windows, "C:\\repo\\b")];
      notify();
    });
    expect(rail.projectOrder).toEqual(saved?.projectOrder);
    expect(state.client.sidebarProjectLayout).toEqual(saved);
  });
  it("renders and repairs the newest layout on clients with opposite server order", async () => {
    const edited = {
      ...initial,
      version: 20,
      sortOrder: "manual" as const,
      groupingMode: "separate" as const,
      groupingOverrides: { "windows:/repo": "repository_path" as const },
      folders: initial.folders.toReversed(),
      assignments: { a: "home", b: "home", offline: "work" },
      projectOrder: ["b", "offline", "a"],
    };
    state.environments = [environment(mac, initial), environment(windows, edited)];
    await mount();
    expect(rail.settings).toEqual({ folders: edited.folders, assignments: edited.assignments });
    expect(rail.projectOrder).toEqual(edited.projectOrder);
    expect(state.client.sidebarProjectLayout).toEqual(edited);
    expect(state.client.sidebarProjectSortOrder).toBe("manual");
    expect(state.client.sidebarProjectGroupingMode).toBe("separate");
    expect(state.client.sidebarProjectGroupingOverrides).toEqual(edited.groupingOverrides);
    expect(state.environments[0]!.serverConfig.settings.sidebarProjectLayout).toEqual(edited);
    expect(state.persist).toHaveBeenCalledTimes(1);
    await act(() => {
      state.environments = state.environments.toReversed();
      notify();
    });
    expect(rail.settings.assignments.a).toBe("home");
    expect(state.persist).toHaveBeenCalledTimes(1);
  });

  it("saves rapid folder moves and project order offline, then repairs a reconnected machine", async () => {
    state.client = { ...DEFAULT_CLIENT_SETTINGS, sidebarProjectLayout: initial };
    state.environments = state.environments.map((entry) => ({
      ...entry,
      connection: { phase: "disconnected" },
    }));
    await mount();
    await act(() => {
      rail.applyDrop("a", { kind: "folder", folderId: "home" });
      rail.applyDrop("b", { kind: "folder", folderId: "work" });
      rail.reorderProjects(["a", "b"], ["b"], ["a"]);
    });
    const saved = state.client.sidebarProjectLayout!;
    expect(saved.assignments).toEqual({ a: "home", b: "work", offline: "work" });
    expect(saved.projectOrder).toEqual(["b", "offline", "a"]);
    expect(state.persist).not.toHaveBeenCalled();
    await act(() => {
      state.environments = [environment(windows, initial), environment(mac, initial)];
      notify();
    });
    expect(
      state.environments.map((entry) => entry.serverConfig.settings.sidebarProjectLayout),
    ).toEqual([saved, saved]);
    expect(state.persist).toHaveBeenCalledTimes(2);
  });

  it("does not restore a deleted last folder from a stale connected server", async () => {
    const cleared = { version: 20, folders: [], assignments: {}, projectOrder: [] };
    state.client = { ...DEFAULT_CLIENT_SETTINGS, sidebarProjectLayout: cleared };
    await mount();
    expect(rail.settings).toEqual({ folders: [], assignments: {} });
    expect(
      state.environments.every(
        (entry) => entry.serverConfig.settings.sidebarProjectLayout?.folders.length === 0,
      ),
    ).toBe(true);
  });

  it("waits for client hydration and respects grants and older servers", async () => {
    state.hydrated = false;
    state.client = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarProjectLayout: { ...initial, version: 20 },
    };
    await mount();
    expect(state.persist).not.toHaveBeenCalled();
    await act(() => {
      state.hydrated = true;
      state.writable = new Set([mac]);
      state.environments = state.environments.map((entry) =>
        entry.environmentId === mac
          ? {
              ...entry,
              serverConfig: {
                ...entry.serverConfig,
                environment: { capabilities: { sidebarProjectLayout: false } },
              },
            }
          : entry,
      );
      notify();
    });
    expect(state.persist).not.toHaveBeenCalled();
    await act(() => {
      state.writable = new Set([windows]);
      state.environments = [...state.environments];
      notify();
    });
    expect(state.persist).toHaveBeenCalledTimes(1);
    expect(state.persist.mock.calls[0]![0].environmentId).toBe(windows);
  });

  it("does not let startup migration overwrite a later remote edit", async () => {
    state.environments = [];
    state.client = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarProjectFolders: initial.folders,
      sidebarProjectFolderAssignments: initial.assignments,
    };
    await mount();
    expect(state.client.sidebarProjectLayout?.version).toBe(1);
    const edited = { ...initial, version: 20, assignments: { a: "home" } };
    await act(() => {
      state.environments = [environment(windows, edited)];
      notify();
    });
    expect(rail.settings.assignments).toEqual({ a: "home" });
    expect(state.client.sidebarProjectLayout).toEqual(edited);
    expect(state.persist).not.toHaveBeenCalled();
  });

  it("retries a failed save when that environment reconnects", async () => {
    state.client = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarProjectLayout: { ...initial, version: 20 },
    };
    state.environments = [environment(windows, initial)];
    state.persist.mockResolvedValueOnce({ _tag: "Failure" });
    await mount();
    expect(state.persist).toHaveBeenCalledTimes(1);
    await act(() => {
      state.environments = state.environments.map((entry) => ({
        ...entry,
        connection: { phase: "disconnected" },
      }));
      notify();
    });
    await act(() => {
      state.environments = state.environments.map((entry) => ({
        ...entry,
        connection: { phase: "connected" },
      }));
      notify();
    });
    expect(state.persist).toHaveBeenCalledTimes(2);
    expect(state.environments[0]!.serverConfig.settings.sidebarProjectLayout).toEqual(
      state.client.sidebarProjectLayout,
    );
  });
});
