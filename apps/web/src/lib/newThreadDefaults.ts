import type { EnvironmentId, ThreadEnvMode } from "@t3tools/contracts";

export function shouldReadProjectFileThreadEnvMode(input: {
  readonly projectDefault: ThreadEnvMode | null | undefined;
  readonly environmentConnected: boolean;
}): boolean {
  return input.projectDefault == null && input.environmentConnected;
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
