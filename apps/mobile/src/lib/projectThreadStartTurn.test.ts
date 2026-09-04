import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SkillId,
  ThreadId,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildProjectThreadStartTurnInput,
  deriveThreadTitleFromPrompt,
} from "./projectThreadStartTurn";

vi.mock("expo-crypto", () => ({
  randomUUID: () => crypto.randomUUID(),
}));
vi.mock("./composerImages", () => ({ toUploadChatImageAttachments: () => [] }));

describe("project thread title", () => {
  it("does not expose a native session id in the thread title", () => {
    expect(deriveThreadTitleFromPrompt("/resume sensitive-session-id")).toBe(
      "Resumed native session",
    );
  });

  it("keeps ordinary titles and the empty-prompt fallback", () => {
    expect(deriveThreadTitleFromPrompt("  Fix\n the parser  ")).toBe("Fix the parser");
    expect(deriveThreadTitleFromPrompt(" \n ")).toBe("New thread");
  });

  it.each([
    {
      comment: undefined,
      title: "Keep `cache[key]` & <parser> shared. Retry!",
    },
    {
      comment: 'Why "shared"?',
      title: 'Keep `cache[key]` & <parser> shared. Retry! Comment: Why "shared"?',
    },
  ])("uses readable titles and intact links with comment $comment", ({ comment, title }) => {
    const quoteText = "Keep `cache[key]` & <parser> shared.\n  Retry!";
    const text = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("source-environment"),
      threadId: ThreadId.make("source-thread"),
      messageId: MessageId.make("source-message"),
      text: quoteText,
      ...(comment === undefined ? {} : { comment }),
      start: 0,
      end: quoteText.length,
      prefix: "",
      suffix: "",
    });
    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "new-thread",
      commandId: "command",
      messageId: "message",
      createdAt: "2026-09-01T00:00:00Z",
      text,
      attachments: [],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    });

    expect(input.titleSeed).toBe(title);
    expect(input.bootstrap.createThread.title).toBe(input.titleSeed);
    expect(input.message.text).toBe(text);
  });
});

describe("buildProjectThreadStartTurnInput", () => {
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
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
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
