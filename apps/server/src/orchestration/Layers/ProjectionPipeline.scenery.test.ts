import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  ThreadSceneryAssignment,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";

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
  photoSetId: "night-cities",
  assignedAt: "2026-01-01T00:00:01.000Z",
} as const;

const layer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-scenery-test-" }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(Layer.fresh(layer))("thread scenery projection", (it) => {
  it.effect("stores the assigned photo on the thread row", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-scenery-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-scenery"),
        occurredAt: now,
        commandId: CommandId.make("cmd-scenery-project"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-scenery-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-scenery"),
          title: "Project",
          workspaceRoot: "/tmp/project-scenery",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-scenery-thread"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-scenery"),
        occurredAt: now,
        commandId: CommandId.make("cmd-scenery-thread"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-scenery-thread"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-scenery"),
          projectId: ProjectId.make("project-scenery"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* eventStore.append({
        type: "thread.scenery-assigned",
        eventId: EventId.make("evt-scenery-assigned"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-scenery"),
        occurredAt: SCENERY.assignedAt,
        commandId: CommandId.make("cmd-scenery-assigned"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-scenery-assigned"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-scenery"),
          scenery: SCENERY,
          updatedAt: SCENERY.assignedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{ readonly scenery: string | null }>`
        SELECT scenery_json AS "scenery"
        FROM projection_threads
        WHERE thread_id = 'thread-scenery'
      `;
      assert.equal(rows.length, 1);
      const stored = rows[0]?.scenery;
      assert.notEqual(stored, null);
      assert.deepEqual(
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadSceneryAssignment))(stored),
        SCENERY,
      );
    }),
  );
});
