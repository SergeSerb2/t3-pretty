import { describe, expect, it } from "@effect/vitest";
import { MessageId, PlanId, RunId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { fixtureNow, fixtureThreadId } from "../testUtils/V2ProjectionFixture.ts";
import { headlineJobForTurnItem, progressForTodoList } from "./ActivityHeadlineReactor.ts";
const base = {
  id: TurnItemId.make("headline:item"), threadId: fixtureThreadId, runId: RunId.make("headline:run"),
  nodeId: null, providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
  ordinal: 1, status: "running" as const, title: "Finding relevant code", startedAt: fixtureNow, completedAt: null, updatedAt: fixtureNow,
};
describe("V2 live activity headlines", () => {
  it("extracts command details and retains the run guard", () => {
    expect(headlineJobForTurnItem({ ...base, type: "command_execution", input: "rg -n foo src" })).toEqual({ turnId: base.runId, summary: base.title, command: "rg -n foo src", detail: undefined });
  });
  it("uses the file name when the provider has no title", () => {
    expect(headlineJobForTurnItem({ ...base, type: "file_change", title: null, fileName: "src/app.ts" })?.summary).toBe("Editing src/app.ts");
  });
  it("retains provider errors as generation context", () => {
    expect(headlineJobForTurnItem({ ...base, type: "error", status: "failed", failure: { class: "transport_error", message: "Connection interrupted", code: null, retryable: true } })?.detail).toBe("Connection interrupted");
  });
  it("ignores turnless, cancelled and narrative items", () => {
    expect(headlineJobForTurnItem({ ...base, type: "command_execution", input: "pwd", runId: null })).toBeNull();
    expect(headlineJobForTurnItem({ ...base, type: "command_execution", input: "pwd", status: "cancelled" })).toBeNull();
    expect(headlineJobForTurnItem({ ...base, type: "assistant_message", messageId: MessageId.make("headline:message"), text: "Done", streaming: false })).toBeNull();
  });
  it("projects plan progress from the running step and completed count", () => {
    const item: Extract<OrchestrationV2TurnItem, { type: "todo_list" }> = { ...base, type: "todo_list", planId: PlanId.make("headline:plan"), steps: [{ id: "1", text: "Inspect", status: "completed" }, { id: "2", text: "Implement", status: "running" }, { id: "3", text: "Verify", status: "pending" }] };
    expect(progressForTodoList(item)).toEqual({ step: "Implement", completedSteps: 1, totalSteps: 3 });
    expect(progressForTodoList({ ...item, steps: item.steps.map(step => ({ ...step, status: "completed" as const })) })).toEqual({ step: "", completedSteps: 3, totalSteps: 3 });
  });
});
