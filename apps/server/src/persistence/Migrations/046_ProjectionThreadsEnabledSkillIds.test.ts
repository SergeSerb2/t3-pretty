import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("046_ProjectionThreadsEnabledSkillIds", (it) => {
  it.effect("adds the enabled skill ids column backfilled to an empty set", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 45 });
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

      yield* runMigrations({ toMigrationInclusive: 46 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      const enabledSkillIds = columns.find((column) => column.name === "enabled_skill_ids");
      assert.equal(enabledSkillIds?.name, "enabled_skill_ids");

      const rows = yield* sql<{ readonly enabledSkillIds: string }>`
        SELECT enabled_skill_ids AS "enabledSkillIds" FROM projection_threads
      `;
      assert.deepStrictEqual(rows, [{ enabledSkillIds: "[]" }]);
    }),
  );
});
