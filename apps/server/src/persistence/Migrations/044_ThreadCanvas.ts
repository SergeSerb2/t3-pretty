import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_canvas (
      thread_id TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
