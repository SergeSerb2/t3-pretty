import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectId, ProviderInstanceId, SkillId } from "@t3tools/contracts";

import {
  buildProjectThreadStartTurnInput,
  deriveThreadTitleFromPrompt,
} from "./projectThreadStartTurn";

vi.mock("expo-crypto", () => ({
  randomUUID: () => crypto.randomUUID(),
}));

describe("buildProjectThreadStartTurnInput", () => {
  it("does not expose a native session id in the thread title", () => {
    expect(deriveThreadTitleFromPrompt("/resume sensitive-session-id")).toBe(
      "Resumed native session",
    );
  });

  it("carries per-thread skill picks into the create-thread bootstrap", () => {
    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      threadId: "thread-1",
      commandId: "command-1",
      messageId: "message-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      text: "Build the composer",
      attachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "t3/thread-1",
      enabledSkillIds: [SkillId.make("acme/skills:skill-a"), SkillId.make("host:Shared:grill-me")],
    });

    expect(input.bootstrap.createThread.enabledSkillIds).toEqual([
      "acme/skills:skill-a",
      "host:Shared:grill-me",
    ]);
  });
});
