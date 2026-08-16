import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { cleanupSupersededToolUpdates } from "./047_DeleteSupersededToolUpdatedActivities.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("047_DeleteSupersededToolUpdatedActivities", (it) => {
  it.effect("deletes only superseded tool.updated rows with their events and receipts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 46 });
      // Rows: `upd-1` (superseded by `done-1`), `upd-late` (same group but
      // after the completion), `upd-other` (group with no completion),
      // `upd-turn2` (same group key in another turn), `done-1`.
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json,
          projection_group_key, created_at
        ) VALUES
          ('upd-1', 'thread-1', 'turn-1', 'tool', 'tool.updated', 'Run', '{}', 'id:call-1', '2026-01-01T00:00:01.000Z'),
          ('done-1', 'thread-1', 'turn-1', 'tool', 'tool.completed', 'Run', '{}', 'id:call-1', '2026-01-01T00:00:02.000Z'),
          ('upd-late', 'thread-1', 'turn-1', 'tool', 'tool.updated', 'Run', '{}', 'id:call-1', '2026-01-01T00:00:03.000Z'),
          ('upd-other', 'thread-1', 'turn-1', 'tool', 'tool.updated', 'Run', '{}', 'id:call-2', '2026-01-01T00:00:01.000Z'),
          ('upd-turn2', 'thread-1', 'turn-2', 'tool', 'tool.updated', 'Run', '{}', 'id:call-1', '2026-01-01T00:00:01.000Z')
      `;
      const event = (sequence: number, activityId: string, kind: string, commandId: string) =>
        sql`
          INSERT INTO orchestration_events (
            sequence, event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, command_id, actor_kind, payload_json, metadata_json
          ) VALUES (
            ${sequence}, ${`evt-${activityId}`}, 'thread', 'thread-1', ${sequence},
            'thread.activity-appended', '2026-01-01T00:00:00.000Z', ${commandId}, 'provider',
            ${JSON.stringify({ threadId: "thread-1", activity: { id: activityId, kind } })}, '{}'
          )
        `;
      yield* event(1, "upd-1", "tool.updated", "cmd-upd-1");
      yield* event(2, "done-1", "tool.completed", "cmd-done-1");
      yield* event(3, "upd-late", "tool.updated", "cmd-upd-late");
      yield* event(4, "upd-other", "tool.updated", "cmd-upd-other");
      yield* event(5, "upd-turn2", "tool.updated", "cmd-upd-turn2");
      yield* sql`
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status
        ) VALUES
          ('cmd-upd-1', 'thread', 'thread-1', '2026-01-01T00:00:00.000Z', 1, 'accepted'),
          ('cmd-done-1', 'thread', 'thread-1', '2026-01-01T00:00:00.000Z', 2, 'accepted'),
          ('cmd-upd-late', 'thread', 'thread-1', '2026-01-01T00:00:00.000Z', 3, 'accepted'),
          ('cmd-upd-other', 'thread', 'thread-1', '2026-01-01T00:00:00.000Z', 4, 'accepted'),
          ('cmd-upd-turn2', 'thread', 'thread-1', '2026-01-01T00:00:00.000Z', 5, 'accepted')
      `;

      yield* runMigrations({ toMigrationInclusive: 47 });
      const deleted = yield* cleanupSupersededToolUpdates();
      assert.deepStrictEqual(deleted, { deletedEvents: 1, deletedActivities: 1 });
      // Idempotent: a second pass finds nothing.
      assert.deepStrictEqual(yield* cleanupSupersededToolUpdates(), {
        deletedEvents: 0,
        deletedActivities: 0,
      });

      const rows = yield* sql<{ readonly id: string }>`
        SELECT activity_id AS id FROM projection_thread_activities ORDER BY activity_id
      `;
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        ["done-1", "upd-late", "upd-other", "upd-turn2"],
      );
      const events = yield* sql<{ readonly sequence: number }>`
        SELECT sequence FROM orchestration_events ORDER BY sequence
      `;
      assert.deepStrictEqual(
        events.map((row) => row.sequence),
        [2, 3, 4, 5],
      );
      const receipts = yield* sql<{ readonly id: string }>`
        SELECT command_id AS id FROM orchestration_command_receipts ORDER BY command_id
      `;
      assert.deepStrictEqual(
        receipts.map((row) => row.id),
        ["cmd-done-1", "cmd-upd-late", "cmd-upd-other", "cmd-upd-turn2"],
      );
    }),
  );
});
