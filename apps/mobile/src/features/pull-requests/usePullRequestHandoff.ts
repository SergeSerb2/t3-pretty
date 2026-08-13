import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useProjects } from "../../state/entities";
import { writePullRequestHandoffDraft } from "./pullRequestHandoff";

/**
 * Opens the existing new-task sheet with the hand-off prompt already in the
 * composer, so the reader can pick a model before anything is sent. The pull
 * request URL travels with the draft so Start prepares that checkout.
 */
export function usePullRequestHandoff() {
  const navigation = useNavigation();
  const projects = useProjects();

  const startHandoff = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly url: string;
      readonly prompt: string;
    }) => {
      const project = projects.find(
        (candidate) =>
          candidate.environmentId === input.environmentId && candidate.id === input.projectId,
      );
      if (project === undefined) {
        Alert.alert(
          "Could not open a new task",
          "The project for this pull request is not available on this environment.",
        );
        return false;
      }

      await writePullRequestHandoffDraft({
        environmentId: project.environmentId,
        projectId: project.id,
        prompt: input.prompt,
        url: input.url,
      });
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(project.environmentId),
          projectId: String(project.id),
          title: project.title,
        },
      });
      return true;
    },
    [navigation, projects],
  );

  return { startHandoff };
}
