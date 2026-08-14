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

it.effect("projects thread.created seeding enabledSkillIds", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: { ...CREATED_PAYLOAD, enabledSkillIds: ["acme/skills:skill-a"] },
      }),
    );
    expect(created.threads[0]?.enabledSkillIds).toEqual(["acme/skills:skill-a"]);
  }),
);

it.effect("projects thread.created defaulting enabledSkillIds to empty for old events", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      makeEvent({ sequence: 1, type: "thread.created", payload: CREATED_PAYLOAD }),
    );
    expect(created.threads[0]?.enabledSkillIds).toEqual([]);
  }),
);

it.effect("projects thread.skills-set replacing the enabled skill set", () =>
  Effect.gen(function* () {
    const now = "2026-01-01T00:00:00.000Z";
    const created = yield* projectEvent(
      createEmptyReadModel(now),
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: { ...CREATED_PAYLOAD, enabledSkillIds: ["acme/skills:skill-a"] },
      }),
    );

    const skillsSet = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.skills-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          enabledSkillIds: ["acme/skills:skill-b", "acme/skills:skill-c"],
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    );
    expect(skillsSet.threads[0]?.enabledSkillIds).toEqual([
      "acme/skills:skill-b",
      "acme/skills:skill-c",
    ]);
    expect(skillsSet.threads[0]?.updatedAt).toBe("2026-01-02T00:00:00.000Z");

    const cleared = yield* projectEvent(
      skillsSet,
      makeEvent({
        sequence: 3,
        type: "thread.skills-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          enabledSkillIds: [],
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      }),
    );
    expect(cleared.threads[0]?.enabledSkillIds).toEqual([]);
  }),
);
