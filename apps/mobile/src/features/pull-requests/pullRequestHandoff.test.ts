import { afterEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { appAtomRegistry } from "../../state/atom-registry";
import { composerDraftsAtom, getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import {
  newTaskComposerDraftKey,
  resetPullRequestHandoffDraftsForTests,
  writePullRequestHandoffDraft,
} from "./pullRequestHandoff";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");

afterEach(() => {
  resetPullRequestHandoffDraftsForTests();
  appAtomRegistry.set(composerDraftsAtom, {});
});

describe("writePullRequestHandoffDraft", () => {
  it("writes the prompt into the project's new-task composer draft", () => {
    const draftKey = writePullRequestHandoffDraft({
      environmentId,
      projectId,
      prompt: "Fix the review finding.",
    });

    expect(draftKey).toBe(newTaskComposerDraftKey(environmentId, projectId));
    expect(getComposerDraftSnapshot(draftKey).text).toBe("Fix the review finding.");
  });

  it("replaces an earlier hand-off instead of stacking both", () => {
    writePullRequestHandoffDraft({
      environmentId,
      projectId,
      prompt: "Explain this pull request.",
    });
    const draftKey = writePullRequestHandoffDraft({
      environmentId,
      projectId,
      prompt: "Fix the review finding.",
    });

    expect(getComposerDraftSnapshot(draftKey).text).toBe("Fix the review finding.");
  });

  it("keeps a sentence the reader typed and puts the hand-off under it", () => {
    const draftKey = newTaskComposerDraftKey(environmentId, projectId);
    appAtomRegistry.set(composerDraftsAtom, {
      [draftKey]: { text: "check the migration first", attachments: [] },
    });

    writePullRequestHandoffDraft({
      environmentId,
      projectId,
      prompt: "Fix the review finding.",
    });

    expect(getComposerDraftSnapshot(draftKey).text).toBe(
      "check the migration first\n\nFix the review finding.",
    );
  });
});
