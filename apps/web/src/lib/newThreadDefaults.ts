import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef, ThreadEnvMode } from "@t3tools/contracts";

export function shouldReadProjectFileThreadEnvMode(input: {
  readonly projectDefault: ThreadEnvMode | null | undefined;
  readonly environmentConnected: boolean;
}): boolean {
  return input.projectDefault == null && input.environmentConnected;
}

export interface SidebarScopedProjectGroup {
  readonly projectKey: string;
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

/** Maps the sidebar's project filter onto a concrete project to open a thread in. */
export function resolveSidebarScopedProjectRef(input: {
  readonly projectScopeKey: string | null;
  readonly groups: ReadonlyArray<SidebarScopedProjectGroup>;
  readonly preferredMemberRef?: ScopedProjectRef | null;
}): ScopedProjectRef | null {
  if (input.projectScopeKey === null) return null;
  const group = input.groups.find((candidate) => candidate.projectKey === input.projectScopeKey);
  if (!group) return null;

  const preferredMemberRef = input.preferredMemberRef ?? null;
  if (preferredMemberRef) {
    const matchingMember = group.memberProjectRefs.find(
      (projectRef) =>
        projectRef.environmentId === preferredMemberRef.environmentId &&
        projectRef.projectId === preferredMemberRef.projectId,
    );
    if (matchingMember) return matchingMember;
    const sameEnvironment = group.memberProjectRefs.find(
      (projectRef) => projectRef.environmentId === preferredMemberRef.environmentId,
    );
    if (sameEnvironment) return sameEnvironment;
  }

  return scopeProjectRef(group.environmentId, group.id);
}

export function selectDraftLandingProject<
  Project extends { readonly environmentId: EnvironmentId },
>(
  sortedProjects: ReadonlyArray<Project>,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
): Project | null {
  return (
    sortedProjects.find((project) => connectedEnvironmentIds.has(project.environmentId)) ??
    sortedProjects[0] ??
    null
  );
}
