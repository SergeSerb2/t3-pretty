import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldKeepRestoredPullRequestScope } from "./pullRequestListFiltersPersistence";

const env = (id: string) => ({ environmentId: id as EnvironmentId });

describe("shouldKeepRestoredPullRequestScope", () => {
  it("keeps project/host when the restored environment is still connected", () => {
    expect(
      shouldKeepRestoredPullRequestScope("env-1" as EnvironmentId, [env("env-1"), env("env-2")]),
    ).toBe(true);
  });

  it("drops project/host when falling back because the restored environment is gone", () => {
    expect(shouldKeepRestoredPullRequestScope("gone" as EnvironmentId, [env("env-1")])).toBe(false);
  });

  it("drops project/host when nothing was restored", () => {
    expect(shouldKeepRestoredPullRequestScope(null, [env("env-1")])).toBe(false);
  });
});
