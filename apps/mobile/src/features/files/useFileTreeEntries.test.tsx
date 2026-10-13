// @vitest-environment jsdom
import { EnvironmentId, type ProjectEntry } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refresh: vi.fn(),
  rootRefresh: vi.fn(),
  subscriptions: vi.fn(),
  rootData: {
    entries: [
      { path: "src", kind: "directory", ignored: false },
      { path: "other", kind: "directory", ignored: false },
    ],
  },
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ executeAtomQuery: mocks.query }));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { refresh: mocks.refresh } }));
vi.mock("../../state/projects", () => ({
  projectEnvironment: {
    listEntries: (request: unknown) => request,
    searchEntries: (request: unknown) => request,
  },
}));
vi.mock("../../state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { readonly input: { readonly query?: string } } | null) => {
    mocks.subscriptions(atom);
    return {
      data:
        atom === null
          ? null
          : atom.input.query === undefined
            ? mocks.rootData
            : {
                entries: [{ path: `match-${atom.input.query}.ts`, kind: "file", ignored: false }],
                truncated: true,
              },
      error: null,
      isPending: false,
      refresh: mocks.rootRefresh,
    };
  },
}));

import { useFileTreeEntries } from "./useFileTreeEntries";
import {
  InspectorVisibilityProvider,
  useInspectorVisibility,
} from "../layout/inspector-visibility";
import {
  NativeWorkspaceInspectorContext,
  NativeWorkspaceModeContext,
} from "../../native/v5-workspace-context";

const environmentId = EnvironmentId.make("file-tree-visibility");
const requests: Array<{
  readonly path: string;
  readonly signal: AbortSignal;
  readonly resolve: (result: {
    readonly _tag: "Success";
    readonly value: { readonly entries: readonly ProjectEntry[] };
  }) => void;
}> = [];
let root: Root;
let latest: ReturnType<typeof useFileTreeEntries>;
function Probe(props: {
  readonly enabled: boolean;
  readonly cwd?: string;
  readonly environmentId?: EnvironmentId;
  readonly searchQuery?: string;
}) {
  const tree = useFileTreeEntries({
    environmentId: props.environmentId ?? environmentId,
    cwd: props.cwd ?? "/workspace",
    searchQuery: props.searchQuery ?? "",
    enabled: props.enabled,
  });
  useEffect(() => {
    latest = tree;
  });
  return null;
}
function render(enabled = true) {
  act(() => root.render(<Probe enabled={enabled} />));
}
async function resolve(index: number, entries: readonly ProjectEntry[]) {
  await act(async () => requests[index]!.resolve({ _tag: "Success", value: { entries } }));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests.length = 0;
  mocks.query.mockReset().mockImplementation(
    (
      _registry: unknown,
      request: { input: { directoryPath: string } },
      options: { signal: AbortSignal },
    ) =>
      new Promise((complete) =>
        requests.push({
          path: request.input.directoryPath,
          signal: options.signal,
          resolve: complete,
        }),
      ),
  );
  mocks.refresh.mockClear();
  mocks.rootRefresh.mockClear();
  mocks.subscriptions.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("cancels a closed inspector's directory read and resumes without losing cached directories", async () => {
  render();
  act(() => {
    latest.loadDirectory("src");
  });
  await resolve(0, [{ path: "src/kept.ts", kind: "file", ignored: false }]);
  act(() => {
    latest.loadDirectory("other");
  });
  const second = requests[1]!;
  render(false);
  expect(second.signal.aborted).toBe(true);
  expect(latest.loadingDirectories.size).toBe(0);
  expect(mocks.subscriptions.mock.calls.slice(-2).map(([atom]) => atom)).toEqual([null, null]);
  await resolve(1, [{ path: "other/stale.ts", kind: "file", ignored: false }]);
  expect(latest.entries.map((entry) => entry.path)).toContain("src/kept.ts");
  expect(latest.entries.map((entry) => entry.path)).not.toContain("other/stale.ts");
  act(() => {
    latest.loadDirectory("other");
  });
  expect(requests.length).toBe(2);
  render();
  act(() => {
    latest.loadDirectory("src");
    latest.loadDirectory("other");
  });
  expect(requests.length).toBe(3);
  expect(requests[2]?.path).toBe("other");
  await resolve(2, [{ path: "other/current.ts", kind: "file", ignored: false }]);
  expect(latest.entries.map((entry) => entry.path)).toEqual([
    "src",
    "src/kept.ts",
    "other",
    "other/current.ts",
  ]);
});

it("does not start hidden directory reads or a refresh", async () => {
  mocks.query.mockResolvedValue({ _tag: "Success", value: { entries: [] } });
  render(false);
  act(() => {
    latest.loadDirectory("src");
  });
  await act(async () => {
    await latest.refresh();
  });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.rootRefresh).not.toHaveBeenCalled();
});

it("does not let a canceled same-path reply clear its replacement's loading state", async () => {
  render();
  act(() => {
    latest.loadDirectory("src");
  });
  render(false);
  render();
  act(() => {
    latest.loadDirectory("src");
  });
  await resolve(0, [{ path: "src/obsolete.ts", kind: "file", ignored: false }]);
  expect(latest.loadingDirectories.has("src")).toBe(true);
  expect(latest.entries.map(({ path }) => path)).not.toContain("src/obsolete.ts");
  await resolve(1, [{ path: "src/current.ts", kind: "file", ignored: false }]);
  expect(latest.loadingDirectories.has("src")).toBe(false);
  expect(latest.entries.map(({ path }) => path)).toContain("src/current.ts");
});

it("retains the closed search result only for its own search query", () => {
  act(() => root.render(<Probe enabled searchQuery="old" />));
  expect(latest.entries.map(({ path }) => path)).toContain("match-old.ts");
  act(() => root.render(<Probe enabled={false} searchQuery="old" />));
  expect(latest.entries.map(({ path }) => path)).toContain("match-old.ts");
  expect(latest.searchTruncated).toBe(true);
  act(() => root.render(<Probe enabled={false} searchQuery="new" />));
  expect(latest.entries.map(({ path }) => path)).not.toContain("match-old.ts");
  expect(latest.searchTruncated).toBe(false);
  act(() => root.render(<Probe enabled searchQuery="new" />));
  expect(latest.entries.map(({ path }) => path)).toContain("match-new.ts");
});

it.each(["cwd", "environment"] as const)(
  "resets the file cache and aborts reads after a %s change",
  async (changed) => {
    render();
    act(() => {
      latest.loadDirectory("src");
    });
    await resolve(0, [{ path: "src/old.ts", kind: "file", ignored: false }]);
    act(() => {
      latest.loadDirectory("other");
    });
    act(() =>
      root.render(
        <Probe
          enabled
          cwd={changed === "cwd" ? "/new-workspace" : "/workspace"}
          environmentId={
            changed === "environment" ? EnvironmentId.make("new-environment") : environmentId
          }
        />,
      ),
    );
    expect(requests[1]?.signal.aborted).toBe(true);
    await resolve(1, [{ path: "other/old.ts", kind: "file", ignored: false }]);
    expect(latest.loadedDirectories.size).toBe(0);
    expect(latest.entries.map(({ path }) => path)).toEqual(["src", "other"]);
    act(() => {
      latest.loadDirectory("src");
    });
    await resolve(2, [{ path: "src/new.ts", kind: "file", ignored: false }]);
    expect(latest.entries.map(({ path }) => path)).toContain("src/new.ts");
    expect(latest.entries.map(({ path }) => path)).not.toContain("src/old.ts");
  },
);

it("cancels refresh leases and retries an interrupted refresh without dropping cached children", async () => {
  render();
  act(() => {
    latest.loadDirectory("src");
  });
  await resolve(0, [{ path: "src/kept.ts", kind: "file", ignored: false }]);
  let refreshed: Promise<unknown>;
  act(() => {
    refreshed = latest.refresh();
  });
  expect(requests.slice(1).map(({ path }) => path)).toEqual(["", "src"]);
  render(false);
  expect(requests.slice(1).every(({ signal }) => signal.aborted)).toBe(true);
  expect(latest.isRefreshing).toBe(false);
  expect(latest.entries.map(({ path }) => path)).toContain("src/kept.ts");
  await resolve(1, []);
  await resolve(2, [{ path: "src/stale.ts", kind: "file", ignored: false }]);
  await refreshed!;
  render();
  expect(latest.isRefreshing).toBe(false);
  act(() => {
    latest.loadDirectory("src");
  });
  expect(requests[3]?.path).toBe("src");
  expect(latest.entries.map(({ path }) => path)).toContain("src/kept.ts");
  await resolve(3, [{ path: "src/fresh.ts", kind: "file", ignored: false }]);
  expect(latest.entries.map(({ path }) => path)).toContain("src/fresh.ts");
  expect(latest.entries.map(({ path }) => path)).not.toContain("src/stale.ts");
});

function InspectorProbe() {
  return <Probe enabled={useInspectorVisibility()} />;
}
function renderInspector(input: {
  outerVisible: boolean;
  modeVisible: boolean;
  nativeWorkspace: boolean;
  nativeVisible: boolean;
}) {
  act(() =>
    root.render(
      <NativeWorkspaceModeContext value={input.nativeWorkspace}>
        <NativeWorkspaceInspectorContext
          value={{ render: undefined, visible: input.nativeVisible }}
        >
          <InspectorVisibilityProvider visible={input.outerVisible}>
            <InspectorVisibilityProvider visible={input.modeVisible}>
              <InspectorProbe />
            </InspectorVisibilityProvider>
          </InspectorVisibilityProvider>
        </NativeWorkspaceInspectorContext>
      </NativeWorkspaceModeContext>,
    ),
  );
}

it.each(["outer", "mode", "native"] as const)(
  "pauses reads when the %s inspector visibility closes and preserves the retained pane",
  async (closed) => {
    const visible = {
      outerVisible: true,
      modeVisible: true,
      nativeWorkspace: closed === "native",
      nativeVisible: true,
    };
    renderInspector(visible);
    act(() => {
      latest.loadDirectory("src");
    });
    await resolve(0, [{ path: "src/kept.ts", kind: "file", ignored: false }]);
    act(() => {
      latest.loadDirectory("other");
    });
    renderInspector({
      ...visible,
      outerVisible: closed !== "outer",
      modeVisible: closed !== "mode",
      nativeVisible: closed !== "native",
    });
    expect(requests[1]?.signal.aborted).toBe(true);
    renderInspector(visible);
    act(() => {
      latest.loadDirectory("src");
      latest.loadDirectory("other");
    });
    expect(requests.length).toBe(3);
    expect(requests[2]?.path).toBe("other");
    expect(latest.entries.map(({ path }) => path)).toContain("src/kept.ts");
  },
);
