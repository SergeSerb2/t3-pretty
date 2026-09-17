import { useCallback, useMemo } from "react";
import type { MouseEvent } from "react";

import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { SidebarProjectFolder } from "@t3tools/contracts/settings";

import { requestProjectFolderName } from "../components/sidebar/ProjectFolderNameDialog";
import { persistClientSettingsUpdate, useClientSettings } from "./useSettings";
import { randomUUID } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  applyProjectRailDrop,
  assignProjectToFolder,
  createProjectFolder,
  deleteProjectFolder,
  moveProjectFolder,
  parseProjectFolderMenuAction,
  projectFolderHeaderMenuItems,
  projectFolderMenuItems,
  renameProjectFolder,
  selectProjectFolderSettings,
  toggleProjectFolderCollapsed,
  unassignProjectFromFolder,
  type ProjectRailDropTarget,
  type SidebarProjectFolderSettings,
} from "../sidebarProjectFolders";

function persistFolderSettings(
  update: (settings: SidebarProjectFolderSettings) => SidebarProjectFolderSettings,
) {
  void persistClientSettingsUpdate((current) => {
    const next = update(selectProjectFolderSettings(current));
    return {
      ...current,
      sidebarProjectFolders: [...next.folders],
      sidebarProjectFolderAssignments: { ...next.assignments },
    };
  });
}

export function useSidebarProjectFolders() {
  const settings = useClientSettings(selectProjectFolderSettings);

  const toggleCollapsed = useCallback((folderId: string) => {
    persistFolderSettings((current) => toggleProjectFolderCollapsed(current, folderId));
  }, []);

  const applyDrop = useCallback((projectKey: string, target: ProjectRailDropTarget) => {
    persistFolderSettings((current) => applyProjectRailDrop(current, projectKey, target));
  }, []);

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
    [settings.folders],
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
      menuItemsForProject,
      handleAction,
      onFolderContextMenu,
    }),
    [applyDrop, handleAction, menuItemsForProject, onFolderContextMenu, settings, toggleCollapsed],
  );
}
