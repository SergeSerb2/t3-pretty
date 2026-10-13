// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { environmentRpcKey } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type ProjectSearchEntriesResult } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const controls = vi.hoisted(() => ({
  searches: new Map<
    string,
    Atom.Writable<
      AsyncResult.AsyncResult<ProjectSearchEntriesResult, Error>,
      AsyncResult.AsyncResult<ProjectSearchEntriesResult, Error>
    >
  >(),
}));
// Keep the real debounce, environment-query hook, atom-react store switching,
// and registry. Only replace the RPC producers with controllable query atoms.
vi.mock("../../state/projects", async () => {
  const { environmentRpcKey } = await import("@t3tools/client-runtime/state/runtime");
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const root = Atom.make(AsyncResult.success({ entries: [], truncated: false }));
  return {
    projectEnvironment: {
      listEntries: () => root,
      searchEntries: (target: { environmentId: EnvironmentId; input: unknown }) => {
        const key = environmentRpcKey(target);
        let atom = controls.searches.get(key);
        if (!atom) {
          atom = Atom.make<AsyncResult.AsyncResult<ProjectSearchEntriesResult, Error>>(
            AsyncResult.initial(true),
          );
          controls.searches.set(key, atom);
        }
        return atom;
      },
    },
  };
});
// These other query producers are not used by the real useDebouncedValue export.
vi.mock("../../state/session", () => ({ environmentSession: {} }));
vi.mock("../../state/presentation", () => ({ useEnvironmentPresentation: () => undefined }));
vi.mock("../../state/pull-requests", () => ({ composerPullRequests: {} }));
vi.mock("../../state/orchestration", () => ({ orchestrationEnvironment: {} }));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: {} }));

import { useFileTreeEntries } from "./useFileTreeEntries";

const environmentId = EnvironmentId.make("real-search-switch");
let registry: AtomRegistry.AtomRegistry;
let root: Root;
let latest: ReturnType<typeof useFileTreeEntries>;
function Probe(props: {
  query: string;
  enabled: boolean;
  cwd: string;
  environmentId: EnvironmentId;
}) {
  const tree = useFileTreeEntries({ ...props, searchQuery: props.query });
  useEffect(() => {
    latest = tree;
  });
  return null;
}
function render(query: string, enabled = true, cwd = "/workspace", environment = environmentId) {
  act(() =>
    root.render(
      <RegistryContext value={registry}>
        <Probe query={query} enabled={enabled} cwd={cwd} environmentId={environment} />
      </RegistryContext>,
    ),
  );
}
function atom(query: string, cwd = "/workspace", environment = environmentId) {
  const selected = controls.searches.get(
    environmentRpcKey({ environmentId: environment, input: { cwd, query, limit: 200 } }),
  );
  if (!selected) throw new Error(`Search atom was not read: ${query}`);
  return selected;
}
function resolve(query: string, path: string, cwd = "/workspace", environment = environmentId) {
  act(() =>
    registry.set(
      atom(query, cwd, environment),
      AsyncResult.success({ entries: [{ path, kind: "file" }], truncated: true }),
    ),
  );
}
function debounce() {
  act(() => vi.advanceTimersByTime(200));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  controls.searches.clear();
  registry = AtomRegistry.make();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  registry.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("never retains the previous query under a newly debounced pending query", () => {
  render("old");
  resolve("old", "old-result.ts");
  expect(latest.entries.map(({ path }) => path)).toEqual(["old-result.ts"]);
  render("new");
  // The current atom and retained key are still "old" during the debounce.
  expect(latest.entries.map(({ path }) => path)).toEqual(["old-result.ts"]);
  debounce();
  expect(latest.isPending).toBe(true);
  expect(latest.entries).toEqual([]);
  expect(latest.searchTruncated).toBe(false);
  render("new", false);
  expect(latest.entries).toEqual([]);
  resolve("old", "late-old-result.ts");
  expect(latest.entries).toEqual([]);
  render("new");
  expect(latest.entries).toEqual([]);
  resolve("new", "new-result.ts");
  expect(latest.entries.map(({ path }) => path)).toEqual(["new-result.ts"]);
  render("new", false);
  expect(latest.entries.map(({ path }) => path)).toEqual(["new-result.ts"]);
  render("old", false);
  debounce();
  expect(latest.entries).toEqual([]);
  expect(latest.searchTruncated).toBe(false);
});

it.each(["cwd", "environment"] as const)(
  "does not relabel another %s's cached payload when the same query switches target",
  (changed) => {
    render("same");
    resolve("same", "old-target.ts");
    const cwd = changed === "cwd" ? "/other-workspace" : "/workspace";
    const environment = changed === "environment" ? EnvironmentId.make("other") : environmentId;
    render("same", true, cwd, environment);
    expect(latest.isPending).toBe(true);
    expect(latest.entries).toEqual([]);
    render("same", false, cwd, environment);
    expect(latest.entries).toEqual([]);
    render("same", true, cwd, environment);
    resolve("same", "current-target.ts", cwd, environment);
    expect(latest.entries.map(({ path }) => path)).toEqual(["current-target.ts"]);
  },
);
