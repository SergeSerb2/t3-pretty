import { RuntimeRequestId, PlanId, type OrchestrationV2RuntimeRequest, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import { threadShellFromProjection } from "../../orchestration-v2/ProjectionStore.ts";
import { fixtureProjection, fixtureRun, fixtureNow } from "../../testUtils/V2ProjectionFixture.ts";

describe("V2 thread shell aggregates retained from the fork", () => {
  for (const kind of ["command", "user_input"] as const) {
    it(`exposes only pending ${kind} requests without activity history`, () => {
      const projection = { ...fixtureProjection(), runtimeRequests: [] as OrchestrationV2RuntimeRequest[] };
      projection.runtimeRequests.push({ id: RuntimeRequestId.make("pending"), nodeId: fixtureRun("run", 1, "running").rootNodeId!, providerTurnId: null, nativeRequestRef: null, kind, status: "pending", createdAt: fixtureNow, resolvedAt: null, responseCapability: { type: "not_resumable", reason: "fixture" } });
      assert.equal(threadShellFromProjection(projection).pendingRuntimeRequest?.id, "pending");
      projection.runtimeRequests[0] = { ...projection.runtimeRequests[0]!, status: "resolved", resolvedAt: fixtureNow };
      assert.isNull(threadShellFromProjection(projection).pendingRuntimeRequest);
    });
  }
  it("clears actionable proposed plans once implemented", () => {
    const projection = { ...fixtureProjection(), plans: [] as OrchestrationV2ThreadProjection["plans"][number][] };
    projection.plans.push({ id: PlanId.make("plan"), threadId: projection.thread.id, runId: null, nodeId: fixtureRun("run", 1, "running").rootNodeId!, kind: "proposed_plan", status: "active", markdown: "Implement this" });
    assert.isTrue(threadShellFromProjection(projection).hasActionableProposedPlan);
    projection.plans[0] = { ...projection.plans[0]!, status: "completed" };
    assert.isFalse(threadShellFromProjection(projection).hasActionableProposedPlan);
  });
});
