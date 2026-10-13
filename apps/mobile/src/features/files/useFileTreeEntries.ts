import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";

export function useFileTreeEntries(input: {
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly searchQuery: string;
  readonly enabled?: boolean;
}) {
  const { cwd, environmentId } = input;
  const enabled = input.enabled ?? true;
  const searching = input.searchQuery.trim().length > 0;
  const query = input.searchQuery.trim().slice(0, 256);
  const debouncedQuery = useDebouncedValue(query, 200);
  const root = useEnvironmentQuery(
    enabled && cwd !== null && environmentId !== null
      ? projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath: "" } })
      : null,
  );
  const search = useEnvironmentQuery(
    enabled && searching && debouncedQuery.length > 0 && cwd !== null && environmentId !== null
      ? projectEnvironment.searchEntries({
          environmentId,
          input: { cwd, query: debouncedQuery, limit: 200 },
        })
      : null,
  );
  const retainedData = useMemo(
    () => ({
      cwd,
      environmentId,
      root: new Map<"root", NonNullable<typeof root.data>>(),
      search: new Map<string, NonNullable<typeof search.data>>(),
    }),
    [cwd, environmentId],
  );
  useEffect(() => {
    if (root.data !== null) retainedData.root.set("root", root.data);
    if (search.data !== null) {
      retainedData.search.clear();
      retainedData.search.set(debouncedQuery, search.data);
    }
  }, [debouncedQuery, retainedData, root.data, search.data]);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [entriesRevision, entriesChanged] = useReducer((value: number) => value + 1, 0);
  const refreshVersion = useRef(0);
  const directories = useMemo(
    () => ({
      cwd,
      environmentId,
      entries: new Map<string, ReadonlyArray<ProjectEntry>>(),
      requested: new Set<string>(),
      pending: new Map<string, AbortController>(),
      errors: new Map<string, string>(),
      interrupted: new Set<string>(),
      refreshControllers: new Set<AbortController>(),
      refreshKey: Symbol(),
    }),
    [cwd, environmentId],
  );
  const [refreshingDirectoryKey, setRefreshingDirectoryKey] = useState<symbol | null>(null);
  useEffect(() => {
    const cancel = () => {
      refreshVersion.current++;
      for (const controller of directories.refreshControllers) controller.abort();
      directories.refreshControllers.clear();
      for (const [path, controller] of directories.pending) {
        directories.interrupted.add(path);
        controller.abort();
      }
      directories.pending.clear();
    };
    if (!enabled) cancel();
    return cancel;
  }, [directories, enabled]);
  const loadDirectory = useCallback(
    (directoryPath: string, refresh = false) => {
      if (
        !enabled ||
        cwd === null ||
        environmentId === null ||
        (!refresh &&
          directories.entries.has(directoryPath) &&
          !directories.interrupted.has(directoryPath)) ||
        directories.pending.has(directoryPath)
      ) {
        return;
      }
      const controller = new AbortController();
      directories.requested.add(directoryPath);
      directories.pending.set(directoryPath, controller);
      directories.errors.delete(directoryPath);
      render();
      const atom = projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } });
      appAtomRegistry.refresh(atom);
      return executeAtomQuery(appAtomRegistry, atom, {
        signal: controller.signal,
        reportFailure: false,
        reportDefect: false,
      }).then((result) => {
        if (controller.signal.aborted) return;
        directories.pending.delete(directoryPath);
        if (result._tag === "Success") {
          directories.interrupted.delete(directoryPath);
          directories.entries.set(
            directoryPath,
            result.value.entries.filter(
              (entry) =>
                entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) === directoryPath,
            ),
          );
          entriesChanged();
        } else {
          const error = Cause.squash(result.cause);
          directories.errors.set(
            directoryPath,
            error instanceof Error ? error.message : "Files unavailable",
          );
        }
        render();
      });
    },
    [cwd, directories, enabled, environmentId],
  );
  const { refresh: refreshRoot } = root;
  const { refresh: refreshSearch } = search;
  const rootData = root.data ?? retainedData.root.get("root") ?? null;
  const searchData = search.data ?? retainedData.search.get(debouncedQuery) ?? null;
  const snapshot = useMemo(() => {
    const merged = new Map<string, ProjectEntry>();
    if (searching) {
      for (const entry of searchData?.entries ?? []) merged.set(entry.path, entry);
    }
    const reachableDirectories = new Set<string>();
    const visit = (items: ReadonlyArray<ProjectEntry>) => {
      for (const entry of items) {
        merged.set(entry.path, entry);
        if (entry.kind === "directory") {
          reachableDirectories.add(entry.path);
          visit(directories.entries.get(entry.path) ?? []);
        }
      }
    };
    visit((rootData?.entries ?? []).filter((entry) => !entry.path.includes("/")));
    return { revision: entriesRevision, entries: [...merged.values()], reachableDirectories };
  }, [directories, entriesRevision, rootData, searchData, searching]);

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    refreshRoot();
    if (searching) refreshSearch();
    const paths = new Set(
      [...directories.requested].filter((path) => snapshot.reachableDirectories.has(path)),
    );
    for (const controller of directories.refreshControllers) controller.abort();
    directories.refreshControllers.clear();
    const refreshController = new AbortController();
    directories.refreshControllers.add(refreshController);
    for (const [path, controller] of directories.pending) {
      directories.interrupted.add(path);
      controller.abort();
    }
    directories.pending.clear();
    directories.errors.clear();
    const version = ++refreshVersion.current;
    setRefreshingDirectoryKey(directories.refreshKey);
    const remaining = paths.values();
    const worker = async () => {
      while (version === refreshVersion.current) {
        const next = remaining.next();
        if (next.done) return;
        await loadDirectory(next.value, true);
      }
    };
    const queries =
      cwd !== null && environmentId !== null
        ? [
            projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath: "" } }),
            ...(searching
              ? [
                  projectEnvironment.searchEntries({
                    environmentId,
                    input: { cwd, query: debouncedQuery, limit: 200 },
                  }),
                ]
              : []),
          ]
        : [];
    const work = [
      ...queries.map((atom) =>
        executeAtomQuery(appAtomRegistry, atom, {
          signal: refreshController.signal,
          reportFailure: false,
          reportDefect: false,
        }),
      ),
      ...Array.from({ length: Math.min(4, paths.size) }, () => worker()),
    ];
    render();
    return Promise.all(work).finally(() => {
      if (version === refreshVersion.current) {
        directories.refreshControllers.delete(refreshController);
        setRefreshingDirectoryKey(null);
      }
    });
  }, [
    cwd,
    debouncedQuery,
    environmentId,
    enabled,
    directories,
    loadDirectory,
    refreshRoot,
    refreshSearch,
    searching,
    snapshot.reachableDirectories,
  ]);

  return {
    entries: snapshot.entries,
    isRefreshing:
      enabled &&
      refreshingDirectoryKey === directories.refreshKey &&
      directories.refreshControllers.size > 0,
    error:
      root.error ??
      (searching ? search.error : null) ??
      [...directories.errors].find(([path]) => snapshot.reachableDirectories.has(path))?.[1] ??
      null,
    isPending:
      enabled &&
      (root.isPending ||
        directories.pending.size > 0 ||
        (searching && (query !== debouncedQuery || search.isPending))),
    searchTruncated: searching && (searchData?.truncated ?? false),
    loadedDirectories: new Set(directories.entries.keys()),
    loadingDirectories: new Set(enabled ? directories.pending.keys() : []),
    loadDirectory,
    refresh,
  };
}
