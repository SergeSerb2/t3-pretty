import type { SidebarProjectLayout } from "@t3tools/contracts/settings";
import {
  canonicalizeSidebarProjectLayout,
  mergeSidebarProjectOrder,
  nextSidebarProjectLayout,
  resolveSidebarProjectLayout,
} from "@t3tools/shared/sidebarProjectLayout";
import { useCallback, useMemo, useRef } from "react";

import {
  resolveProjectFolderSettings,
  projectFolderSettingsHaveEntries,
  type SidebarProjectFolderSettings,
} from "../sidebarProjectFolders";
import { deriveLogicalProjectKeyFromSettings, getProjectOrderKey } from "../logicalProject";
import { useEnvironments } from "../state/environments";
import { useProjects } from "../state/entities";
import { legacyProjectCwdPreferenceKey, reorderProjects, useUiStateStore } from "../uiStateStore";
import { getClientSettings, persistClientSettingsPatch, useClientSettings } from "./useSettings";

/** Read every replica, including the local cache used while a machine is offline. */
export function useSidebarProjectLayout() {
  const client = useClientSettings();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const localOrder = useUiStateStore((store) => store.projectOrder);
  const persisted = useMemo(
    () =>
      resolveSidebarProjectLayout([
        client.sidebarProjectLayout,
        ...environments.map(
          (environment) => environment.serverConfig?.settings.sidebarProjectLayout,
        ),
      ]),
    [client.sidebarProjectLayout, environments],
  );
  const aliases = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const project of projects) {
      const key = deriveLogicalProjectKeyFromSettings(
        project,
        {
          sidebarProjectGroupingMode: persisted?.groupingMode ?? client.sidebarProjectGroupingMode,
          sidebarProjectGroupingOverrides:
            persisted?.groupingOverrides ?? client.sidebarProjectGroupingOverrides,
        },
        { groupScratchProjects: true },
      );
      mapping.set(getProjectOrderKey(project), key);
      const legacy = legacyProjectCwdPreferenceKey(project.workspaceRoot);
      const existing = mapping.get(legacy);
      if (existing === undefined || key < existing) mapping.set(legacy, key);
    }
    return mapping;
  }, [
    client.sidebarProjectGroupingMode,
    client.sidebarProjectGroupingOverrides,
    persisted?.groupingMode,
    persisted?.groupingOverrides,
    projects,
  ]);
  const layout = useMemo(() => {
    if (!persisted) return null;
    const canonical = canonicalizeSidebarProjectLayout(persisted, aliases);
    return canonical === persisted ? persisted : { ...canonical, version: persisted.version + 1 };
  }, [aliases, persisted]);
  const folders = useMemo(() => {
    if (layout) return { folders: layout.folders, assignments: layout.assignments };
    const servers = resolveProjectFolderSettings(
      environments.map((environment) => environment.serverConfig?.settings),
    );
    const legacy = projectFolderSettingsHaveEntries(servers)
      ? servers
      : resolveProjectFolderSettings([client]);
    const canonical = canonicalizeSidebarProjectLayout(
      { ...legacy, projectOrder: [], version: 1 },
      aliases,
    );
    return { folders: canonical.folders, assignments: canonical.assignments };
  }, [aliases, client, environments, layout]);
  const projectOrder = useMemo(
    () =>
      layout?.projectOrder ??
      canonicalizeSidebarProjectLayout(
        {
          version: 1,
          ...folders,
          projectOrder: localOrder,
        },
        aliases,
      ).projectOrder,
    [aliases, folders, layout, localOrder],
  );
  const latest = useRef(layout);

  const save = useCallback(
    (
      update: (
        current: Omit<SidebarProjectLayout, "version">,
      ) => Omit<SidebarProjectLayout, "version">,
    ) => {
      const current = resolveSidebarProjectLayout([
        layout,
        latest.current,
        getClientSettings().sidebarProjectLayout,
      ]);
      const base = current
        ? canonicalizeSidebarProjectLayout(current, aliases)
        : { ...folders, projectOrder };
      const content = update(base);
      if (content === base) return;
      const next = nextSidebarProjectLayout(
        current,
        {
          ...content,
          sortOrder: content.sortOrder ?? client.sidebarProjectSortOrder,
          groupingMode: content.groupingMode ?? client.sidebarProjectGroupingMode,
          groupingOverrides: content.groupingOverrides ?? client.sidebarProjectGroupingOverrides,
        },
        Date.now(),
      );
      latest.current = next;
      void persistClientSettingsPatch({
        sidebarProjectLayout: next,
        sidebarProjectFolders: next.folders,
        sidebarProjectFolderAssignments: next.assignments,
      });
    },
    [
      aliases,
      client.sidebarProjectSortOrder,
      client.sidebarProjectGroupingMode,
      client.sidebarProjectGroupingOverrides,
      folders,
      layout,
      projectOrder,
    ],
  );

  const saveFolders = useCallback(
    (update: (settings: SidebarProjectFolderSettings) => SidebarProjectFolderSettings) => {
      save((current) => {
        const next = update({ folders: current.folders, assignments: current.assignments });
        return next.folders === current.folders && next.assignments === current.assignments
          ? current
          : { ...current, ...next };
      });
    },
    [save],
  );
  const reorder = useCallback(
    (visible: readonly string[], dragged: readonly string[], target: readonly string[]) => {
      const state = useUiStateStore.getState();
      const reordered = reorderProjects(state, visible, dragged, target);
      if (reordered === state) return;
      save((current) => ({
        ...current,
        projectOrder: mergeSidebarProjectOrder(current.projectOrder, reordered.projectOrder),
      }));
    },
    [save],
  );
  return { layout, folders, projectOrder, saveFolders, reorderProjects: reorder };
}
