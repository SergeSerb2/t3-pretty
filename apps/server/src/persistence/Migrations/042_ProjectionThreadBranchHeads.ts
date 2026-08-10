import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("branch_event_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN branch_event_id TEXT`;
  }
  if (!names.has("branch_head_ref")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN branch_head_ref TEXT`;
  }
  if (!names.has("branch_head_repository")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN branch_head_repository TEXT`;
  }
  if (!names.has("branch_head_owner")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN branch_head_owner TEXT`;
  }
  if (!names.has("branch_head_is_cross_repository")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN branch_head_is_cross_repository INTEGER
    `;
  }

  yield* sql`
    UPDATE projection_threads AS threads
    SET branch_event_id = (
      SELECT events.event_id
      FROM orchestration_events AS events
      WHERE events.aggregate_kind = 'thread'
        AND events.stream_id = threads.thread_id
        AND (
          events.event_type = 'thread.created'
          OR (
            events.event_type = 'thread.meta-updated'
            AND json_type(events.payload_json, '$.branch') IS NOT NULL
          )
        )
      ORDER BY events.sequence DESC
      LIMIT 1
    )
    WHERE branch_event_id IS NULL
  `;
});
