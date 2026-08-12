import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_thread_activities
    ADD COLUMN projection_group_key TEXT
  `;

  yield* sql`
    ALTER TABLE projection_thread_activities
    ADD COLUMN context_used_tokens REAL
  `;

  // Existing rows overwhelmingly carry the adapter's explicit tool-call id.
  // Backfill that lossless identity in SQLite so upgrading a large database
  // does not decode every payload in JavaScript. Fallback label identities are
  // populated for all newly projected rows by the repository.
  yield* sql`
    UPDATE projection_thread_activities
    SET projection_group_key = 'id:' || TRIM(json_extract(payload_json, '$.data.toolCallId'))
    WHERE kind IN ('tool.updated', 'tool.completed')
      AND json_type(payload_json, '$.data.toolCallId') = 'text'
      AND LENGTH(TRIM(json_extract(payload_json, '$.data.toolCallId'))) > 0
  `;

  yield* sql`
    UPDATE projection_thread_activities
    SET context_used_tokens = json_extract(payload_json, '$.usedTokens')
    WHERE kind = 'context-window.updated'
      AND json_type(payload_json, '$.usedTokens') IN ('integer', 'real')
      AND json_extract(payload_json, '$.usedTokens') >= 0
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_compaction
    ON projection_thread_activities(
      thread_id,
      turn_id,
      kind,
      projection_group_key,
      sequence,
      created_at,
      activity_id
    )
  `;
});
