import type { EnvironmentId, Issue, IssueProvider } from "@t3tools/contracts";

export const sentryAssigneeHint = "user:ID or team:ID; empty to unassign";

export function mergeIssueEnvironments(
  catalog: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>,
  savedRemotes: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>,
): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  const byId = new Map<EnvironmentId, { environmentId: EnvironmentId; label: string }>();
  for (const remote of savedRemotes) {
    byId.set(remote.environmentId, {
      environmentId: remote.environmentId,
      label: remote.environmentLabel,
    });
  }
  for (const environment of catalog) {
    byId.set(environment.environmentId, {
      environmentId: environment.environmentId,
      label: environment.label,
    });
  }
  return [...byId.values()];
}

export function shouldShowLinearCreateEditor(
  create: { readonly source?: Issue } | null,
  accounts: ReadonlyArray<{ readonly provider: IssueProvider }> | null,
): boolean {
  return create !== null && (accounts?.some((item) => item.provider === "linear") ?? false);
}

export function isIssueDetailLoading(detail: Issue | null, error: string | null): boolean {
  return detail === null && error === null;
}
