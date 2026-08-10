import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionThreadBranchHeads", (it) => {
  it.effect("backfills the latest branch event and leaves head identity unknown", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, branch, created_at, updated_at
        )
        VALUES (
          'thread-branch-head', 'project-branch-head', 'Thread',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access',
          'default', 'feature/current', '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, actor_kind, payload_json, metadata_json, recorded_at
        )
        VALUES
          ('event-created', 'thread', 'thread-branch-head', 0, 'thread.created',
           '2026-01-01T00:00:00.000Z', 'client', '{"branch":"feature/old"}', '{}',
           '2026-01-01T00:00:00.100Z'),
          ('event-branch-current', 'thread', 'thread-branch-head', 1, 'thread.meta-updated',
           '2026-01-01T00:00:01.000Z', 'server', '{"branch":"feature/current"}', '{}',
           '2026-01-01T00:00:01.100Z')
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const rows = yield* sql<{
        readonly branchEventId: string | null;
        readonly branchHeadRef: string | null;
      }>`
        SELECT
          branch_event_id AS "branchEventId",
          branch_head_ref AS "branchHeadRef"
        FROM projection_threads
        WHERE thread_id = 'thread-branch-head'
      `;
      assert.deepStrictEqual(rows, [
        { branchEventId: "event-branch-current", branchHeadRef: null },
      ]);
    }),
  );
});
