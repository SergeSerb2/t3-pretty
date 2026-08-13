import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import {
  ensureComposerDraftsLoaded,
  getComposerDraftSnapshot,
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
 * Pastes a pull-request hand-off into the project's new-task composer draft.
 * Does not start a thread — the new-task sheet is where the reader picks a
 * model and sends. The URL is stored so Start can prepare that checkout.
 *
 * Waits for persisted drafts to hydrate first so a cold-launch hand-off does
 * not overwrite a saved new-task draft with an empty in-memory snapshot.
 */
export async function writePullRequestHandoffDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly prompt: string;
  readonly url: string;
}): Promise<string> {
  await ensureComposerDraftsLoaded();
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
