import type { ReactNode } from "react";
import { createContext, useMemo } from "react";

import { useProject } from "../../state/entities";
import { PullRequestMediaContext } from "./PullRequestMedia";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";

export const PullRequestMarkdownRepositoryContext = createContext<string | null>(null);

export function PullRequestMarkdownRepository(props: {
  readonly value: string | null;
  readonly params: PullRequestParams;
  readonly children: ReactNode;
}) {
  const target = pullRequestTarget(props.params);
  const project = useProject({
    environmentId: target.environmentId,
    projectId: target.input.projectId,
  });
  const cwd = project?.workspaceRoot;
  const media = useMemo(
    () => (cwd ? { environmentId: target.environmentId, cwd } : null),
    [cwd, target.environmentId],
  );
  return (
    <PullRequestMarkdownRepositoryContext value={props.value}>
      <PullRequestMediaContext value={media}>{props.children}</PullRequestMediaContext>
    </PullRequestMarkdownRepositoryContext>
  );
}
