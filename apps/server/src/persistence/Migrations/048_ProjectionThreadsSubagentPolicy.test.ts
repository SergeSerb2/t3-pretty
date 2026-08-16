import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("048_ProjectionThreadsSubagentPolicy", (it) => {
  it.effect("adds the nullable subagent policy column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
          settled_override, settled_at, snoozed_until, snoozed_at, pinned_at,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'thread-1', 'project-1', 'Thread', '{}', 'full-access', 'default',
          NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, 0, 0,
          0, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 48 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "subagent_policy_json"));

      const rows = yield* sql<{ readonly policy: string | null }>`
        SELECT subagent_policy_json AS "policy" FROM projection_threads
      `;
      assert.deepStrictEqual(rows, [{ policy: null }]);
    }),
  );
});
