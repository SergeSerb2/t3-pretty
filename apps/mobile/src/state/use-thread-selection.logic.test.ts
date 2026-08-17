import { describe, expect, it } from "vite-plus/test";

import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import {
  resolveSelectedThreadShell,
  resolveSelectionDetailFallbackRef,
  threadDetailToShell,
} from "./use-thread-selection.logic";

const environmentId = EnvironmentId.make("environment-1");

const threadRef: ScopedThreadRef = {
  environmentId,
  threadId: ThreadId.make("thread-1"),
};

type ThreadMessage = OrchestrationThread["messages"][number];

function makeMessage(
  input: Pick<ThreadMessage, "id" | "createdAt" | "text"> & Partial<ThreadMessage>,
): ThreadMessage {
  return {
    role: "assistant",
    turnId: null,
    streaming: false,
    updatedAt: input.createdAt,
    ...input,
  };
}

function makeThread(
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "projectId" | "title">,
): OrchestrationThread {
  return {
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    enabledSkillIds: [],
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...input,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledAt ?? null,
  };
}

function makeShell(
  input: Partial<EnvironmentThreadShell> &
    Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId" | "title">,
): EnvironmentThreadShell {
  return {
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    enabledSkillIds: [],
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledAt ?? null,
  };
}

describe("resolveSelectionDetailFallbackRef", () => {
  it("returns null when no thread is selected", () => {
    expect(resolveSelectionDetailFallbackRef(null, null)).toBeNull();
  });

  it("returns null when the shell already resolves the thread", () => {
    const shell = makeShell({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Shell thread",
    });

    // The hot per-thread detail stream must stay unsubscribed while the shell
    // snapshot knows the thread.
    expect(resolveSelectionDetailFallbackRef(threadRef, shell)).toBeNull();
  });

  it("returns the ref while the shell cannot identify the thread", () => {
    expect(resolveSelectionDetailFallbackRef(threadRef, null)).toBe(threadRef);
  });

  it("does not subscribe to detail while a local starting thread is standing in", () => {
    expect(resolveSelectionDetailFallbackRef(threadRef, null, true)).toBeNull();
  });
});

describe("resolveSelectedThreadShell", () => {
  it("prefers the shell snapshot entry over the detail fallback", () => {
    const shell = makeShell({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Shell thread",
    });
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
    });

    expect(resolveSelectedThreadShell(threadRef, shell, detail)).toBe(shell);
  });

  it("converts the detail to a shell while the shell snapshot is missing the thread", () => {
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
      branch: "feature/detail",
      worktreePath: "/tmp/worktree",
    });

    const resolved = resolveSelectedThreadShell(threadRef, null, detail);
    expect(resolved).toMatchObject({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
      branch: "feature/detail",
      worktreePath: "/tmp/worktree",
    });
  });

  it("uses a local starting shell when the server snapshot has not landed", () => {
    const localStarting = makeShell({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Starting thread",
    });

    expect(resolveSelectedThreadShell(threadRef, null, null, localStarting)).toBe(localStarting);
  });

  it("still prefers the server shell over a local starting overlay", () => {
    const shell = makeShell({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Shell thread",
    });
    const localStarting = makeShell({
      environmentId,
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Starting thread",
    });

    expect(resolveSelectedThreadShell(threadRef, shell, null, localStarting)).toBe(shell);
  });

  it("returns null when neither the shell nor the detail can resolve the thread", () => {
    expect(resolveSelectedThreadShell(threadRef, null, null)).toBeNull();
  });

  it("returns null when no thread is selected even if a detail is present", () => {
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
    });

    expect(resolveSelectedThreadShell(null, null, detail)).toBeNull();
  });
});

describe("threadDetailToShell", () => {
  it("derives latestUserMessageAt from the last user message", () => {
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
      messages: [
        makeMessage({
          id: MessageId.make("user-first"),
          role: "user",
          text: "First",
          createdAt: "2026-04-01T00:00:01.000Z",
        }),
        makeMessage({
          id: MessageId.make("user-second"),
          role: "user",
          text: "Second",
          createdAt: "2026-04-01T00:00:02.000Z",
        }),
        makeMessage({
          id: MessageId.make("assistant-last"),
          text: "Answer",
          createdAt: "2026-04-01T00:00:03.000Z",
        }),
      ],
    });

    expect(threadDetailToShell(environmentId, detail).latestUserMessageAt).toBe(
      "2026-04-01T00:00:02.000Z",
    );
  });

  it("reports no latest user message and no pending flags for a fresh detail", () => {
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
    });

    expect(threadDetailToShell(environmentId, detail)).toMatchObject({
      environmentId,
      enabledSkillIds: [],
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      snoozedUntil: null,
      snoozedAt: null,
    });
  });

  it("copies enabledSkillIds from the detail thread", () => {
    const enabledSkillIds = ["acme/skills:skill-a"];
    const detail = makeThread({
      id: threadRef.threadId,
      projectId: ProjectId.make("project-1"),
      title: "Detail thread",
      enabledSkillIds,
    });

    expect(threadDetailToShell(environmentId, detail).enabledSkillIds).toBe(enabledSkillIds);
  });
});
