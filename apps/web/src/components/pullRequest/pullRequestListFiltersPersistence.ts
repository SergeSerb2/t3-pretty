import {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

export const PULL_REQUEST_LIST_FILTERS_STORAGE_KEY = "t3code:pull-request-list-filters:v1";

const LIST_FILTER_KEYS = [
  "involvement",
  "state",
  "environmentId",
  "projectId",
  "host",
  "draft",
  "review",
  "checks",
] as const;

const SELECTION_KEYS = [
  "repository",
  "number",
  "selectedProjectId",
  "selectedEnvironmentId",
] as const;

const PersistedPullRequestListFilters = Schema.Struct({
  involvement: PullRequestInvolvement,
  state: PullRequestListState,
  environmentId: Schema.optional(EnvironmentId),
  projectId: Schema.optional(ProjectId),
  host: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Literals(["only", "hide"])),
  review: Schema.optional(
    Schema.Literals(["approved", "changes-requested", "review-required", "none"]),
  ),
  checks: Schema.optional(Schema.Literals(["passing", "failing"])),
});

export interface PersistedPullRequestListFilters {
  readonly involvement: PullRequestInvolvement;
  readonly state: PullRequestListState;
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly host?: string;
  readonly draft?: NonNullable<PullRequestListFilters["draft"]>;
  readonly review?: NonNullable<PullRequestListFilters["review"]>;
  readonly checks?: NonNullable<PullRequestListFilters["checks"]>;
}

export const DEFAULT_PULL_REQUEST_LIST_FILTERS: PersistedPullRequestListFilters = {
  involvement: "all",
  state: "open",
};

export const CLEARED_PULL_REQUEST_LIST_SEARCH = {
  involvement: "all",
  state: "open",
  environmentId: undefined,
  projectId: undefined,
  host: undefined,
  draft: undefined,
  review: undefined,
  checks: undefined,
} as const;

export function persistedFiltersFromSearch(search: {
  readonly involvement?: PullRequestInvolvement | undefined;
  readonly state?: PullRequestListState | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly host?: string | undefined;
  readonly draft?: NonNullable<PullRequestListFilters["draft"]> | undefined;
  readonly review?: NonNullable<PullRequestListFilters["review"]> | undefined;
  readonly checks?: NonNullable<PullRequestListFilters["checks"]> | undefined;
}): PersistedPullRequestListFilters {
  return {
    involvement: search.involvement ?? "all",
    state: search.state ?? "open",
    ...(search.environmentId ? { environmentId: search.environmentId } : {}),
    ...(search.projectId ? { projectId: search.projectId } : {}),
    ...(search.host ? { host: search.host } : {}),
    ...(search.draft ? { draft: search.draft } : {}),
    ...(search.review ? { review: search.review } : {}),
    ...(search.checks ? { checks: search.checks } : {}),
  };
}

export function searchFromPersistedFilters(
  filters: PersistedPullRequestListFilters,
): PersistedPullRequestListFilters {
  return persistedFiltersFromSearch(filters);
}

export function shouldRestorePersistedListFilters(raw: Record<string, unknown>): boolean {
  return [...LIST_FILTER_KEYS, ...SELECTION_KEYS].every((key) => raw[key] === undefined);
}

/** Persist when the URL named a list filter, not a selection-only or empty link. */
export function shouldPersistPullRequestListFiltersFromUrl(raw: Record<string, unknown>): boolean {
  return LIST_FILTER_KEYS.some((key) => raw[key] !== undefined);
}

export function readPersistedPullRequestListFilters(): PersistedPullRequestListFilters {
  try {
    const stored = getLocalStorageItem(
      PULL_REQUEST_LIST_FILTERS_STORAGE_KEY,
      PersistedPullRequestListFilters,
    );
    return stored ? persistedFiltersFromSearch(stored) : DEFAULT_PULL_REQUEST_LIST_FILTERS;
  } catch (error) {
    console.error("Could not read pull-request list filters.", error);
    return DEFAULT_PULL_REQUEST_LIST_FILTERS;
  }
}

export function writePersistedPullRequestListFilters(
  filters: PersistedPullRequestListFilters,
): void {
  try {
    setLocalStorageItem(
      PULL_REQUEST_LIST_FILTERS_STORAGE_KEY,
      persistedFiltersFromSearch(filters),
      PersistedPullRequestListFilters,
    );
  } catch (error) {
    console.error("Could not persist pull-request list filters.", error);
  }
}

export function persistedPullRequestListSearch(): PersistedPullRequestListFilters {
  return searchFromPersistedFilters(readPersistedPullRequestListFilters());
}
