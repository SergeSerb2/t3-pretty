import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadActivityCompactionMetadata", (it) => {
  it.effect("backfills lossless tool and context compaction metadata", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
        ) VALUES
          ('tool-row', 'thread-1', 'turn-1', 'tool', 'tool.updated', 'running',
           '{"data":{"toolCallId":" call-1 "}}', '2026-01-01T00:00:00.000Z'),
          ('context-row', 'thread-1', 'turn-1', 'info', 'context-window.updated', 'usage',
           '{"usedTokens":123}', '2026-01-01T00:00:01.000Z'),
          ('malformed-row', 'thread-1', 'turn-1', 'info', 'context-window.updated', 'usage',
           '{"usedTokens":"unknown"}', '2026-01-01T00:00:02.000Z')
      `;

      yield* runMigrations({ toMigrationInclusive: 55 });

      const rows = yield* sql<{
        readonly activityId: string;
        readonly projectionGroupKey: string | null;
        readonly contextUsedTokens: number | null;
      }>`
        SELECT activity_id AS "activityId",
          projection_group_key AS "projectionGroupKey",
          context_used_tokens AS "contextUsedTokens"
        FROM projection_thread_activities
        ORDER BY activity_id
      `;
      assert.deepStrictEqual(rows, [
        { activityId: "context-row", projectionGroupKey: null, contextUsedTokens: 123 },
        { activityId: "malformed-row", projectionGroupKey: null, contextUsedTokens: null },
        { activityId: "tool-row", projectionGroupKey: "id:call-1", contextUsedTokens: null },
      ]);
    }),
  );
});

it.effect("upgrades a fork database with existing compaction metadata without overwriting it", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 50 });
    yield* sql`ALTER TABLE projection_thread_activities ADD COLUMN projection_group_key TEXT`;
    yield* sql`ALTER TABLE projection_thread_activities ADD COLUMN context_used_tokens REAL`;
    yield* sql`
      INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json,
        created_at, projection_group_key, context_used_tokens
      ) VALUES (
        'retained-tool', 'thread-1', 'turn-1', 'tool', 'tool.updated', 'running',
        '{"data":{"toolCallId":"legacy-id"}}', '2026-01-01T00:00:00.000Z', 'id:current-id', 123
      )
    `;

    yield* runMigrations();
    const rows = yield* sql`
      SELECT projection_group_key, context_used_tokens
      FROM projection_thread_activities WHERE activity_id = 'retained-tool'
    `;
    assert.deepStrictEqual(rows, [
      { projection_group_key: "id:current-id", context_used_tokens: 123 },
    ]);
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
