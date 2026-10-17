import { useMemo } from "react";

import { orderItemsByPreferredIds, sortSidebarV2ProjectGroups } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { legacyProjectCwdPreferenceKey } from "../uiStateStore";
import { useClientSettings } from "./useSettings";
import { useSidebarProjectLayout } from "./useSidebarProjectLayout";

/** The sidebar's project groups, in the order the sidebar shows them. */
export function useSidebarProjectGroups() {
  const projects = useProjects();
  const threads = useThreadShells();
  const { projectOrder } = useSidebarProjectLayout();
  const sortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const environments = useEnvironmentIdentities();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          deriveLogicalProjectKeyFromSettings(project, groupingSettings, {
            groupScratchProjects: true,
          }),
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [groupingSettings, projectOrder, projects],
  );
  const unsortedGroups = useMemo(() => {
    const labels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    return buildSidebarProjectSnapshots({
      projects: sortOrder === "manual" ? orderedProjects : projects,
      groupScratchProjects: true,
      settings: groupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => labels.get(environmentId) ?? null,
    });
  }, [environments, groupingSettings, orderedProjects, primaryEnvironmentId, projects, sortOrder]);
  return useMemo(
    () => sortSidebarV2ProjectGroups(unsortedGroups, threads, sortOrder),
    [sortOrder, threads, unsortedGroups],
  );
}
