import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canCommitPullRequestListRestore,
  nextPullRequestEnvironmentId,
  restorePullRequestListFilters,
  type PersistedPullRequestListFilters,
} from "./pullRequestListFiltersPersistence";

const env = (id: string) => ({ environmentId: id as EnvironmentId });

const saved = (
  overrides: Partial<PersistedPullRequestListFilters> = {},
): PersistedPullRequestListFilters => ({
  involvement: "authored",
  state: "closed",
  environmentId: "env-1" as EnvironmentId,
  projectId: "project-1" as ProjectId,
  host: "github.com",
  ...overrides,
});

describe("nextPullRequestEnvironmentId", () => {
  it("keeps the selected environment when it is still connected", () => {
    expect(
      nextPullRequestEnvironmentId("env-1" as EnvironmentId, "env-2" as EnvironmentId, [
        env("env-1"),
        env("env-2"),
      ]),
    ).toBe("env-1");
  });

  it("falls back to preferred when the selected environment is gone", () => {
    expect(
      nextPullRequestEnvironmentId("gone" as EnvironmentId, "env-1" as EnvironmentId, [
        env("env-1"),
      ]),
    ).toBe("env-1");
  });

  it("falls back to preferred when every server is gone", () => {
    expect(nextPullRequestEnvironmentId("gone" as EnvironmentId, null, [])).toBe(null);
  });

  it("uses preferred when nothing was selected", () => {
    expect(nextPullRequestEnvironmentId(null, "env-1" as EnvironmentId, [env("env-1")])).toBe(
      "env-1",
    );
  });
});

describe("canCommitPullRequestListRestore", () => {
  it("waits while a named save has an empty list", () => {
    expect(canCommitPullRequestListRestore(saved(), [])).toBe(false);
  });

  it("commits a settled list, including when the saved server is gone", () => {
    expect(canCommitPullRequestListRestore(saved(), [env("env-1"), env("env-2")])).toBe(true);
    expect(canCommitPullRequestListRestore(saved(), [env("env-2")])).toBe(true);
    expect(canCommitPullRequestListRestore(saved({ environmentId: null }), [env("env-2")])).toBe(
      true,
    );
    expect(canCommitPullRequestListRestore(saved({ environmentId: null }), [])).toBe(true);
  });
});

describe("restorePullRequestListFilters", () => {
  it("keeps project and host when the saved environment is still present", () => {
    expect(
      restorePullRequestListFilters(saved(), "env-2" as EnvironmentId, [
        env("env-1"),
        env("env-2"),
      ]),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      host: "github.com",
    });
  });

  it("drops project and host when the saved environment is gone", () => {
    expect(
      restorePullRequestListFilters(
        saved({ environmentId: "gone" as EnvironmentId }),
        "env-1" as EnvironmentId,
        [env("env-1")],
      ),
    ).toEqual({
      environmentId: "env-1",
      projectId: undefined,
      host: undefined,
    });
  });

  it("drops project and host when every server is gone", () => {
    expect(restorePullRequestListFilters(saved(), null, [])).toEqual({
      environmentId: null,
      projectId: undefined,
      host: undefined,
    });
  });
});
