/**
 * Shared tokenizer for ranked thread search. The same normalization must run
 * over indexed documents (SearchIndex) and over query text (ThreadSearch /
 * ProjectionSnapshotQuery), or terms silently never meet.
 *
 * @module tokenizer
 */

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

/** Longer tokens are truncated so pasted hashes/ids cannot explode term rows. */
export const MAX_TERM_LENGTH = 64;
/** Pathological messages (megabyte logs) index their first tokens only. */
const MAX_TOKENS_PER_DOCUMENT = 20_000;

/**
 * Function words kept in the index for ranking, but dropped from exact AND
 * filters. Legacy search was a substring scan, so requiring "the"/"in" as
 * hard matches is a recall regression once posting lists are bounded.
 */
const STOPWORDS = new Set([
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
]);

/**
 * Lowercase Unicode letter/number tokens of length ≥ 2. No stemming: the
 * query side prefix-matches the final token, which covers typeahead without a
 * language-specific stemmer.
 */
export function tokenize(text: string): Array<string> {
  const tokens: Array<string> = [];
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    let token = match[0];
    if (token.length > MAX_TERM_LENGTH) {
      token = token.slice(0, MAX_TERM_LENGTH);
    }
    if (token.length < 2) {
      continue;
    }
    tokens.push(token);
    if (tokens.length >= MAX_TOKENS_PER_DOCUMENT) {
      break;
    }
  }
  return tokens;
}

export function termFrequencies(text: string): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokenize(text)) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

export interface RankedSearchTerms {
  /** Content terms a document must contain (AND semantics). */
  readonly exact: ReadonlyArray<string>;
  /**
   * Stopwords from the query. They contribute to BM25 when present but are
   * never required AND filters — posting lists for "the"/"in" are too common
   * to intersect safely.
   */
  readonly optional: ReadonlyArray<string>;
  /**
   * The query's final token, matched as a prefix so results refine while
   * typing. Always set: a single-token query is all prefix, and a query
   * ending on a stopword falls back to its last content term.
   */
  readonly prefix: string;
}

/**
 * Classify a raw query for the ranked index. Returns null when the query has
 * no indexable tokens (e.g. only single characters or punctuation) — callers
 * fall back to the legacy substring search for those.
 */
export function rankedSearchTerms(query: string): RankedSearchTerms | null {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) {
    return null;
  }
  const last = tokens[tokens.length - 1]!;
  const exact: Array<string> = [];
  const optional: Array<string> = [];
  for (const token of tokens.slice(0, -1)) {
    if (STOPWORDS.has(token)) {
      optional.push(token);
    } else {
      exact.push(token);
    }
  }
  // A trailing stopword is not a typeahead token: "fix the" must not require
  // a the* posting. With content terms present, the last content term takes
  // the prefix slot (already required, so nothing narrows) and the stopword
  // ranks optionally. Stopword-only queries keep the stopword as the prefix
  // so they still search.
  if (STOPWORDS.has(last) && exact.length > 0) {
    optional.push(last);
    return { exact, optional, prefix: exact[exact.length - 1]! };
  }
  return { exact, optional, prefix: last };
}
