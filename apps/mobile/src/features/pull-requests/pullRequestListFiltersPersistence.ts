import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListState,
} from "@t3tools/contracts";

export interface PersistedPullRequestListFilters {
  readonly involvement: PullRequestInvolvement;
  readonly state: PullRequestListState;
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | undefined;
  readonly host: string | undefined;
}

export const DEFAULT_PULL_REQUEST_LIST_FILTERS: PersistedPullRequestListFilters = {
  involvement: "all",
  state: "open",
  environmentId: null,
  projectId: undefined,
  host: undefined,
};

// ponytail: process memory, disk if leaving-and-killing the app starts to matter
let persisted: PersistedPullRequestListFilters = DEFAULT_PULL_REQUEST_LIST_FILTERS;

export function readPersistedPullRequestListFilters(): PersistedPullRequestListFilters {
  return persisted;
}

export function writePersistedPullRequestListFilters(
  filters: PersistedPullRequestListFilters,
): void {
  persisted = filters;
}

/** Fall back when the selected server is missing. An empty list yields `preferred`. */
export function nextPullRequestEnvironmentId(
  selectedEnvironmentId: EnvironmentId | null,
  preferredEnvironmentId: EnvironmentId | null,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
): EnvironmentId | null {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  return preferredEnvironmentId;
}

/**
 * A named save on an empty list can still be a hydrate flash. Retry restore only when the
 * saved server itself appears; a different server is not the save coming in.
 */
export function shouldRetryPullRequestListRestore(
  savedEnvironmentId: EnvironmentId | null,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  awaitingEmptyNamedSave: boolean,
): boolean {
  return (
    awaitingEmptyNamedSave &&
    savedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === savedEnvironmentId)
  );
}

/**
 * After saved connections have settled: keep project/host only when the saved server is still
 * present. A missing server (including an empty list) falls back to `preferred` without them.
 */
export function restorePullRequestListFilters(
  saved: PersistedPullRequestListFilters,
  preferredEnvironmentId: EnvironmentId | null,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
): Pick<PersistedPullRequestListFilters, "environmentId" | "projectId" | "host"> {
  const environmentId = nextPullRequestEnvironmentId(
    saved.environmentId,
    preferredEnvironmentId,
    environments,
  );
  const keepScope = saved.environmentId !== null && environmentId === saved.environmentId;
  return {
    environmentId,
    projectId: keepScope ? saved.projectId : undefined,
    host: keepScope ? saved.host : undefined,
  };
}
