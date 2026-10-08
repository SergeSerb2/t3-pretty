import { assert, it } from "@effect/vitest";
import { applyToProjection, threadShellFromProjection } from "../orchestration-v2/ProjectionStore.ts";
import { EventId, type OrchestrationV2Run } from "@t3tools/contracts";
import { fixtureProjection, fixtureRun, fixtureNow } from "../testUtils/V2ProjectionFixture.ts";

it("completes a stale run while preserving a newer active run and prior completed run", () => {
  const projection = { ...fixtureProjection(), runs: [] as OrchestrationV2Run[] };
  const prior = fixtureRun("prior", 1, "completed");
  const stale = fixtureRun("stale", 2, "running");
  const active = fixtureRun("active", 3, "running");
  projection.runs.push(prior, stale, active);
  const next = applyToProjection(projection, { id: EventId.make("stale:complete"), type: "run.updated", threadId: projection.thread.id, occurredAt: fixtureNow, payload: { ...stale, status: "completed", completedAt: fixtureNow } });
  assert.equal(next.runs.find(run => run.id === active.id)?.status, "running");
  assert.equal(next.runs.find(run => run.id === stale.id)?.status, "completed");
  assert.deepStrictEqual(next.runs.find(run => run.id === prior.id), prior);
  assert.equal(threadShellFromProjection(next).activeRunId, active.id);
});
