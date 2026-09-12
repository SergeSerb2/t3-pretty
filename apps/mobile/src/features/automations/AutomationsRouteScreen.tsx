import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useAllThreadShells,
  useAutomations,
  useProjects,
  useServerConfigs,
} from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import { useHomeListOptions } from "../home/home-list-options";
import { automationDetailRouteParams } from "./automationNavigation";
import { resolveAutomationEnvironmentId } from "./automations.logic";
import {
  AutomationsScreen,
  type AutomationListEntry,
  type AutomationListEnvironment,
} from "./AutomationsScreen";

interface PersistedAutomationFilters {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | undefined;
}

// ponytail: process memory like the pull-request list; disk only if leaving and
// killing the app between visits starts to matter.
let persistedFilters: PersistedAutomationFilters = { environmentId: null, projectId: undefined };

export function AutomationsRouteScreen() {
  const navigation = useNavigation();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const threads = useAllThreadShells();
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const { environments: workspaceEnvironments } = useWorkspaceState();
  const savedFilters = useRef(persistedFilters).current;
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | undefined>(
    savedFilters.projectId,
  );

  const environments = useMemo<ReadonlyArray<AutomationListEnvironment>>(
    () =>
      Arr.sort(
        Object.values(savedConnectionsById).map((connection) => ({
          environmentId: connection.environmentId,
          label: connection.environmentLabel,
          supported:
            serverConfigs.get(connection.environmentId)?.environment.capabilities.automations ===
            true,
        })),
        Order.mapInput(Order.String, (environment: AutomationListEnvironment) =>
          environment.label.toLocaleLowerCase(),
        ),
      ),
    [savedConnectionsById, serverConfigs],
  );
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const { options } = useHomeListOptions(availableEnvironmentIds);
  const capable = useMemo(
    () => environments.filter((environment) => environment.supported),
    [environments],
  );
  const connectedCapable = useMemo(() => {
    const connected = new Set(
      workspaceEnvironments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    );
    return capable.filter((environment) => connected.has(environment.environmentId));
  }, [capable, workspaceEnvironments]);
  const preferredEnvironmentId =
    options.selectedEnvironmentId !== null &&
    capable.some((environment) => environment.environmentId === options.selectedEnvironmentId)
      ? options.selectedEnvironmentId
      : (connectedCapable[0]?.environmentId ?? capable[0]?.environmentId ?? null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    savedFilters.environmentId ?? preferredEnvironmentId,
  );
  const [scopeRestored, setScopeRestored] = useState(false);

  useEffect(() => {
    if (isLoadingSavedConnection) return;
    const next = resolveAutomationEnvironmentId(
      scopeRestored ? selectedEnvironmentId : savedFilters.environmentId,
      preferredEnvironmentId,
      environments,
    );
    if (!scopeRestored) {
      setSelectedEnvironmentId(next);
      // Project scope only survives when its environment did.
      setSelectedProjectId(
        next === savedFilters.environmentId ? savedFilters.projectId : undefined,
      );
      setScopeRestored(true);
      return;
    }
    if (next !== selectedEnvironmentId) {
      setSelectedEnvironmentId(next);
      setSelectedProjectId(undefined);
    }
  }, [
    environments,
    isLoadingSavedConnection,
    preferredEnvironmentId,
    savedFilters,
    scopeRestored,
    selectedEnvironmentId,
  ]);
  useEffect(() => {
    if (!scopeRestored) return;
    persistedFilters = { environmentId: selectedEnvironmentId, projectId: selectedProjectId };
  }, [scopeRestored, selectedEnvironmentId, selectedProjectId]);

  // A countdown that ticks once a minute, bound to focus so a covered screen
  // stops the clock (freezeOnBlur suspends rendering but not timers).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
      const id = setInterval(() => setNowMs(Date.now()), 60_000);
      return () => clearInterval(id);
    }, []),
  );

  const selected = environments.find(
    (environment) => environment.environmentId === selectedEnvironmentId,
  );
  const capabilityKnown =
    selectedEnvironmentId === null || serverConfigs.has(selectedEnvironmentId);
  const supported = selected?.supported === true;
  const scopedProjects = useMemo(() => {
    const next = projects
      .filter((project) => project.environmentId === selectedEnvironmentId)
      .map((project) => ({ id: project.id, title: project.title }));
    next.sort((left, right) => left.title.localeCompare(right.title));
    return next;
  }, [projects, selectedEnvironmentId]);
  const automations = useAutomations(supported ? selectedEnvironmentId : null);
  const entries = useMemo<ReadonlyArray<AutomationListEntry>>(() => {
    const visible = automations.filter(
      (automation: EnvironmentAutomation) =>
        selectedProjectId === undefined || automation.projectId === selectedProjectId,
    );
    if (visible.length === 0) return [];
    const titles = new Map(scopedProjects.map((project) => [project.id, project.title]));
    const activeRunThreadIds = new Set(
      visible
        .map((automation) => automation.activeRun?.threadId ?? null)
        .filter((threadId): threadId is NonNullable<typeof threadId> => threadId !== null),
    );
    const runThreads =
      activeRunThreadIds.size === 0
        ? new Map<string, (typeof threads)[number]>()
        : new Map(
            threads
              .filter(
                (thread) =>
                  thread.environmentId === selectedEnvironmentId &&
                  activeRunThreadIds.has(thread.id),
              )
              .map((thread) => [String(thread.id), thread]),
          );
    return visible.map((automation) => {
      const threadId = automation.activeRun?.threadId ?? null;
      const thread = threadId === null ? undefined : runThreads.get(String(threadId));
      return {
        automation,
        projectTitle: titles.get(automation.projectId) ?? "Unknown project",
        activeRunThread:
          thread === undefined
            ? null
            : {
                hasPendingApprovals: thread.hasPendingApprovals,
                hasPendingUserInput: thread.hasPendingUserInput,
              },
      };
    });
  }, [automations, scopedProjects, selectedEnvironmentId, selectedProjectId, threads]);

  return (
    <AutomationsScreen
      capabilityKnown={capabilityKnown}
      entries={entries}
      environments={environments}
      hasCustomFilter={
        selectedProjectId !== undefined || selectedEnvironmentId !== preferredEnvironmentId
      }
      nowMs={nowMs}
      onClearFilters={() => {
        setSelectedEnvironmentId(
          resolveAutomationEnvironmentId(null, preferredEnvironmentId, environments),
        );
        setSelectedProjectId(undefined);
      }}
      onEnvironmentChange={(environmentId) => {
        setSelectedEnvironmentId(environmentId);
        setSelectedProjectId(undefined);
      }}
      onProjectChange={setSelectedProjectId}
      onSelect={(entry) =>
        navigation.navigate(
          "AutomationDetail",
          automationDetailRouteParams({
            environmentId: entry.automation.environmentId,
            automationId: entry.automation.id,
          }),
        )
      }
      projects={scopedProjects}
      selectedEnvironmentId={selectedEnvironmentId}
      selectedProjectId={selectedProjectId}
      supported={supported}
    />
  );
}
