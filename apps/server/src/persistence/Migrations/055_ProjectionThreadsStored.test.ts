import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateStored from "./055_ProjectionThreadsStored.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("055_ProjectionThreadsStored", (it) => {
  it.effect("migrates existing threads as not stored and is safe to rerun", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 64 });
      const now = "2026-01-01T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', ${now}, ${now}
        )
      `;
      yield* runMigrations({ toMigrationInclusive: 66 });
      const migrated = yield* sql<{ readonly storedAt: string | null }>`
        SELECT stored_at AS "storedAt" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepEqual(migrated, [{ storedAt: null }]);

      // Recovery may rerun the migration against a database that already has
      // the column and stored threads in it.
      yield* sql`UPDATE projection_threads SET stored_at = ${now} WHERE thread_id = 'thread-1'`;
      yield* migrateStored;
      const rows = yield* sql<{ readonly storedAt: string | null }>`
        SELECT stored_at AS "storedAt" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepEqual(rows, [{ storedAt: now }]);
    }),
  );
});
