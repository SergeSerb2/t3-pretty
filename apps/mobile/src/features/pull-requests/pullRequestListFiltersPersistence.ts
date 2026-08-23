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
 * Wait only while a named save could still arrive (empty list). A non-empty list has settled:
 * keep the saved id if it is there, otherwise commit the preferred fallback.
 */
export function canCommitPullRequestListRestore(
  saved: PersistedPullRequestListFilters,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
): boolean {
  return saved.environmentId === null || environments.length > 0;
}

/**
 * After the environment list has settled: keep project/host only when the saved server is still
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
