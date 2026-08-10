import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(orchestration_events)
  `;

  if (!columns.some((column) => column.name === "recorded_at")) {
    yield* sql`
      ALTER TABLE orchestration_events
      ADD COLUMN recorded_at TEXT
    `;
  }

  // Historical branch timestamps can originate on a client. Treat the upgrade
  // itself as their earliest trustworthy server observation so an old merged
  // PR cannot be attributed to a newly reused branch. Other historical events
  // do not need a synthetic timestamp.
  yield* sql`
    UPDATE orchestration_events
    SET recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE recorded_at IS NULL
      AND (
        event_type = 'thread.created'
        OR (
          event_type = 'thread.meta-updated'
          AND json_type(payload_json, '$.branch') IS NOT NULL
        )
      )
  `;
});
