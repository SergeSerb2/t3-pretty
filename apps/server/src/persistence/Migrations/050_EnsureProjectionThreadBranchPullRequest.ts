import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Idempotent: existing ~/.t3 DBs may already have migration 48 under a
 * different name (fork slot collision), so 048 never ran and listThreads
 * crashed with `no such column: branch_pull_request_json`. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "branch_pull_request_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN branch_pull_request_json TEXT
    `;
  }
});
