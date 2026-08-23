import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListState,
} from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProjects, useServerConfigs } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import { useHomeListOptions } from "../home/home-list-options";
import { PullRequestsScreen, type PullRequestListEnvironment } from "./PullRequestsScreen";
import {
  canCommitPullRequestListRestore,
  nextPullRequestEnvironmentId,
  readPersistedPullRequestListFilters,
  restorePullRequestListFilters,
  writePersistedPullRequestListFilters,
} from "./pullRequestListFiltersPersistence";
import { usePullRequestList } from "./usePullRequestList";

export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const { environments: workspaceEnvironments } = useWorkspaceState();
  const savedFilters = useRef(readPersistedPullRequestListFilters()).current;
  const [searchQuery, setSearchQuery] = useState("");
  const [involvement, setInvolvement] = useState<PullRequestInvolvement>(savedFilters.involvement);
  const [state, setState] = useState<PullRequestListState>(savedFilters.state);
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | undefined>(
    savedFilters.projectId,
  );
  const [selectedHost, setSelectedHost] = useState<string | undefined>(savedFilters.host);

  const environments = useMemo<ReadonlyArray<PullRequestListEnvironment>>(
    () =>
      Arr.sort(
        Object.values(savedConnectionsById).map((connection) => ({
          environmentId: connection.environmentId,
          label: connection.environmentLabel,
          supported:
            serverConfigs.get(connection.environmentId)?.environment.capabilities.pullRequests ===
            true,
        })),
        Order.mapInput(Order.String, (environment: PullRequestListEnvironment) =>
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
    if (!scopeRestored) {
      // Empty can still be a hydrate flash; wait for a real list before committing.
      if (savedFilters.environmentId !== null && environments.length === 0) return;
      const restored = restorePullRequestListFilters(
        savedFilters,
        preferredEnvironmentId,
        environments,
      );
      setSelectedEnvironmentId(restored.environmentId);
      setSelectedProjectId(restored.projectId);
      setSelectedHost(restored.host);
      // A non-empty partial list can still omit the saved server; do not lock or persist that.
      if (canCommitPullRequestListRestore(savedFilters, environments)) {
        setScopeRestored(true);
      }
      return;
    }
    const next = nextPullRequestEnvironmentId(
      selectedEnvironmentId,
      preferredEnvironmentId,
      environments,
    );
    if (next !== selectedEnvironmentId) {
      setSelectedEnvironmentId(next);
      setSelectedProjectId(undefined);
      setSelectedHost(undefined);
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
    writePersistedPullRequestListFilters({
      involvement,
      state,
      environmentId: selectedEnvironmentId,
      projectId: selectedProjectId,
      host: selectedHost,
    });
  }, [involvement, scopeRestored, selectedEnvironmentId, selectedHost, selectedProjectId, state]);

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
  const list = usePullRequestList({
    environmentId: selectedEnvironmentId,
    supported,
    involvement,
    state,
    projectId: selectedProjectId,
    host: selectedHost,
    query: searchQuery,
    projects: scopedProjects,
    projectsKnown: selectedEnvironmentId !== null,
  });
  const skipFocusRefresh = useRef(true);
  const refreshQueriesRef = useRef(list.refreshQueries);
  refreshQueriesRef.current = list.refreshQueries;
  useFocusEffect(
    useCallback(() => {
      if (skipFocusRefresh.current) {
        skipFocusRefresh.current = false;
        return;
      }
      refreshQueriesRef.current();
    }, []),
  );

  return (
    <PullRequestsScreen
      canLoadMore={list.canLoadMore}
      capabilityKnown={capabilityKnown}
      environments={environments}
      error={list.error}
      firstLoad={list.firstLoad}
      projectErrors={list.errors}
      groups={list.groups}
      hasProjects={scopedProjects.length > 0}
      hosts={list.providers}
      involvement={involvement}
      loadingMore={list.loadingMore}
      onAddProject={() =>
        navigation.navigate("NewTaskSheet", {
          screen: "AddProject",
        })
      }
      onEnvironmentChange={(environmentId) => {
        setScopeRestored(true);
        setSelectedEnvironmentId(environmentId);
        setSelectedProjectId(undefined);
        setSelectedHost(undefined);
      }}
      onHostChange={(host) => {
        setScopeRestored(true);
        setSelectedHost(host);
      }}
      onInvolvementChange={setInvolvement}
      onLoadMore={list.loadMore}
      onProjectChange={(projectId) => {
        setScopeRestored(true);
        setSelectedProjectId(projectId);
      }}
      onRefresh={() => void list.refreshFromHost()}
      onSearchQueryChange={setSearchQuery}
      onSelect={(entry) => {
        if (selectedEnvironmentId === null) return;
        navigation.navigate("PullRequestDetail", {
          environmentId: String(selectedEnvironmentId),
          projectId: String(entry.projectId),
          repository: entry.repository,
          number: String(entry.number),
        });
      }}
      onStateChange={setState}
      onClearFilters={() => {
        setScopeRestored(true);
        setInvolvement("all");
        setState("open");
        setSelectedEnvironmentId(
          nextPullRequestEnvironmentId(null, preferredEnvironmentId, environments),
        );
        setSelectedProjectId(undefined);
        setSelectedHost(undefined);
      }}
      projects={scopedProjects}
      querySettled={list.querySettled}
      refreshing={list.refreshing}
      searchQuery={searchQuery}
      preferredEnvironmentId={preferredEnvironmentId}
      selectedEnvironmentId={selectedEnvironmentId}
      selectedHost={selectedHost}
      selectedProjectId={selectedProjectId}
      state={state}
      supported={supported}
    />
  );
}
