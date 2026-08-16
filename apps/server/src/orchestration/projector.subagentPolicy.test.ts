import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    occurredAt: "2026-01-01T00:00:00.000Z",
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const CREATED_PAYLOAD = {
  threadId: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { provider: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

it.effect("projects thread.created seeding subagentPolicy", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: { ...CREATED_PAYLOAD, subagentPolicy: { mode: "off" } },
      }),
    );
    expect(created.threads[0]?.subagentPolicy).toEqual({ mode: "off" });
  }),
);

it.effect("projects thread.subagent-policy-set replacing the policy", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      makeEvent({ sequence: 1, type: "thread.created", payload: CREATED_PAYLOAD }),
    );

    const updated = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.subagent-policy-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          policy: { mode: "on", child: { model: "gpt-5.6-luna" } },
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    );
    expect(updated.threads[0]?.subagentPolicy).toEqual({
      mode: "on",
      child: { model: "gpt-5.6-luna" },
    });
  }),
);
