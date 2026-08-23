import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nextPullRequestEnvironmentId } from "./pullRequestListFiltersPersistence";

const env = (id: string) => ({ environmentId: id as EnvironmentId });

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
