import {
  AutomationId,
  AutomationRunId,
  EventId,
  ProjectId,
  ThreadId,
  type Automation,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const automationId = AutomationId.make("automation-1");
const runId = AutomationRunId.make("run-1");
const threadId = ThreadId.make("thread-1");

const automation: Automation = {
  id: automationId,
  projectId: ProjectId.make("project-1"),
  name: "Nightly",
  prompt: "Do the thing",
  enabled: true,
  triggers: [{ type: "schedule", cron: "0 9 * * *", timezone: "UTC" }],
  modelSelection: null,
  runtimeMode: "full-access",
  workspace: "checkout",
  createPullRequest: false,
  includeLastRunSummary: false,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  webhookToken: "token-1",
  sourceThreadId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt?: string;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "automation",
    aggregateId: automationId,
    occurredAt: input.occurredAt ?? NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const scheduleRun = (requestedAt: string) => ({
  id: runId,
  automationId,
  projectId: automation.projectId,
  threadId: null,
  status: "requested",
  trigger: { type: "schedule", scheduledFor: "2026-01-01T09:00:00.000Z", catchUp: false },
  requestedAt,
  startedAt: null,
  finishedAt: null,
  error: null,
  summary: null,
});

it.effect("derives nextRunAt from the event clock across create, request, pause, resume", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel(NOW),
      makeEvent({ sequence: 1, type: "automation.created", payload: { automation } }),
    );
    const shell = created.automations[0];
    expect(shell?.nextRunAt).toBe("2026-01-01T09:00:00.000Z");
    expect(shell?.webhookPath).toBe(`/hooks/automations/${automationId}/token-1`);
    expect(shell?.activeRun).toBeNull();

    const requested = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "automation.run-requested",
        occurredAt: "2026-01-01T09:00:10.000Z",
        payload: { run: scheduleRun("2026-01-01T09:00:10.000Z") },
      }),
    );
    expect(requested.automations[0]?.nextRunAt).toBe("2026-01-02T09:00:00.000Z");
    expect(requested.automations[0]?.lastRequestedAt).toBe("2026-01-01T09:00:10.000Z");

    const paused = yield* projectEvent(
      requested,
      makeEvent({
        sequence: 3,
        type: "automation.updated",
        occurredAt: "2026-01-01T10:00:00.000Z",
        payload: { automation: { ...automation, enabled: false } },
      }),
    );
    expect(paused.automations[0]?.nextRunAt).toBeNull();
    // Pausing leaves the run bookkeeping alone.
    expect(paused.automations[0]?.activeRun?.runId).toBe(runId);

    const resumed = yield* projectEvent(
      paused,
      makeEvent({
        sequence: 4,
        type: "automation.updated",
        occurredAt: "2026-01-03T12:00:00.000Z",
        payload: { automation },
      }),
    );
    expect(resumed.automations[0]?.nextRunAt).toBe("2026-01-04T09:00:00.000Z");

    const deleted = yield* projectEvent(
      resumed,
      makeEvent({
        sequence: 5,
        type: "automation.deleted",
        payload: { automationId, projectId: automation.projectId, deletedAt: NOW },
      }),
    );
    expect(deleted.automations).toEqual([]);
  }),
);

it.effect("tracks the active run, last run, failures, and pending trigger", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel(NOW),
      makeEvent({ sequence: 1, type: "automation.created", payload: { automation } }),
    );
    const requested = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "automation.run-requested",
        occurredAt: "2026-01-01T09:00:10.000Z",
        payload: { run: scheduleRun("2026-01-01T09:00:10.000Z") },
      }),
    );
    expect(requested.automations[0]?.activeRun).toEqual({
      runId,
      threadId: null,
      requestedAt: "2026-01-01T09:00:10.000Z",
      startedAt: null,
    });

    const started = yield* projectEvent(
      requested,
      makeEvent({
        sequence: 3,
        type: "automation.run-started",
        payload: { automationId, runId, threadId, startedAt: "2026-01-01T09:00:12.000Z" },
      }),
    );
    expect(started.automations[0]?.activeRun?.threadId).toBe(threadId);
    expect(started.automations[0]?.activeRun?.startedAt).toBe("2026-01-01T09:00:12.000Z");

    const trigger = { type: "webhook", deliveryId: "d-1", payload: null } as const;
    const coalesced = yield* projectEvent(
      started,
      makeEvent({
        sequence: 4,
        type: "automation.run-coalesced",
        payload: { automationId, trigger },
      }),
    );
    expect(coalesced.automations[0]?.pendingTrigger).toEqual(trigger);

    const failed = yield* projectEvent(
      coalesced,
      makeEvent({
        sequence: 5,
        type: "automation.run-finished",
        payload: {
          automationId,
          runId,
          status: "failed",
          finishedAt: "2026-01-01T09:30:00.000Z",
          error: "boom",
          summary: null,
        },
      }),
    );
    const afterFailure = failed.automations[0];
    expect(afterFailure?.activeRun).toBeNull();
    expect(afterFailure?.lastRun).toEqual({
      runId,
      status: "failed",
      threadId,
      requestedAt: "2026-01-01T09:00:10.000Z",
      startedAt: "2026-01-01T09:00:12.000Z",
      finishedAt: "2026-01-01T09:30:00.000Z",
      error: "boom",
      summary: null,
    });
    expect(afterFailure?.consecutiveFailures).toBe(1);
    expect(afterFailure?.runCount).toBe(1);
    // The pending trigger waits for the scheduler to request the next run.
    expect(afterFailure?.pendingTrigger).toEqual(trigger);

    const nextRun = {
      ...scheduleRun("2026-01-01T09:31:00.000Z"),
      id: AutomationRunId.make("run-2"),
    };
    const requestedAgain = yield* projectEvent(
      failed,
      makeEvent({
        sequence: 6,
        type: "automation.run-requested",
        occurredAt: "2026-01-01T09:31:00.000Z",
        payload: { run: nextRun },
      }),
    );
    expect(requestedAgain.automations[0]?.pendingTrigger).toBeNull();

    const completed = yield* projectEvent(
      requestedAgain,
      makeEvent({
        sequence: 7,
        type: "automation.run-finished",
        payload: {
          automationId,
          runId: nextRun.id,
          status: "completed",
          finishedAt: "2026-01-01T09:40:00.000Z",
          error: null,
          summary: "Done.",
        },
      }),
    );
    expect(completed.automations[0]?.consecutiveFailures).toBe(0);
    expect(completed.automations[0]?.runCount).toBe(2);
    expect(completed.automations[0]?.lastRun?.summary).toBe("Done.");
  }),
);

it.effect("projects the automation run marker onto created threads", () =>
  Effect.gen(function* () {
    const withThread = yield* projectEvent(createEmptyReadModel(NOW), {
      ...makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: {
          threadId,
          projectId: automation.projectId,
          title: "Nightly · Jan 1, 09:00",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          automationRun: { automationId, runId },
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
      aggregateKind: "thread",
      aggregateId: threadId,
    });
    expect(withThread.threads[0]?.automationRun).toEqual({ automationId, runId });
    expect(withThread.automations).toEqual([]);
  }),
);
