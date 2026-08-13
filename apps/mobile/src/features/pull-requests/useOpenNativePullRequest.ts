import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Alert } from "react-native";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useThreadSelection } from "../../state/use-thread-selection";
import { resolveChangeRequestRoute, resolveNativePullRequestTarget } from "./pullRequestNavigation";

/**
 * Opens a change-request URL in the native pull-request manager when a project
 * on this environment matches the host and repository. Returns false when the
 * link should stay an ordinary system-browser URL.
 */
export function useOpenChangeRequestLink(environmentId: EnvironmentId) {
  const navigation = useNavigation();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { selectedThread } = useThreadSelection();
  const fallbackProjectId =
    selectedThread?.environmentId === environmentId ? String(selectedThread.projectId) : undefined;

  return useCallback(
    (url: string): boolean => {
      const target = resolveChangeRequestRoute({
        environmentId: String(environmentId),
        url,
        pullRequestsSupported:
          serverConfigs.get(environmentId)?.environment.capabilities.pullRequests === true,
        projects,
        fallbackProjectId,
      });
      if (target === null) return false;
      navigation.navigate("PullRequestDetail", target);
      return true;
    },
    [environmentId, fallbackProjectId, navigation, projects, serverConfigs],
  );
}

/**
 * Opens the native pull-request manager when the git status already names a change
 * request this environment can read. Falls back to the system browser when it cannot.
 */
export function useOpenNativePullRequest() {
  const navigation = useNavigation();
  const serverConfigs = useServerConfigs();
  const { selectedThread, selectedThreadProject } = useThreadSelection();

  return useCallback(
    async (input: {
      readonly url: string | null | undefined;
      readonly number?: number | null;
      readonly presentation?: "sheet" | "inspector" | "card";
    }) => {
      const url = input.url?.trim() ?? "";
      if (url.length === 0) {
        Alert.alert("No open PR", "This branch does not have an open pull request.");
        return;
      }
      const environmentId = selectedThread?.environmentId;
      const projectId = selectedThread?.projectId;
      const pullRequestsSupported =
        environmentId !== undefined &&
        serverConfigs.get(environmentId)?.environment.capabilities.pullRequests === true;
      const target =
        pullRequestsSupported && environmentId !== undefined && projectId !== undefined
          ? resolveNativePullRequestTarget({
              environmentId: String(environmentId),
              projectId: String(projectId),
              url,
              number: input.number,
              repositoryIdentity: selectedThreadProject?.repositoryIdentity ?? null,
            })
          : null;
      if (target !== null) {
        if (input.presentation === "sheet") {
          navigation.dispatch(StackActions.replace("PullRequestDetail", target));
          return;
        }
        navigation.navigate("PullRequestDetail", target);
        return;
      }
      if (!(await tryOpenExternalUrl(url, "pull-request"))) {
        Alert.alert("Unable to open PR", "The pull request could not be opened.");
      }
    },
    [navigation, selectedThread, selectedThreadProject, serverConfigs],
  );
}
