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

const SCENERY = {
  photoId: "unsplash-yosemite",
  name: "Yosemite Valley, United States",
  averageColorHex: "#3a5f7a",
  heroURL: "https://images.unsplash.com/photo-yosemite?w=1080",
  thumbURL: "https://images.unsplash.com/photo-yosemite?w=200",
  rawURL: "https://images.unsplash.com/photo-yosemite",
  downloadLocationURL: "https://api.unsplash.com/photos/yosemite/download",
  photographerName: "Jane Doe",
  photographerProfileURL: "https://unsplash.com/@jane",
  assignedAt: "2026-01-01T00:00:00.000Z",
} as const;

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

it.effect("projects thread.scenery-assigned onto the thread", () =>
  Effect.gen(function* () {
    const now = "2026-01-01T00:00:00.000Z";
    const created = yield* projectEvent(
      createEmptyReadModel(now),
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Thread",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    expect(created.threads[0]?.scenery ?? null).toBeNull();

    const assigned = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.scenery-assigned",
        payload: { threadId: ThreadId.make("thread-1"), scenery: SCENERY, updatedAt: now },
      }),
    );
    expect(assigned.threads[0]?.scenery).toEqual(SCENERY);
    expect(assigned.threads[0]?.updatedAt).toBe(now);
  }),
);
