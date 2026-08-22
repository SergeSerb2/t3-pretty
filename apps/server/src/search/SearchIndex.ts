/**
 * SearchIndex - write path for the thread search inverted index.
 *
 * Maintains `search_index_docs` / `search_index_terms` /
 * `search_index_postings` (migration 049) from projected message and turn
 * state. Fed by the `projection.search-index` projector in
 * ProjectionPipeline; read by ThreadSearch.
 *
 * Only the two sources the search contract exposes are indexed: user
 * messages (reduced to their visible text, auto-PR instruction block
 * stripped) and canonical assistant messages (the turn-final
 * `assistant_message_id` rows in `projection_turns`).
 *
 * @module SearchIndex
 */
import type { MessageId, ThreadId } from "@t3tools/contracts";
import { stripCreatePullRequestSuffix } from "@t3tools/shared/createPullRequestPrompt";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../persistence/Errors.ts";
import { termFrequencies } from "./tokenizer.ts";

export interface SearchIndexShape {
  /**
   * Re-derive one message's index entry from current projection state:
   * indexes indexable messages, removes entries for messages that are gone or
   * no longer indexable. Mid-stream messages are left alone; their final
   * message-sent event re-triggers this.
   */
  readonly reindexMessage: (input: {
    readonly messageId: MessageId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Re-derive every index entry of a thread (after a revert): drops entries
   * for messages the thread no longer holds, re-indexes the rest.
   */
  readonly reindexThread: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class SearchIndex extends Context.Service<SearchIndex, SearchIndexShape>()(
  "t3/search/SearchIndex",
) {}

interface MessageRow {
  readonly messageId: string;
  readonly threadId: string;
  readonly role: string;
  readonly text: string;
  readonly isStreaming: number;
  readonly createdAt: string;
}

const makeSearchIndex = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const decrementTerms = (terms: Iterable<string>) =>
    Effect.forEach(
      terms,
      (term) =>
        Effect.gen(function* () {
          yield* sql`UPDATE search_index_terms SET doc_freq = doc_freq - 1 WHERE term = ${term}`;
          yield* sql`DELETE FROM search_index_terms WHERE term = ${term} AND doc_freq <= 0`;
        }),
      { concurrency: 1, discard: true },
    );

  const removeMessage = (messageId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly term: string }>`
        SELECT term FROM search_index_postings WHERE message_id = ${messageId}
      `;
      yield* decrementTerms(rows.map((row) => row.term));
      yield* sql`DELETE FROM search_index_postings WHERE message_id = ${messageId}`;
      yield* sql`DELETE FROM search_index_docs WHERE message_id = ${messageId}`;
    });

  const replaceEntry = (input: {
    readonly messageId: string;
    readonly threadId: string;
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      const existingRows = yield* sql<{ readonly term: string }>`
        SELECT term FROM search_index_postings WHERE message_id = ${input.messageId}
      `;
      const existingTerms = new Set(existingRows.map((row) => row.term));
      const frequencies = termFrequencies(input.text);

      yield* decrementTerms([...existingTerms].filter((term) => !frequencies.has(term)));
      yield* sql`DELETE FROM search_index_postings WHERE message_id = ${input.messageId}`;
      yield* sql`DELETE FROM search_index_docs WHERE message_id = ${input.messageId}`;

      if (frequencies.size === 0) {
        return;
      }

      const tokenCount = [...frequencies.values()].reduce((total, tf) => total + tf, 0);
      yield* sql`
        INSERT INTO search_index_docs (message_id, thread_id, role, token_count, created_at)
        VALUES (${input.messageId}, ${input.threadId}, ${input.role}, ${tokenCount}, ${input.createdAt})
      `;
      yield* Effect.forEach(
        frequencies,
        ([term, tf]) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO search_index_postings (term, message_id, tf)
              VALUES (${term}, ${input.messageId}, ${tf})
            `;
            if (!existingTerms.has(term)) {
              yield* sql`
                INSERT INTO search_index_terms (term, doc_freq)
                VALUES (${term}, 1)
                ON CONFLICT (term) DO UPDATE SET doc_freq = doc_freq + 1
              `;
            }
          }),
        { concurrency: 1, discard: true },
      );
    });

  const reindexRow = (message: MessageRow) =>
    Effect.gen(function* () {
      // Mid-stream text is indexed when the final message-sent event lands.
      if (message.isStreaming !== 0) {
        return;
      }
      if (message.role === "user") {
        yield* replaceEntry({
          messageId: message.messageId,
          threadId: message.threadId,
          role: "user",
          text: stripCreatePullRequestSuffix(message.text),
          createdAt: message.createdAt,
        });
        return;
      }
      if (message.role === "assistant") {
        const canonicalRows = yield* sql`
          SELECT 1 AS one FROM projection_turns
          WHERE assistant_message_id = ${message.messageId}
          LIMIT 1
        `;
        if (canonicalRows.length === 0) {
          yield* removeMessage(message.messageId);
          return;
        }
        yield* replaceEntry({
          messageId: message.messageId,
          threadId: message.threadId,
          role: "assistant",
          text: message.text,
          createdAt: message.createdAt,
        });
        return;
      }
      yield* removeMessage(message.messageId);
    });

  const reindexMessage: SearchIndexShape["reindexMessage"] = ({ messageId }) =>
    Effect.gen(function* () {
      const rows = yield* sql<MessageRow>`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          role,
          text,
          is_streaming AS "isStreaming",
          created_at AS "createdAt"
        FROM projection_thread_messages
        WHERE message_id = ${messageId}
        LIMIT 1
      `;
      const message = rows[0];
      if (message === undefined) {
        yield* removeMessage(messageId);
        return;
      }
      yield* reindexRow(message);
    }).pipe(
      Effect.mapError((error) =>
        isPersistenceError(error)
          ? error
          : toPersistenceSqlError("SearchIndex.reindexMessage:query")(error),
      ),
    );

  const reindexThread: SearchIndexShape["reindexThread"] = ({ threadId }) =>
    Effect.gen(function* () {
      const messageRows = yield* sql<MessageRow>`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          role,
          text,
          is_streaming AS "isStreaming",
          created_at AS "createdAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
      `;
      const presentIds = new Set(messageRows.map((row) => row.messageId));
      const indexedRows = yield* sql<{ readonly messageId: string }>`
        SELECT message_id AS "messageId" FROM search_index_docs WHERE thread_id = ${threadId}
      `;
      yield* Effect.forEach(
        indexedRows.filter((row) => !presentIds.has(row.messageId)),
        (row) => removeMessage(row.messageId),
        { concurrency: 1, discard: true },
      );
      yield* Effect.forEach(messageRows, reindexRow, { concurrency: 1, discard: true });
    }).pipe(
      Effect.mapError((error) =>
        isPersistenceError(error)
          ? error
          : toPersistenceSqlError("SearchIndex.reindexThread:query")(error),
      ),
    );

  return {
    reindexMessage,
    reindexThread,
  } satisfies SearchIndexShape;
});

export const SearchIndexLive = Layer.effect(SearchIndex, makeSearchIndex);
