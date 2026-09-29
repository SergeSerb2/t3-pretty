import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarScopedProjectRef,
  selectDraftLandingProject,
  shouldReadProjectFileThreadEnvMode,
} from "./newThreadDefaults";

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

describe("resolveSidebarScopedProjectRef", () => {
  const localEnvironmentId = EnvironmentId.make("local");
  const remoteEnvironmentId = EnvironmentId.make("remote");
  const localProjectId = ProjectId.make("local-project");
  const remoteProjectId = ProjectId.make("remote-project");
  const otherProjectId = ProjectId.make("other-project");
  const scopedGroup = {
    projectKey: "github.com/t3tools/t3code",
    environmentId: localEnvironmentId,
    id: localProjectId,
    memberProjectRefs: [
      scopeProjectRef(localEnvironmentId, localProjectId),
      scopeProjectRef(remoteEnvironmentId, remoteProjectId),
    ],
  };
  const otherGroup = {
    projectKey: "github.com/t3tools/other",
    environmentId: localEnvironmentId,
    id: otherProjectId,
    memberProjectRefs: [scopeProjectRef(localEnvironmentId, otherProjectId)],
  };

  it("returns null when the sidebar is showing every project", () => {
    expect(
      resolveSidebarScopedProjectRef({
        projectScopeKey: null,
        groups: [scopedGroup, otherGroup],
      }),
    ).toBeNull();
  });

  it("returns null when the scoped project is no longer in the catalog", () => {
    expect(
      resolveSidebarScopedProjectRef({
        projectScopeKey: scopedGroup.projectKey,
        groups: [otherGroup],
      }),
    ).toBeNull();
  });

  it("keeps the currently viewed member of the scoped project when it belongs to that group", () => {
    expect(
      resolveSidebarScopedProjectRef({
        projectScopeKey: scopedGroup.projectKey,
        groups: [otherGroup, scopedGroup],
        preferredMemberRef: scopeProjectRef(remoteEnvironmentId, remoteProjectId),
      }),
    ).toEqual(scopeProjectRef(remoteEnvironmentId, remoteProjectId));
  });

  it("stays on the current machine when that machine hosts the scoped project", () => {
    expect(
      resolveSidebarScopedProjectRef({
        projectScopeKey: scopedGroup.projectKey,
        groups: [scopedGroup],
        preferredMemberRef: scopeProjectRef(remoteEnvironmentId, otherProjectId),
      }),
    ).toEqual(scopeProjectRef(remoteEnvironmentId, remoteProjectId));
  });

  it("falls back to the group's representative project", () => {
    expect(
      resolveSidebarScopedProjectRef({
        projectScopeKey: scopedGroup.projectKey,
        groups: [otherGroup, scopedGroup],
      }),
    ).toEqual(scopeProjectRef(localEnvironmentId, localProjectId));
  });
});
