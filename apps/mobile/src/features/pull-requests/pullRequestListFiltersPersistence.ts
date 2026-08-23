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

/** Keep restored project/host only when the saved environment is still connected. */
export function shouldKeepRestoredPullRequestScope(
  restoredEnvironmentId: EnvironmentId | null,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
): boolean {
  return (
    restoredEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === restoredEnvironmentId)
  );
}
