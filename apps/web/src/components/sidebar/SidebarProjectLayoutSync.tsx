import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { compareSidebarProjectLayouts } from "@t3tools/shared/sidebarProjectLayout";
import { useEffect, useRef } from "react";

import { useSidebarProjectLayout } from "../../hooks/useSidebarProjectLayout";
import {
  persistClientSettingsPatch,
  useClientSettings,
  useClientSettingsHydrated,
} from "../../hooks/useSettings";
import { projectFolderSettingsHaveEntries } from "../../sidebarProjectFolders";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

/** One reconciler per renderer repairs replicas after reconnect, including the offline cache. */
export function SidebarProjectLayoutSync() {
  const { layout, folders, projectOrder } = useSidebarProjectLayout();
  const clientLayout = useClientSettings((settings) => settings.sidebarProjectLayout);
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const groupingMode = useClientSettings((settings) => settings.sidebarProjectGroupingMode);
  const groupingOverrides = useClientSettings(
    (settings) => settings.sidebarProjectGroupingOverrides,
  );
  const hydrated = useClientSettingsHydrated();
  const { environments } = useEnvironments();
  const writable = useEnvironmentsWithScope(environments, AuthSettingsWriteScope);
  const persist = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const sent = useRef(new Map<EnvironmentId, string>());

  useEffect(() => {
    if (!hydrated) return;
    if (!layout) {
      if (projectFolderSettingsHaveEntries(folders) || projectOrder.length > 0) {
        // Migration is older than every real edit, even when a remote has not connected yet.
        void persistClientSettingsPatch({
          sidebarProjectLayout: {
            ...folders,
            projectOrder,
            sortOrder,
            groupingMode,
            groupingOverrides,
            version: 1,
          },
        });
      }
      return;
    }
    if (
      !clientLayout ||
      compareSidebarProjectLayouts(layout, clientLayout) > 0 ||
      (layout.sortOrder !== undefined && layout.sortOrder !== sortOrder) ||
      (layout.groupingMode !== undefined && layout.groupingMode !== groupingMode) ||
      (layout.groupingOverrides !== undefined &&
        JSON.stringify(layout.groupingOverrides) !== JSON.stringify(groupingOverrides))
    ) {
      void persistClientSettingsPatch({
        sidebarProjectLayout: layout,
        sidebarProjectFolders: layout.folders,
        sidebarProjectFolderAssignments: layout.assignments,
        ...(layout.sortOrder === undefined ? {} : { sidebarProjectSortOrder: layout.sortOrder }),
        ...(layout.groupingMode === undefined
          ? {}
          : { sidebarProjectGroupingMode: layout.groupingMode }),
        ...(layout.groupingOverrides === undefined
          ? {}
          : { sidebarProjectGroupingOverrides: layout.groupingOverrides }),
      });
    }
    const connected = new Set(
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    );
    for (const id of sent.current.keys()) {
      if (!connected.has(id)) sent.current.delete(id);
    }
    const key = JSON.stringify(layout);
    for (const environment of environments) {
      if (
        environment.connection.phase !== "connected" ||
        environment.serverConfig?.environment.capabilities.sidebarProjectLayout !== true ||
        !writable.has(environment.environmentId)
      )
        continue;
      const current = environment.serverConfig.settings.sidebarProjectLayout;
      if (current && compareSidebarProjectLayouts(current, layout) >= 0) {
        sent.current.delete(environment.environmentId);
        continue;
      }
      if (sent.current.get(environment.environmentId) === key) continue;
      sent.current.set(environment.environmentId, key);
      void persist({
        environmentId: environment.environmentId,
        input: { patch: { sidebarProjectLayout: layout } },
      }).then((result) => {
        if (result._tag !== "Success" && sent.current.get(environment.environmentId) === key) {
          sent.current.delete(environment.environmentId);
        }
      });
    }
  }, [
    clientLayout,
    environments,
    folders,
    hydrated,
    layout,
    persist,
    projectOrder,
    sortOrder,
    groupingMode,
    groupingOverrides,
    writable,
  ]);
  return null;
}
