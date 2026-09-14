import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useProjects } from "../../state/entities";
import {
  requirePullRequestHandoffDraftsLoaded,
  writePullRequestHandoffDraft,
} from "./pullRequestHandoff";

/**
 * Opens the existing new-task sheet with the hand-off prompt already in the
 * composer, so the reader can pick a model before anything is sent. The pull
 * request URL travels with the draft so Start prepares that checkout.
 */
export function usePullRequestHandoff() {
  const navigation = useNavigation();
  const projects = useProjects();
  const mountedRef = useRef(true);
  const focusedRef = useRef(navigation.isFocused());
  const handoffGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusedRef.current = false;
      handoffGenerationRef.current += 1;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      handoffGenerationRef.current += 1;
      return () => {
        focusedRef.current = false;
        handoffGenerationRef.current += 1;
      };
    }, []),
  );

  const startHandoff = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly url: string;
      readonly prompt: string;
    }) => {
      const generation = handoffGenerationRef.current + 1;
      handoffGenerationRef.current = generation;
      const isActiveOwner = () =>
        mountedRef.current &&
        focusedRef.current &&
        handoffGenerationRef.current === generation &&
        navigation.isFocused();
      const project = projects.find(
        (candidate) =>
          candidate.environmentId === input.environmentId && candidate.id === input.projectId,
      );
      if (project === undefined) {
        if (isActiveOwner()) {
          Alert.alert(
            "Could not open a new task",
            "The project for this pull request is not available on this environment.",
          );
        }
        return false;
      }

      try {
        await requirePullRequestHandoffDraftsLoaded();
      } catch (error) {
        if (!isActiveOwner()) {
          return false;
        }
        console.warn("[pull-request-handoff] failed to load composer drafts", error);
        Alert.alert(
          "Could not open a new task",
          "Your saved drafts could not be loaded. Try again.",
        );
        return false;
      }
      if (!isActiveOwner()) {
        return false;
      }

      writePullRequestHandoffDraft({
        environmentId: project.environmentId,
        projectId: project.id,
        prompt: input.prompt,
        url: input.url,
      });
      handoffGenerationRef.current += 1;
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
