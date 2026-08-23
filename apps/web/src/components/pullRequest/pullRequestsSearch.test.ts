import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import pullRequestsRouteSource from "../../routes/_chat.pull-requests.tsx?raw";
import {
  applyPullRequestsSearchPatch,
  resetPullRequestsListSearch,
  type PullRequestsSearch,
} from "./pullRequestsSearch";

const narrowed: PullRequestsSearch = {
  involvement: "authored",
  state: "closed",
  host: "github.com",
  environmentId: "env-1" as EnvironmentId,
  projectId: "proj-1" as ProjectId,
  draft: "only",
  review: "approved",
  checks: "passing",
  q: "auth",
  repository: "org/repo",
  number: 12,
  selectedProjectId: "proj-1" as ProjectId,
  selectedEnvironmentId: "env-1" as EnvironmentId,
};

describe("pull request list search", () => {
  it("keeps omitted keys and drops keys set to undefined", () => {
    expect(applyPullRequestsSearchPatch(narrowed, { projectId: "proj-2" as ProjectId })).toEqual({
      ...narrowed,
      projectId: "proj-2",
    });
    expect(
      applyPullRequestsSearchPatch(narrowed, { host: undefined, environmentId: undefined }),
    ).toEqual({
      involvement: "authored",
      state: "closed",
      projectId: "proj-1",
      draft: "only",
      review: "approved",
      checks: "passing",
      q: "auth",
      repository: "org/repo",
      number: 12,
      selectedProjectId: "proj-1",
      selectedEnvironmentId: "env-1",
    });
  });

  it("reset restores the default unfiltered list and keeps the typed query", () => {
    expect(resetPullRequestsListSearch(narrowed)).toEqual({
      involvement: "all",
      state: "open",
      q: "auth",
    });
    expect(pullRequestsRouteSource).toContain(
      "writePersistedPullRequestListFilters(DEFAULT_PULL_REQUEST_LIST_FILTERS)",
    );
    expect(pullRequestsRouteSource).toContain("search: resetPullRequestsListSearch");
    expect(pullRequestsRouteSource).toContain("livePullRequestListFilters(");
  });
});
