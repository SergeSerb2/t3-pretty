import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import ensureProjectionThreadBranchPullRequest from "./050_EnsureProjectionThreadBranchPullRequest.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const threadColumns = Effect.fn("threadColumns")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
});

layer("050_EnsureProjectionThreadBranchPullRequest", (it) => {
  it.effect("adds branch_pull_request_json when slot 48 was already claimed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (48, 'ProjectionThreadsSubagentPolicy'),
          (49, 'ProjectionThreadsActiveOrderKey')
      `;

      const before = yield* threadColumns();
      assert.ok(!before.some((column) => column.name === "branch_pull_request_json"));

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations();

      const after = yield* threadColumns();
      assert.ok(after.some((column) => column.name === "branch_pull_request_json"));

      const rows = yield* sql<{
        readonly threadId: string;
        readonly branchPullRequest: string | null;
      }>`
        SELECT thread_id AS "threadId", branch_pull_request_json AS "branchPullRequest"
        FROM projection_threads
      `;
      assert.deepStrictEqual(rows, [{ threadId: "thread-1", branchPullRequest: null }]);
    }),
  );

  it.effect("repairs a current schema when a later migration id skipped 50", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`ALTER TABLE projection_threads DROP COLUMN branch_pull_request_json`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (99, 'FutureOtherMigration')
      `;

      yield* runMigrations();
      const skipped = yield* threadColumns();
      assert.ok(!skipped.some((column) => column.name === "branch_pull_request_json"));

      yield* ensureProjectionThreadBranchPullRequest;
      const repaired = yield* threadColumns();
      assert.ok(repaired.some((column) => column.name === "branch_pull_request_json"));
    }),
  );
});
