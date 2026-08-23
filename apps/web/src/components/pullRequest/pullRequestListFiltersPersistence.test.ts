import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  DEFAULT_PULL_REQUEST_LIST_FILTERS,
  PULL_REQUEST_LIST_FILTERS_STORAGE_KEY,
  persistedFiltersFromSearch,
  persistedPullRequestListSearch,
  readPersistedPullRequestListFilters,
  shouldRestorePersistedListFilters,
  writePersistedPullRequestListFilters,
} from "./pullRequestListFiltersPersistence";

afterEach(() => {
  removeLocalStorageItem(PULL_REQUEST_LIST_FILTERS_STORAGE_KEY);
});

describe("persisted pull request list filters", () => {
  it("drops cleared fields rather than keeping them as undefined", () => {
    expect(
      persistedFiltersFromSearch({
        involvement: "authored",
        state: "closed",
        environmentId: undefined,
        projectId: "project-1" as ProjectId,
        host: undefined,
        draft: "hide",
        review: undefined,
        checks: undefined,
      }),
    ).toEqual({
      involvement: "authored",
      state: "closed",
      projectId: "project-1",
      draft: "hide",
    });
  });

  it("restores only when the URL did not name a list or a selection", () => {
    expect(shouldRestorePersistedListFilters({})).toBe(true);
    expect(shouldRestorePersistedListFilters({ q: "fix" })).toBe(true);
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ draft: "hide" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ repository: "acme/web", number: 12 })).toBe(false);
  });

  it("round-trips the last chosen filters and falls back to the defaults", () => {
    expect(readPersistedPullRequestListFilters()).toEqual(DEFAULT_PULL_REQUEST_LIST_FILTERS);

    writePersistedPullRequestListFilters({
      involvement: "reviewing",
      state: "all",
      environmentId: "env-1" as EnvironmentId,
      host: "github.com",
      review: "approved",
    });

    expect(persistedPullRequestListSearch()).toEqual({
      involvement: "reviewing",
      state: "all",
      environmentId: "env-1",
      host: "github.com",
      review: "approved",
    });

    writePersistedPullRequestListFilters(DEFAULT_PULL_REQUEST_LIST_FILTERS);
    expect(readPersistedPullRequestListFilters()).toEqual(DEFAULT_PULL_REQUEST_LIST_FILTERS);
  });
});
