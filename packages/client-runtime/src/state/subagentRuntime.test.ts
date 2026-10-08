import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { deriveAgentPanelModel, projectedSubagentsToRuntime } from "./subagentRuntime.ts";

describe("V2 fleet projection", () => {
  it("preserves native usage, continuation handles and workflow phase membership", () => {
    const at = DateTime.makeUnsafe("2026-10-02T12:00:00.000Z");
    const base = { title: null, prompt: "Review migration", model: "claude", status: "running" as const,
      result: null, startedAt: at, completedAt: null, updatedAt: at };
    const agents = projectedSubagentsToRuntime([
      { ...base, id: "workflow", kind: "workflow", phases: [{ index: 0, title: "Review" }] },
      { ...base, id: "reviewer", kind: "workflow_agent", parentAgentId: "workflow", phaseIndex: 0,
        role: "reviewer", effort: "high", activationCount: 2, usage: { totalTokens: 200, outputTokens: 80 },
        outputFile: "/tmp/review.txt", runHandles: { transcriptDir: "/tmp/transcript" },
        recentActivity: [{ at: DateTime.formatIso(at), summary: "Read migration" }] },
    ]);
    expect(agents[1]).toMatchObject({ role: "reviewer", activationCount: 2, usage: { totalTokens: 200 },
      runHandles: { transcriptDir: "/tmp/transcript" }, recentActivity: [{ summary: "Read migration" }] });
    const panel = deriveAgentPanelModel({ agents });
    expect(panel.workflows[0]?.phases[0]).toMatchObject({ title: "Review", state: "running", activeCount: 1 });
    expect(panel.workflows[0]?.phases[0]?.members[0]?.id).toBe("reviewer");
    expect(panel.directAgents).toEqual([]);
    expect(panel.totalTokens).toBe(200);
  });
});
