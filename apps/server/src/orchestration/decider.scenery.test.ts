import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type ThreadSceneryAssignment,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const ASSIGNED_AT = "1969-12-30T00:00:00.000Z";

const SCENERY_PHOTO = {
  photoId: "unsplash-yosemite",
  name: "Yosemite Valley, United States",
  averageColorHex: "#3a5f7a",
  heroURL: "https://images.unsplash.com/photo-yosemite?w=1080",
  thumbURL: "https://images.unsplash.com/photo-yosemite?w=200",
  rawURL: "https://images.unsplash.com/photo-yosemite",
  downloadLocationURL: "https://api.unsplash.com/photos/yosemite/download",
  photographerName: "Jane Doe",
  photographerProfileURL: "https://unsplash.com/@jane",
} as const;

const OTHER_SCENERY_PHOTO = {
  ...SCENERY_PHOTO,
  photoId: "unsplash-banff",
  name: "Banff, Canada",
} as const;

const EXISTING_ASSIGNMENT: ThreadSceneryAssignment = {
  ...SCENERY_PHOTO,
  assignedAt: ASSIGNED_AT,
};

function makeReadModel(input: {
  readonly scenery?: ThreadSceneryAssignment | null;
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        scenery: input.scenery ?? null,
        pullRequests: [],
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("scenery decider", (it) => {
  it.effect("assigns scenery, stamping assignedAt and updatedAt together", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery"),
          threadId: ThreadId.make("thread-1"),
          scenery: SCENERY_PHOTO,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.scenery-assigned");
      if (events[0]?.type === "thread.scenery-assigned") {
        expect(events[0].payload.scenery).toEqual({
          ...SCENERY_PHOTO,
          assignedAt: events[0].payload.updatedAt,
        });
      }
    }),
  );

  it.effect("a raced second assign keeps the first binding and original updatedAt", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery-again"),
          threadId: ThreadId.make("thread-1"),
          scenery: OTHER_SCENERY_PHOTO,
          createdAt: NOW,
        },
        readModel: makeReadModel({ scenery: EXISTING_ASSIGNMENT }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.scenery-assigned");
      if (events[0]?.type === "thread.scenery-assigned") {
        expect(events[0].payload.scenery).toEqual(EXISTING_ASSIGNMENT);
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("assigns scenery on an archived thread (its photo survives archiving)", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery-archived"),
          threadId: ThreadId.make("thread-1"),
          scenery: SCENERY_PHOTO,
          createdAt: NOW,
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events.map((entry) => entry.type)).toEqual(["thread.scenery-assigned"]);
    }),
  );

  it.effect("replaces the binding when the photo catalog changes", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery-set"),
          threadId: ThreadId.make("thread-1"),
          scenery: { ...OTHER_SCENERY_PHOTO, photoSetId: "night-cities" },
          createdAt: NOW,
        },
        readModel: makeReadModel({
          scenery: { ...EXISTING_ASSIGNMENT, photoSetId: "world-scenery" },
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.scenery-assigned");
      if (events[0]?.type === "thread.scenery-assigned") {
        expect(events[0].payload.scenery.photoId).toBe(OTHER_SCENERY_PHOTO.photoId);
        expect(events[0].payload.scenery.photoSetId).toBe("night-cities");
        expect(events[0].payload.scenery.assignedAt).toBe(events[0].payload.updatedAt);
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("keeps the first photo when another device assigns the same catalog", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery-same-set"),
          threadId: ThreadId.make("thread-1"),
          scenery: { ...OTHER_SCENERY_PHOTO, photoSetId: "night-cities" },
          createdAt: NOW,
        },
        readModel: makeReadModel({
          scenery: { ...EXISTING_ASSIGNMENT, photoSetId: "night-cities" },
        }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.scenery-assigned");
      if (events[0]?.type === "thread.scenery-assigned") {
        expect(events[0].payload.scenery).toEqual({
          ...EXISTING_ASSIGNMENT,
          photoSetId: "night-cities",
        });
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("rejects assigning scenery for an unknown thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scenery.assign",
          commandId: CommandId.make("cmd-scenery-missing"),
          threadId: ThreadId.make("thread-missing"),
          scenery: SCENERY_PHOTO,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
