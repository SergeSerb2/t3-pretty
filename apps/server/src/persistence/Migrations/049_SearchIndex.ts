import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Inverted index for ranked thread search, in plain tables. The server's
 * production SQLite driver is node:sqlite, which ships without FTS5, so the
 * index is maintained by the `projection.search-index` projector and ranked
 * with BM25 in JS instead of an FTS5 virtual table.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS search_index_docs (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS search_index_terms (
      term TEXT PRIMARY KEY,
      doc_freq INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS search_index_postings (
      term TEXT NOT NULL,
      message_id TEXT NOT NULL,
      tf INTEGER NOT NULL,
      PRIMARY KEY (term, message_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_search_index_postings_message
    ON search_index_postings(message_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_search_index_docs_thread
    ON search_index_docs(thread_id)
  `;
});
