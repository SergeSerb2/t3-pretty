import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import type { SidebarProjectFolder } from "@t3tools/contracts/settings";

import {
  requestProjectFolderIcon,
  requestProjectFolderName,
} from "../components/sidebar/ProjectFolderNameDialog";
import {
  persistClientSettingsPatch,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdatePrimarySettings,
} from "./useSettings";
import { randomUUID } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  applyProjectRailDrop,
  assignProjectToFolder,
  createProjectFolder,
  deleteProjectFolder,
  folderSettingsEqual,
  moveProjectFolder,
  parseProjectFolderMenuAction,
  projectFolderHeaderMenuItems,
  projectFolderMenuItems,
  projectFolderSettingsHaveEntries,
  projectFolderSettingsPatch,
  renameProjectFolder,
  reorderProjectFolderTo,
  resolveProjectFolderSettings,
  selectProjectFolderSettings,
  setProjectFolderIcon,
  shouldLiftProjectFolderSettings,
  toggleProjectFolderCollapsed,
  unassignProjectFromFolder,
  type ProjectRailDropTarget,
  type SidebarProjectFolderSettings,
} from "../sidebarProjectFolders";

const EMPTY_CLIENT_FOLDER_PATCH = {
  sidebarProjectFolders: [],
  sidebarProjectFolderAssignments: {},
} as const;

export function useSidebarProjectFolders() {
  const client = useClientSettings(selectProjectFolderSettings);
  const clientHydrated = useClientSettingsHydrated();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const updateSettings = useUpdatePrimarySettings();
  const canWriteShared =
    primaryEnvironmentId !== null || environments.some(supportsSharedSettingsSync);
  const persisted = useMemo(
    () =>
      resolveProjectFolderSettings([
        ...environments.map((environment) => environment.serverConfig?.settings ?? null),
        {
          sidebarProjectFolders: client.folders,
          sidebarProjectFolderAssignments: client.assignments,
        },
      ]),
    [client, environments],
  );
  const [optimistic, setOptimistic] = useState<SidebarProjectFolderSettings | null>(null);
  const settings = optimistic ?? persisted;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const liftedKey = useRef<string | null>(null);

  useEffect(() => {
    if (optimistic !== null && folderSettingsEqual(optimistic, persisted)) {
      setOptimistic(null);
    }
  }, [optimistic, persisted]);

  useEffect(() => {
    if (!clientHydrated || !canWriteShared) return;
    const servers = environments.flatMap((environment) =>
      environment.serverConfig == null ? [] : [environment.serverConfig.settings],
    );
    if (!shouldLiftProjectFolderSettings({ client, servers })) return;
    const key = JSON.stringify(projectFolderSettingsPatch(client));
    if (liftedKey.current === key) return;
    liftedKey.current = key;
    setOptimistic(client);
    updateSettings(projectFolderSettingsPatch(client));
  }, [canWriteShared, client, clientHydrated, environments, updateSettings]);

  useEffect(() => {
    if (!clientHydrated || !projectFolderSettingsHaveEntries(client)) return;
    const serverHasFolders = environments.some((environment) => {
      const settings = environment.serverConfig?.settings;
      return (
        settings !== undefined &&
        projectFolderSettingsHaveEntries(selectProjectFolderSettings(settings))
      );
    });
    if (serverHasFolders) {
      void persistClientSettingsPatch(EMPTY_CLIENT_FOLDER_PATCH);
    }
  }, [client, clientHydrated, environments]);

  const persistFolderSettings = useCallback(
    (update: (settings: SidebarProjectFolderSettings) => SidebarProjectFolderSettings) => {
      const next = update(settingsRef.current);
      setOptimistic(next);
      const patch = projectFolderSettingsPatch(next);
      if (canWriteShared) {
        updateSettings(patch);
        void persistClientSettingsPatch(EMPTY_CLIENT_FOLDER_PATCH);
      } else {
        void persistClientSettingsPatch(patch);
      }
    },
    [canWriteShared, updateSettings],
  );

  const toggleCollapsed = useCallback(
    (folderId: string) => {
      persistFolderSettings((current) => toggleProjectFolderCollapsed(current, folderId));
    },
    [persistFolderSettings],
  );

  const applyDrop = useCallback(
    (projectKey: string, target: ProjectRailDropTarget) => {
      persistFolderSettings((current) => applyProjectRailDrop(current, projectKey, target));
    },
    [persistFolderSettings],
  );

  const reorderFolder = useCallback(
    (folderId: string, beforeFolderId: string | null) => {
      persistFolderSettings((current) => reorderProjectFolderTo(current, folderId, beforeFolderId));
    },
    [persistFolderSettings],
  );

  const menuItemsForProject = useCallback(
    (projectKey: string) => projectFolderMenuItems({ projectKey, settings }),
    [settings],
  );

  const handleAction = useCallback(
    async (id: string, projectKey?: string): Promise<boolean> => {
      const action = parseProjectFolderMenuAction(id);
      if (action === null) return false;

      switch (action.type) {
        case "new": {
          if (projectKey === undefined) return true;
          const name = await requestProjectFolderName({
            title: "New folder",
            confirmLabel: "Create",
            initialName: "",
          });
          if (name !== null) {
            persistFolderSettings((current) =>
              createProjectFolder(current, name, projectKey, randomUUID()),
            );
          }
          return true;
        }
        case "remove": {
          if (projectKey !== undefined) {
            persistFolderSettings((current) => unassignProjectFromFolder(current, projectKey));
          }
          return true;
        }
        case "move": {
          if (projectKey !== undefined) {
            persistFolderSettings((current) =>
              assignProjectToFolder(current, projectKey, action.folderId),
            );
          }
          return true;
        }
        case "toggle":
          persistFolderSettings((current) =>
            toggleProjectFolderCollapsed(current, action.folderId),
          );
          return true;
        case "rename": {
          const folder = settings.folders.find((entry) => entry.id === action.folderId);
          const name = await requestProjectFolderName({
            title: "Rename folder",
            confirmLabel: "Save",
            initialName: folder?.name ?? "",
          });
          if (name !== null) {
            persistFolderSettings((current) => renameProjectFolder(current, action.folderId, name));
          }
          return true;
        }
        case "icon": {
          const folder = settings.folders.find((entry) => entry.id === action.folderId);
          const icon = await requestProjectFolderIcon({
            folderName: folder?.name ?? "Folder",
            current: folder?.icon ?? null,
          });
          if (icon !== null) {
            persistFolderSettings((current) =>
              setProjectFolderIcon(current, action.folderId, icon),
            );
          }
          return true;
        }
        case "reset-icon":
          persistFolderSettings((current) => setProjectFolderIcon(current, action.folderId, null));
          return true;
        case "delete":
          persistFolderSettings((current) => deleteProjectFolder(current, action.folderId));
          return true;
        case "move-up":
          persistFolderSettings((current) => moveProjectFolder(current, action.folderId, -1));
          return true;
        case "move-down":
          persistFolderSettings((current) => moveProjectFolder(current, action.folderId, 1));
          return true;
      }
    },
    [persistFolderSettings, settings.folders],
  );

  const onFolderContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, folder: SidebarProjectFolder) => {
      event.preventDefault();
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(projectFolderHeaderMenuItems({ folder, settings }), {
            x: event.clientX,
            y: event.clientY,
          }),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        await handleAction(clicked.value);
      })();
    },
    [handleAction, settings],
  );

  return useMemo(
    () => ({
      settings,
      toggleCollapsed,
      applyDrop,
      reorderFolder,
      menuItemsForProject,
      handleAction,
      onFolderContextMenu,
    }),
    [
      applyDrop,
      handleAction,
      menuItemsForProject,
      onFolderContextMenu,
      reorderFolder,
      settings,
      toggleCollapsed,
    ],
  );
}
