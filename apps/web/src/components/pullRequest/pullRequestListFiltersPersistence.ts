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

function stripDefaultListFilterParams(raw: Record<string, unknown>): Record<string, unknown> {
  const next = { ...raw };
  if (next.involvement === "all") delete next.involvement;
  if (next.state === "open") delete next.state;
  return next;
}

/** Restore unless a list key is present and off-default, or a selection key is present. */
export function shouldRestorePersistedListFilters(raw: Record<string, unknown>): boolean {
  const named = stripDefaultListFilterParams(raw);
  return [...LIST_FILTER_KEYS, ...SELECTION_KEYS].every((key) => named[key] === undefined);
}

function isDefaultPersistedPullRequestListFilters(
  filters: PersistedPullRequestListFilters,
): boolean {
  return (
    filters.involvement === DEFAULT_PULL_REQUEST_LIST_FILTERS.involvement &&
    filters.state === DEFAULT_PULL_REQUEST_LIST_FILTERS.state &&
    filters.environmentId === undefined &&
    filters.projectId === undefined &&
    filters.host === undefined &&
    filters.draft === undefined &&
    filters.review === undefined &&
    filters.checks === undefined
  );
}

/**
 * List params to write over a bare/default URL after restore. Null when the URL already names
 * filters, or the restored list is itself the defaults (so `/pull-requests` already matches).
 */
export function restoredListSearchToReplaceUrl(
  raw: Record<string, unknown>,
  restored: PersistedPullRequestListFilters,
): PersistedPullRequestListFilters | null {
  if (!shouldRestorePersistedListFilters(raw)) return null;
  const search = searchFromPersistedFilters(restored);
  return isDefaultPersistedPullRequestListFilters(search) ? null : search;
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
