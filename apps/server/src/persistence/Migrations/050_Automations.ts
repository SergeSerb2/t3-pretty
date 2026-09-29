import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automations (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      triggers_json TEXT NOT NULL,
      model_selection_json TEXT,
      runtime_mode TEXT NOT NULL,
      workspace TEXT NOT NULL,
      create_pull_request INTEGER NOT NULL,
      include_last_run_summary INTEGER NOT NULL,
      catch_up_missed_runs INTEGER NOT NULL,
      min_interval_seconds INTEGER NOT NULL,
      timeout_minutes INTEGER NOT NULL,
      webhook_token TEXT,
      source_thread_id TEXT,
      next_run_at TEXT,
      active_run_json TEXT,
      last_run_json TEXT,
      last_requested_at TEXT,
      pending_trigger_json TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_project
    ON projection_automations(project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      status TEXT NOT NULL,
      trigger_json TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      summary TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automation_runs_page
    ON projection_automation_runs(automation_id, requested_at DESC, run_id DESC)
  `;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "automation_run_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN automation_run_json TEXT
    `;
  }
});
