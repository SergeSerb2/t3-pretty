import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { handoffPrompt } from "./pullRequestDetail.logic";

/**
 * What the last pull-request hand-off wrote into each new-task draft. Only that
 * sentence is replaced on the next tap; anything the reader typed stays.
 */
const lastHandoffPromptByDraft = new Map<string, string>();

export function newTaskComposerDraftKey(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): string {
  return `new-task:${scopedProjectKey(environmentId, projectId)}`;
}

/**
 * Pastes a pull-request hand-off into the project's new-task composer draft.
 * Does not start a thread — the new-task sheet is where the reader picks a
 * model and sends.
 */
export function writePullRequestHandoffDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly prompt: string;
}): string {
  const draftKey = newTaskComposerDraftKey(input.environmentId, input.projectId);
  const existing = getComposerDraftSnapshot(draftKey);
  const prompt = handoffPrompt(
    {
      prompt: existing.text,
      lastHandoffPrompt: lastHandoffPromptByDraft.get(draftKey),
    },
    input.prompt,
  );
  lastHandoffPromptByDraft.set(draftKey, input.prompt);
  setComposerDraftText(draftKey, prompt);
  return draftKey;
}

export function resetPullRequestHandoffDraftsForTests(): void {
  lastHandoffPromptByDraft.clear();
}
