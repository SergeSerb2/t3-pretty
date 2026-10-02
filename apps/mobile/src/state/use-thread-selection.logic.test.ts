import { EnvironmentId, MessageId, ProjectId, SkillId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadProjectionFixture, makeThreadShellFixture } from "../test-fixtures";
import { resolveSelectedThreadShell, resolveSelectionDetailFallbackRef, threadDetailToShell } from "./use-thread-selection.logic";

const environmentId = EnvironmentId.make("environment-1");
const threadRef: ScopedThreadRef = { environmentId, threadId: ThreadId.make("thread-1") };
function shell(title: string) {
  return makeThreadShellFixture({ environmentId, id: threadRef.threadId, title });
}
function detail(title = "Detail thread") {
  return makeThreadProjectionFixture({ id: threadRef.threadId, title, projectId: ProjectId.make("project-1") });
}
describe("resolveSelectionDetailFallbackRef", () => {
  it("subscribes only when the shell and local starting overlay cannot resolve selection", () => {
    expect(resolveSelectionDetailFallbackRef(null, null)).toBeNull();
    expect(resolveSelectionDetailFallbackRef(threadRef, shell("Shell"))).toBeNull();
    expect(resolveSelectionDetailFallbackRef(threadRef, null)).toBe(threadRef);
    expect(resolveSelectionDetailFallbackRef(threadRef, null, true)).toBeNull();
  });
});
describe("resolveSelectedThreadShell", () => {
  it("prefers authoritative server shells, then local overlays, then detail", () => {
    const server = shell("Server"); const local = shell("Starting"); const projection = detail();
    expect(resolveSelectedThreadShell(threadRef, server, projection, local)).toBe(server);
    expect(resolveSelectedThreadShell(threadRef, null, projection, local)).toBe(local);
    expect(resolveSelectedThreadShell(threadRef, null, projection)?.title).toBe("Detail thread");
    expect(resolveSelectedThreadShell(null, null, projection)).toBeNull();
    expect(resolveSelectedThreadShell(threadRef, null, null)).toBeNull();
  });
});
describe("threadDetailToShell", () => {
  it("carries stored state and skills across cold deep-link fallback", () => {
    const storedAt = DateTime.makeUnsafe("2026-04-01T00:00:05.000Z");
    const enabledSkillIds = [SkillId.make("acme/skills:skill-a")];
    const projection = makeThreadProjectionFixture({ storedAt, enabledSkillIds, branch: "feature/detail", worktreePath: "/tmp/worktree" });
    expect(threadDetailToShell(environmentId, projection)).toMatchObject({
      storedAt: "2026-04-01T00:00:05.000Z", enabledSkillIds,
      branch: "feature/detail", worktreePath: "/tmp/worktree",
    });
  });
  it("derives the last user timestamp without confusing a later assistant reply", () => {
    const projection = detail();
    const first = DateTime.makeUnsafe("2026-04-01T00:00:01.000Z");
    const second = DateTime.makeUnsafe("2026-04-01T00:00:02.000Z");
    const base = { threadId: projection.thread.id, runId: null, nodeId: null,
      attachments: [], streaming: false, createdBy: "user" as const, creationSource: "mobile" as const };
    const messages = [
      { ...base, id: MessageId.make("user-first"), role: "user" as const, text: "First", createdAt: first, updatedAt: first },
      { ...base, id: MessageId.make("user-last"), role: "user" as const, text: "Second", createdAt: second, updatedAt: second },
      { ...base, id: MessageId.make("assistant"), role: "assistant" as const, text: "Answer", createdAt: second, updatedAt: second },
    ];
    expect(threadDetailToShell(environmentId, { ...projection, messages }).latestUserMessageAt).toBe("2026-04-01T00:00:02.000Z");
    expect(threadDetailToShell(environmentId, projection).latestUserMessageAt).toBeNull();
  });
});
