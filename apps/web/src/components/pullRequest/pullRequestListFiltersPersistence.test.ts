import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  DEFAULT_PULL_REQUEST_LIST_FILTERS,
  PULL_REQUEST_LIST_FILTERS_STORAGE_KEY,
  persistedFiltersFromSearch,
  persistedPullRequestListSearch,
  readPersistedPullRequestListFilters,
  restoredListSearchToReplaceUrl,
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

  it("restores unless the URL named an off-default list filter or a selection", () => {
    expect(shouldRestorePersistedListFilters({})).toBe(true);
    expect(shouldRestorePersistedListFilters({ q: "fix" })).toBe(true);
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open" })).toBe(true);
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open", q: "fix" })).toBe(
      true,
    );
    expect(shouldRestorePersistedListFilters({ involvement: "authored" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ state: "closed" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ draft: "hide" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ environmentId: "env-1" })).toBe(false);
    expect(shouldRestorePersistedListFilters({ repository: "acme/web", number: 12 })).toBe(false);
  });

  it("replaces a bare URL with restored list params, not defaults or an already-named URL", () => {
    const restored = {
      involvement: "authored" as const,
      state: "closed" as const,
      environmentId: "env-1" as EnvironmentId,
      host: "github.com",
    };
    expect(restoredListSearchToReplaceUrl({}, restored)).toEqual(restored);
    expect(restoredListSearchToReplaceUrl({ involvement: "all", state: "open" }, restored)).toEqual(
      restored,
    );
    expect(restoredListSearchToReplaceUrl({ q: "fix" }, restored)).toEqual(restored);
    expect(restoredListSearchToReplaceUrl({ involvement: "reviewing" }, restored)).toBe(null);
    expect(restoredListSearchToReplaceUrl({ repository: "acme/web" }, restored)).toBe(null);
    expect(restoredListSearchToReplaceUrl({}, DEFAULT_PULL_REQUEST_LIST_FILTERS)).toBe(null);
  });

  it("does not treat a default-named URL as a write of the defaults", () => {
    writePersistedPullRequestListFilters({ involvement: "authored", state: "closed" });
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open" })).toBe(true);
    expect(readPersistedPullRequestListFilters()).toEqual({
      involvement: "authored",
      state: "closed",
    });
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
