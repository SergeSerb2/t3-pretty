import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import {
  getComposerDraftSnapshot,
  requireComposerDraftsLoaded,
  setComposerDraftHandoffText,
} from "../../state/use-composer-drafts";
import { handoffPrompt } from "./pullRequestDetail.logic";

export function newTaskComposerDraftKey(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): string {
  return `new-task:${scopedProjectKey(environmentId, projectId)}`;
}

/**
 * Loads persisted drafts before a pull-request hand-off reads or writes one.
 * Keeping hydration separate lets the caller verify that it still owns the
 * navigation action before mutating a draft after this async boundary.
 */
export async function requirePullRequestHandoffDraftsLoaded(): Promise<void> {
  await requireComposerDraftsLoaded();
}

/**
 * Pastes a pull-request hand-off into the project's loaded new-task composer
 * draft. Does not start a thread — the new-task sheet is where the reader
 * picks a model and sends. The URL is stored so Start can prepare that
 * checkout.
 */
export function writePullRequestHandoffDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly prompt: string;
  readonly url: string;
}): string {
  const draftKey = newTaskComposerDraftKey(input.environmentId, input.projectId);
  const existing = getComposerDraftSnapshot(draftKey);
  const prompt = handoffPrompt(
    {
      prompt: existing.text,
      lastHandoffPrompt: existing.lastHandoffPrompt,
    },
    input.prompt,
  );
  setComposerDraftHandoffText(draftKey, prompt, input.prompt, {
    pullRequestReference: input.url,
  });
  return draftKey;
}
