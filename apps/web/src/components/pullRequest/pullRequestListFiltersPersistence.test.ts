import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  DEFAULT_PULL_REQUEST_LIST_FILTERS,
  PULL_REQUEST_LIST_FILTERS_STORAGE_KEY,
  livePullRequestListFilters,
  persistedFiltersFromSearch,
  persistedPullRequestListSearch,
  pullRequestListFiltersToPersist,
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
    expect(restoredListSearchToReplaceUrl({ q: "fix" }, restored)).toEqual({
      ...restored,
      q: "fix",
    });
    expect(restoredListSearchToReplaceUrl({ involvement: "reviewing" }, restored)).toBe(null);
    expect(restoredListSearchToReplaceUrl({ repository: "acme/web" }, restored)).toBe(null);
    expect(restoredListSearchToReplaceUrl({}, DEFAULT_PULL_REQUEST_LIST_FILTERS)).toBe(null);
  });

  it("persists validated list search except during the in-memory restore", () => {
    const restored = {
      involvement: "authored" as const,
      state: "closed" as const,
      environmentId: "env-1" as EnvironmentId,
    };
    expect(pullRequestListFiltersToPersist({}, restored, true)).toBe(null);
    expect(
      pullRequestListFiltersToPersist({ involvement: "all", state: "open" }, restored, true),
    ).toBe(null);
    expect(
      pullRequestListFiltersToPersist(
        { involvement: "reviewing" },
        { involvement: "reviewing", state: "open" },
        true,
      ),
    ).toEqual({
      involvement: "reviewing",
      state: "open",
    });
    expect(pullRequestListFiltersToPersist({}, restored, false)).toEqual(restored);
    expect(
      pullRequestListFiltersToPersist({ involvement: "all", state: "open" }, restored, false),
    ).toEqual(restored);
  });

  it("does not persist defaults from a selection-only or selected-PR URL", () => {
    expect(
      pullRequestListFiltersToPersist(
        { repository: "acme/web", number: "12" },
        { involvement: "all", state: "open" },
        false,
      ),
    ).toBe(null);
    expect(
      pullRequestListFiltersToPersist(
        {
          involvement: "all",
          state: "open",
          selectedProjectId: "project-1",
          selectedEnvironmentId: "env-1",
        },
        { involvement: "all", state: "open" },
        false,
      ),
    ).toBe(null);
    expect(
      pullRequestListFiltersToPersist(
        {
          involvement: "all",
          state: "all",
          repository: "acme/web",
          number: "12",
          selectedProjectId: "project-1",
        },
        { involvement: "all", state: "all" },
        false,
      ),
    ).toBe(null);
    expect(
      pullRequestListFiltersToPersist(
        { repository: "acme/web", involvement: "authored" },
        { involvement: "authored", state: "open" },
        false,
      ),
    ).toEqual({ involvement: "authored", state: "open" });
    writePersistedPullRequestListFilters({ involvement: "reviewing", state: "closed" });
    expect(
      pullRequestListFiltersToPersist(
        {
          repository: "acme/web",
          number: "12",
          state: "all",
          involvement: "authored",
        },
        { involvement: "authored", state: "all" },
        false,
      ),
    ).toEqual({ involvement: "authored", state: "closed" });
    expect(
      pullRequestListFiltersToPersist(
        { repository: "acme/web", state: "merged", draft: "hide" },
        { involvement: "all", state: "merged", draft: "hide" },
        false,
      ),
    ).toEqual({ involvement: "all", state: "merged", draft: "hide" });
  });

  it("does not treat a default-named URL as a write of the defaults", () => {
    writePersistedPullRequestListFilters({ involvement: "authored", state: "closed" });
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open" })).toBe(true);
    expect(readPersistedPullRequestListFilters()).toEqual({
      involvement: "authored",
      state: "closed",
    });
  });

  it("clearing to defaults first means a default-named URL restores defaults", () => {
    writePersistedPullRequestListFilters({ involvement: "authored", state: "closed" });
    writePersistedPullRequestListFilters(DEFAULT_PULL_REQUEST_LIST_FILTERS);
    expect(shouldRestorePersistedListFilters({ involvement: "all", state: "open" })).toBe(true);
    expect(readPersistedPullRequestListFilters()).toEqual(DEFAULT_PULL_REQUEST_LIST_FILTERS);
    expect(
      restoredListSearchToReplaceUrl(
        { involvement: "all", state: "open" },
        readPersistedPullRequestListFilters(),
      ),
    ).toBe(null);
  });

  it("drops restored environment, project, and host when that server is gone", () => {
    const saved = {
      involvement: "authored" as const,
      state: "closed" as const,
      environmentId: "gone" as EnvironmentId,
      projectId: "project-1" as ProjectId,
      host: "github.com",
    };
    expect(livePullRequestListFilters(saved)).toEqual(saved);
    expect(livePullRequestListFilters(saved, [])).toEqual({
      involvement: "authored",
      state: "closed",
    });
    expect(livePullRequestListFilters(saved, ["env-1" as EnvironmentId])).toEqual({
      involvement: "authored",
      state: "closed",
    });
    expect(
      livePullRequestListFilters(saved, ["gone" as EnvironmentId], ["project-2" as ProjectId]),
    ).toEqual({
      involvement: "authored",
      state: "closed",
      environmentId: "gone",
      host: "github.com",
    });
    expect(
      livePullRequestListFilters({ ...saved, environmentId: "env-1" as EnvironmentId }, [
        "env-1" as EnvironmentId,
      ]),
    ).toEqual({
      involvement: "authored",
      state: "closed",
      environmentId: "env-1",
      projectId: "project-1",
      host: "github.com",
    });
    writePersistedPullRequestListFilters(saved);
    expect(persistedPullRequestListSearch()).toEqual(saved);
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
