import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Per-tick tool progress used to be persisted as one `tool.updated` activity
 * row + one `thread.activity-appended` event + one command receipt each,
 * ~26 rows per tool call. Progress is now live-only with a coalesced upsert
 * under a stable id (see ToolProgressService), so the historical ticks are
 * dead weight.
 *
 * The migration itself is a marker: the delete can touch gigabytes on a large
 * database, and the migrator runs each migration in one transaction, so a
 * disk-full failure there would block every boot until space is freed.
 * Instead the Sqlite layer runs `cleanupSupersededToolUpdates` best-effort
 * (batched, each batch its own transaction) right after this migration lands,
 * then reclaims the pages with VACUUM. Rows a failed cleanup leaves behind
 * are harmless: the thread detail query already hides superseded updates.
 */
export default Effect.void;

// Rows deleted per statement. Small enough that a batch commits in tens of
// milliseconds and the WAL stays bounded while the delete walks a large DB.
const CLEANUP_BATCH = 20_000;

/**
 * Delete every `tool.updated` row that a `tool.completed` for the same
 * (thread, turn, group) supersedes — the exact rule the thread detail query
 * applies at read time — plus its event and receipt. Idempotent (re-running
 * finds nothing). No projector replays from sequence 0, a hypothetical full
 * replay would rebuild exactly this state, and range reads tolerate the
 * sequence gaps.
 */
export const cleanupSupersededToolUpdates = Effect.fn("cleanupSupersededToolUpdates")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS superseded_tool_updates`;
  yield* sql`DROP TABLE IF EXISTS superseded_tool_update_events`;
  yield* sql`
      CREATE TEMP TABLE superseded_tool_updates AS
      WITH candidates AS (
        SELECT
          activity_id,
          thread_id,
          turn_id,
          kind,
          projection_group_key,
          CASE
            WHEN sequence IS NULL THEN '0|' || created_at || '|' || activity_id
            ELSE '1|' || printf('%020llu', sequence) || '|' || created_at || '|' || activity_id
          END AS sort_key
        FROM projection_thread_activities
        WHERE kind IN ('tool.updated', 'tool.completed')
          AND projection_group_key IS NOT NULL
      ),
      latest_completion AS (
        SELECT thread_id, turn_id, projection_group_key, MAX(sort_key) AS sort_key
        FROM candidates
        WHERE kind = 'tool.completed'
        GROUP BY thread_id, turn_id, projection_group_key
      )
      SELECT candidate.activity_id
      FROM candidates AS candidate
      INNER JOIN latest_completion AS completion
        ON completion.thread_id = candidate.thread_id
        AND completion.turn_id IS candidate.turn_id
        AND completion.projection_group_key = candidate.projection_group_key
      WHERE candidate.kind = 'tool.updated'
        AND completion.sort_key > candidate.sort_key
    `;

  // The activity id is the provider event id the command was keyed on, so
  // the domain event is found through its payload and the receipt through
  // the event's command id.
  yield* sql`
      CREATE TEMP TABLE superseded_tool_update_events AS
      SELECT sequence, command_id
      FROM orchestration_events
      WHERE event_type = 'thread.activity-appended'
        AND json_extract(payload_json, '$.activity.kind') = 'tool.updated'
        AND json_extract(payload_json, '$.activity.id') IN (
          SELECT activity_id FROM superseded_tool_updates
        )
    `;

  let deletedEvents = 0;
  let deletedActivities = 0;
  for (;;) {
    const batch = yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
            DELETE FROM orchestration_command_receipts
            WHERE command_id IN (
              SELECT command_id FROM superseded_tool_update_events
              WHERE command_id IS NOT NULL
                AND rowid IN (
                  SELECT rowid FROM superseded_tool_update_events ORDER BY rowid LIMIT ${CLEANUP_BATCH}
                )
            )
          `;
        yield* sql`
            DELETE FROM orchestration_events
            WHERE sequence IN (
              SELECT sequence FROM superseded_tool_update_events
              WHERE rowid IN (
                SELECT rowid FROM superseded_tool_update_events ORDER BY rowid LIMIT ${CLEANUP_BATCH}
              )
            )
          `;
        const removed = yield* sql<{ readonly sequence: number }>`
            DELETE FROM superseded_tool_update_events
            WHERE rowid IN (
              SELECT rowid FROM superseded_tool_update_events ORDER BY rowid LIMIT ${CLEANUP_BATCH}
            )
            RETURNING sequence
          `;
        return removed.length;
      }),
    );
    deletedEvents += batch;
    if (batch < CLEANUP_BATCH) break;
  }
  for (;;) {
    const batch = yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
            DELETE FROM projection_thread_activities
            WHERE activity_id IN (
              SELECT activity_id FROM superseded_tool_updates
              WHERE rowid IN (
                SELECT rowid FROM superseded_tool_updates ORDER BY rowid LIMIT ${CLEANUP_BATCH}
              )
            )
          `;
        const removed = yield* sql<{ readonly activity_id: string }>`
            DELETE FROM superseded_tool_updates
            WHERE rowid IN (
              SELECT rowid FROM superseded_tool_updates ORDER BY rowid LIMIT ${CLEANUP_BATCH}
            )
            RETURNING activity_id
          `;
        return removed.length;
      }),
    );
    deletedActivities += batch;
    if (batch < CLEANUP_BATCH) break;
  }

  yield* sql`DROP TABLE superseded_tool_update_events`;
  yield* sql`DROP TABLE superseded_tool_updates`;
  return { deletedEvents, deletedActivities };
});
