import { useNavigation } from "@react-navigation/native";
import { useCallback, useMemo } from "react";

import { useProjects } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { resolveNewTaskSheetRoute } from "../threads/new-task-project-selection";
import { useHomeListOptions } from "./home-list-options";
import { buildHomeProjectScopes } from "./homeThreadList";

export function useStartNewTaskFromHomeScope() {
  const navigation = useNavigation();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const availableEnvironmentIds = useMemo(
    () =>
      new Set(Object.values(savedConnectionsById).map((connection) => connection.environmentId)),
    [savedConnectionsById],
  );
  const { options } = useHomeListOptions(availableEnvironmentIds);
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: options.selectedEnvironmentId,
        projectGroupingMode: options.projectGroupingMode,
      }),
    [options.projectGroupingMode, options.selectedEnvironmentId, projects],
  );

  return useCallback(() => {
    navigation.navigate(
      "NewTaskSheet",
      resolveNewTaskSheetRoute({
        selectedProjectKey: options.selectedProjectKey,
        selectedEnvironmentId: options.selectedEnvironmentId,
        projectScopes,
      }),
    );
  }, [navigation, options.selectedEnvironmentId, options.selectedProjectKey, projectScopes]);
}
