import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveAutomationRunCompletion } from "./automationRunCompletion.ts";

const runId = RunId.make("run-1");
describe("V2 automation completion", () => {
  it("waits for the active run and for an initial run to exist", () => {
    expect(
      resolveAutomationRunCompletion({
        status: "completed",
        lastError: null,
        latestRunId: runId,
        activeRunId: runId,
      }),
    ).toBeNull();
    expect(
      resolveAutomationRunCompletion({
        status: "idle",
        lastError: null,
        latestRunId: null,
        activeRunId: null,
      }),
    ).toBeNull();
  });
  it("records terminal V2 outcomes and failure details", () => {
    const settled = { latestRunId: runId, activeRunId: null, lastError: null };
    expect(resolveAutomationRunCompletion({ ...settled, status: "completed" })).toEqual({
      status: "completed",
      error: null,
    });
    expect(
      resolveAutomationRunCompletion({
        ...settled,
        status: "failed",
        lastError: "Provider crashed",
      }),
    ).toEqual({ status: "failed", error: "Provider crashed" });
    for (const status of ["interrupted", "cancelled", "rolled_back"] as const) {
      expect(resolveAutomationRunCompletion({ ...settled, status })).toEqual({
        status: "interrupted",
        error: null,
      });
    }
  });
});
