/**
 * ThreadSearch - ranked thread search over the inverted index.
 *
 * Query side of migration 049's plain-table index: content terms intersect
 * (AND semantics) from complete posting lists, stopwords and truncated
 * common terms rank without filtering, the query's final token
 * prefix-matches (typeahead), and candidates are scored with BM25 in JS.
 * Runs on plain tables because the production SQLite driver (node:sqlite)
 * ships without FTS5.
 *
 * Result shape and bounds match the legacy substring search: one match per
 * thread, active threads/projects only, `request.limit` (≤ 50) rows out.
 *
 * @module ThreadSearch
 */
import {
  OrchestrationSearchThreadsResult,
  type OrchestrationSearchThreadsInput,
} from "@t3tools/contracts";
import { stripCreatePullRequestSuffix } from "@t3tools/shared/createPullRequestPrompt";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../persistence/Errors.ts";
import type { RankedSearchTerms } from "./tokenizer.ts";

/** Fetches per exact term / expansion term, and the pre-scoring candidate
 * cap. The SQLite client is synchronous and single-connection; every read
 * here is bounded so a search cannot monopolize it. Truncated lists are
 * ranking-only: AND uses complete lists, or a candidate-scoped lookup. */
export const PER_TERM_POSTINGS_LIMIT = 2_000;
const PREFIX_EXPANSION_LIMIT = 25;
const PER_EXPANSION_POSTINGS_LIMIT = 1_000;
const MAX_CANDIDATES = 500;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const decodeSearchThreadsResult = Schema.decodeUnknownEffect(OrchestrationSearchThreadsResult);

export interface ThreadSearchShape {
  /**
   * Ranked index search. Callers fall back to the legacy substring search
   * when the query has no indexable terms (see `rankedSearchTerms`).
   */
  readonly searchThreads: (input: {
    readonly request: OrchestrationSearchThreadsInput;
    readonly terms: RankedSearchTerms;
  }) => Effect.Effect<OrchestrationSearchThreadsResult, ProjectionRepositoryError>;
}

export class ThreadSearch extends Context.Service<ThreadSearch, ThreadSearchShape>()(
  "t3/search/ThreadSearch",
) {}

// Same ASCII-only fold the legacy snippet builder uses; duplicated so this
// module stays decoupled from the 3000-line snapshot query.
function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** Snippet window centered on the earliest matched term, mirroring the
 * legacy builder's 240-char shape. */
function buildRankedSnippet(text: string, terms: RankedSearchTerms, rawQuery: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= 240) {
    return normalizedText;
  }

  const foldedText = foldAsciiCase(normalizedText);
  let matchIndex = -1;
  for (const term of [...terms.exact, terms.prefix]) {
    const index = foldedText.indexOf(foldAsciiCase(term));
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
    }
  }
  if (matchIndex === -1) {
    matchIndex = foldedText.indexOf(foldAsciiCase(rawQuery.replace(/\s+/g, " ").trim()));
  }
  if (matchIndex === -1) {
    matchIndex = 0;
  }

  const bodyLength = 236;
  const idealStart = Math.max(0, matchIndex - 72);
  const start = Math.min(idealStart, normalizedText.length - bodyLength);
  const end = Math.min(normalizedText.length, start + bodyLength);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

interface PostingRow {
  readonly messageId: string;
  readonly tf: number;
}

interface ScoringGroup {
  readonly df: number;
  readonly postings: ReadonlyMap<string, number>;
}

interface CandidateDoc {
  readonly messageId: string;
  readonly threadId: string;
  readonly role: "user" | "assistant";
  readonly tokenCount: number;
  readonly createdAt: string;
}

const makeThreadSearch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const fetchPostings = (term: string, limit: number) =>
    sql<PostingRow>`
      SELECT postings.message_id AS "messageId", postings.tf
      FROM search_index_postings AS postings
      INNER JOIN search_index_docs AS docs
        ON docs.message_id = postings.message_id
      INNER JOIN projection_threads AS threads
        ON threads.thread_id = docs.thread_id
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE postings.term = ${term}
        AND threads.deleted_at IS NULL
        AND threads.archived_at IS NULL
        AND projects.deleted_at IS NULL
      LIMIT ${limit}
    `;

  const fetchPostingsForCandidates = (term: string, messageIds: ReadonlyArray<string>) =>
    sql<PostingRow>`
      SELECT message_id AS "messageId", tf
      FROM search_index_postings
      WHERE term = ${term}
        AND ${sql.in("message_id", messageIds)}
    `;

  const fetchPrefixPostingsForCandidates = (prefix: string, messageIds: ReadonlyArray<string>) =>
    sql<PostingRow>`
      SELECT message_id AS "messageId", SUM(tf) AS "tf"
      FROM search_index_postings
      WHERE term GLOB ${`${prefix}*`}
        AND ${sql.in("message_id", messageIds)}
      GROUP BY message_id
    `;

  const postingMap = (rows: ReadonlyArray<PostingRow>) =>
    new Map(rows.map((row) => [row.messageId, row.tf] as const));

  const searchThreadsRanked = (input: {
    readonly request: OrchestrationSearchThreadsInput;
    readonly terms: RankedSearchTerms;
  }) =>
    Effect.gen(function* () {
      const { request, terms } = input;
      const limit = request.limit ?? 50;

      const groups: Array<ScoringGroup> = [];
      const optionalTerms: Array<{ readonly term: string; readonly df: number }> = [];

      // Exact content terms: complete posting lists AND, truncated lists rank
      // only. A LIMIT without ORDER BY is an arbitrary sample — intersecting
      // it drops true hits for any term that appears in more than `limit`
      // active messages.
      for (const term of terms.exact) {
        const dfRows = yield* sql<{ readonly df: number }>`
          SELECT doc_freq AS "df" FROM search_index_terms WHERE term = ${term}
        `;
        const df = dfRows[0]?.df;
        if (df === undefined) {
          return { matches: [] } as const;
        }
        const postingRows = yield* fetchPostings(term, PER_TERM_POSTINGS_LIMIT + 1);
        if (postingRows.length === 0) {
          return { matches: [] } as const;
        }
        if (postingRows.length > PER_TERM_POSTINGS_LIMIT) {
          optionalTerms.push({ term, df });
        } else {
          groups.push({ df, postings: postingMap(postingRows) });
        }
      }

      for (const term of terms.optional) {
        const dfRows = yield* sql<{ readonly df: number }>`
          SELECT doc_freq AS "df" FROM search_index_terms WHERE term = ${term}
        `;
        const df = dfRows[0]?.df;
        if (df !== undefined) {
          optionalTerms.push({ term, df });
        }
      }

      // Prefix group: the query's final token matches any term it prefixes.
      // Tokenizer output is alphanumeric, so the GLOB pattern needs no escaping.
      const expansionLimitRows = yield* sql<{ readonly term: string; readonly df: number }>`
        SELECT term, doc_freq AS "df"
        FROM search_index_terms
        WHERE term GLOB ${`${terms.prefix}*`}
        ORDER BY doc_freq ASC
        LIMIT ${PREFIX_EXPANSION_LIMIT}
      `;
      let expansionRows = [...expansionLimitRows];
      if (!expansionRows.some((row) => row.term === terms.prefix)) {
        const exactPrefixRows = yield* sql<{ readonly term: string; readonly df: number }>`
          SELECT term, doc_freq AS "df"
          FROM search_index_terms
          WHERE term = ${terms.prefix}
        `;
        const exactPrefix = exactPrefixRows[0];
        if (exactPrefix !== undefined) {
          expansionRows = [exactPrefix, ...expansionRows];
        }
      }
      if (expansionRows.length === 0) {
        return { matches: [] } as const;
      }
      const prefixPostings = new Map<string, number>();
      let prefixTruncated = expansionLimitRows.length === PREFIX_EXPANSION_LIMIT;
      for (const expansion of expansionRows) {
        const postingRows = yield* fetchPostings(expansion.term, PER_EXPANSION_POSTINGS_LIMIT + 1);
        const truncated = postingRows.length > PER_EXPANSION_POSTINGS_LIMIT;
        if (truncated) {
          prefixTruncated = true;
        }
        const expansionPostings = truncated
          ? postingRows.slice(0, PER_EXPANSION_POSTINGS_LIMIT)
          : postingRows;
        for (const row of expansionPostings) {
          prefixPostings.set(row.messageId, (prefixPostings.get(row.messageId) ?? 0) + row.tf);
        }
      }
      // Unique matching docs, not the sum of expansion DFs: overlapping
      // expansions (sear/search/searching) would otherwise inflate df and
      // collapse prefix IDF. When the union is truncated, max expansion df
      // is the better lower bound on collection DF.
      const prefixDf = prefixTruncated
        ? Math.max(prefixPostings.size, ...expansionRows.map((row) => row.df))
        : prefixPostings.size;
      const prefixAsRequired = !prefixTruncated || groups.length === 0;
      if (prefixAsRequired) {
        if (prefixPostings.size === 0) {
          return { matches: [] } as const;
        }
        groups.push({ df: prefixDf, postings: prefixPostings });
      }

      if (groups.length === 0) {
        return { matches: [] } as const;
      }

      // Intersect required groups, rarest first so the working set shrinks early.
      const sortedGroups = [...groups].toSorted(
        (left, right) => left.postings.size - right.postings.size,
      );
      let candidateIds = new Set(sortedGroups[0]!.postings.keys());
      for (const group of sortedGroups.slice(1)) {
        candidateIds = new Set([...candidateIds].filter((id) => group.postings.has(id)));
        if (candidateIds.size === 0) {
          return { matches: [] } as const;
        }
      }

      // Truncated prefix still has to match, but against the required-term
      // candidate set rather than an arbitrary posting sample.
      if (!prefixAsRequired) {
        const prefixRows = yield* fetchPrefixPostingsForCandidates(terms.prefix, [...candidateIds]);
        if (prefixRows.length === 0) {
          return { matches: [] } as const;
        }
        groups.push({ df: prefixDf, postings: postingMap(prefixRows) });
        candidateIds = new Set(prefixRows.map((row) => row.messageId));
      }

      // Bound the scoring set when a common term matched broadly.
      let candidates = [...candidateIds];
      if (candidates.length > MAX_CANDIDATES) {
        const tfOf = (id: string) =>
          groups.reduce((total, group) => total + (group.postings.get(id) ?? 0), 0);
        candidates = candidates
          .toSorted((left, right) => tfOf(right) - tfOf(left))
          .slice(0, MAX_CANDIDATES);
      }

      for (const { term, df } of optionalTerms) {
        const postingRows = yield* fetchPostingsForCandidates(term, candidates);
        if (postingRows.length === 0) {
          continue;
        }
        groups.push({ df, postings: postingMap(postingRows) });
      }

      const statsRows = yield* sql<{ readonly docCount: number; readonly avgTokenCount: number }>`
        SELECT COUNT(*) AS "docCount", COALESCE(AVG(token_count), 0) AS "avgTokenCount"
        FROM search_index_docs
      `;
      const docCount = Math.max(statsRows[0]?.docCount ?? 0, 1);
      const avgTokenCount = Math.max(statsRows[0]?.avgTokenCount ?? 0, 1);

      const candidateDocs = yield* Effect.forEach(
        candidates,
        (messageId) =>
          sql<CandidateDoc>`
            SELECT
              message_id AS "messageId",
              thread_id AS "threadId",
              role,
              token_count AS "tokenCount",
              created_at AS "createdAt"
            FROM search_index_docs
            WHERE message_id = ${messageId}
          `,
        { concurrency: 1 },
      );

      const idf = (df: number) => {
        const clampedDf = Math.min(df, docCount);
        return Math.log(1 + (docCount - clampedDf + 0.5) / (clampedDf + 0.5));
      };
      const scoreOf = (doc: CandidateDoc) => {
        let score = 0;
        for (const group of groups) {
          const tf = group.postings.get(doc.messageId) ?? 0;
          if (tf === 0) {
            continue;
          }
          score +=
            (idf(group.df) * (tf * (BM25_K1 + 1))) /
            (tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.tokenCount) / avgTokenCount));
        }
        return score;
      };

      // One match per thread: best-scoring message wins; ties prefer user
      // messages (the legacy match_rank), then recency.
      const bestByThread = new Map<string, { doc: CandidateDoc; score: number }>();
      for (const rows of candidateDocs) {
        const doc = rows[0];
        if (doc === undefined) {
          continue;
        }
        const score = scoreOf(doc);
        const existing = bestByThread.get(doc.threadId);
        const isBetter =
          existing === undefined ||
          score > existing.score ||
          (score === existing.score &&
            (doc.role !== existing.doc.role
              ? doc.role === "user"
              : doc.createdAt !== existing.doc.createdAt
                ? doc.createdAt > existing.doc.createdAt
                : doc.messageId < existing.doc.messageId));
        if (isBetter) {
          bestByThread.set(doc.threadId, { doc, score });
        }
      }

      // Rank before slicing so recency-tied threads are not dropped when more
      // than `limit` threads share a BM25 score. The final sort below uses
      // the same keys after fetching snippets.
      const rankedThreads = [...bestByThread.entries()];
      const threadTimeRows =
        rankedThreads.length === 0
          ? []
          : yield* sql<{ readonly threadId: string; readonly threadUpdatedAt: string }>`
              SELECT thread_id AS "threadId", updated_at AS "threadUpdatedAt"
              FROM projection_threads
              WHERE ${sql.in(
                "thread_id",
                rankedThreads.map(([threadId]) => threadId),
              )}
            `;
      const threadUpdatedAt = new Map(
        threadTimeRows.map((row) => [row.threadId, row.threadUpdatedAt] as const),
      );
      const compareThreadRank = (
        left: { readonly threadId: string; readonly score: number },
        right: { readonly threadId: string; readonly score: number },
      ) =>
        right.score - left.score ||
        (threadUpdatedAt.get(right.threadId) ?? "").localeCompare(
          threadUpdatedAt.get(left.threadId) ?? "",
        ) ||
        left.threadId.localeCompare(right.threadId);
      const winners = rankedThreads
        .toSorted((left, right) =>
          compareThreadRank(
            { threadId: left[0], score: left[1].score },
            { threadId: right[0], score: right[1].score },
          ),
        )
        .slice(0, limit)
        .map(([, winner]) => winner);

      const matchRows = yield* Effect.forEach(
        winners,
        ({ doc, score }) =>
          Effect.gen(function* () {
            const detailRows = yield* sql<{
              readonly projectId: string;
              readonly threadUpdatedAt: string;
              readonly text: string;
            }>`
              SELECT
                threads.project_id AS "projectId",
                threads.updated_at AS "threadUpdatedAt",
                messages.text AS "text"
              FROM projection_threads AS threads
              INNER JOIN projection_thread_messages AS messages
                ON messages.message_id = ${doc.messageId}
              WHERE threads.thread_id = ${doc.threadId}
              LIMIT 1
            `;
            const detail = detailRows[0];
            if (detail === undefined) {
              return null;
            }
            // Indexed user text is already marker-stripped; strip again so a
            // non-trailing hidden block can never leak into a snippet.
            const visibleText =
              doc.role === "user" ? stripCreatePullRequestSuffix(detail.text) : detail.text;
            return {
              threadId: doc.threadId,
              projectId: detail.projectId,
              source: doc.role,
              snippet: buildRankedSnippet(visibleText, terms, request.query),
              messageCreatedAt: doc.createdAt,
              score: Math.round(score * 1000) / 1000,
              threadUpdatedAt: detail.threadUpdatedAt,
            };
          }),
        { concurrency: 1 },
      );

      const matches = matchRows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .toSorted(
          (left, right) =>
            right.score - left.score ||
            right.threadUpdatedAt.localeCompare(left.threadUpdatedAt) ||
            left.threadId.localeCompare(right.threadId),
        )
        .map(({ threadUpdatedAt: _threadUpdatedAt, ...match }) => match);

      return yield* decodeSearchThreadsResult({
        matches,
      }).pipe(Effect.mapError(toPersistenceDecodeError("ThreadSearch.searchThreads:decodeResult")));
    });

  const searchThreads: ThreadSearchShape["searchThreads"] = Effect.fn("ThreadSearch.searchThreads")(
    (input) =>
      searchThreadsRanked(input).pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("ThreadSearch.searchThreads:query")(error),
        ),
      ),
  );

  return { searchThreads } satisfies ThreadSearchShape;
});

export const ThreadSearchLive = Layer.effect(ThreadSearch, makeThreadSearch);
