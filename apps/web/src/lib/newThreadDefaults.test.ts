import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectDraftLandingProject, shouldReadProjectFileThreadEnvMode } from "./newThreadDefaults";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("local");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("remote");

describe("new thread defaults", () => {
  it("does not block draft creation on a project file from an unavailable environment", () => {
    expect(
      shouldReadProjectFileThreadEnvMode({
        projectDefault: null,
        environmentConnected: false,
      }),
    ).toBe(false);
    expect(
      shouldReadProjectFileThreadEnvMode({
        projectDefault: null,
        environmentConnected: true,
      }),
    ).toBe(true);
  });

  it("keeps an explicit project default independent of environment availability", () => {
    expect(
      shouldReadProjectFileThreadEnvMode({
        projectDefault: "worktree",
        environmentConnected: true,
      }),
    ).toBe(false);
  });

  it("prefers a connected project for the automatic draft landing", () => {
    const remote = { id: "remote-project", environmentId: REMOTE_ENVIRONMENT_ID };
    const local = { id: "local-project", environmentId: LOCAL_ENVIRONMENT_ID };

    expect(selectDraftLandingProject([remote, local], new Set([LOCAL_ENVIRONMENT_ID]))).toBe(local);
    expect(selectDraftLandingProject([remote], new Set())).toBe(remote);
    expect(selectDraftLandingProject([], new Set())).toBeNull();
  });
});
