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
  /** Terms a document must contain (AND semantics). */
  readonly exact: ReadonlyArray<string>;
  /**
   * The query's final token, matched as a prefix so results refine while
   * typing. Always set: a single-token query is all prefix.
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
  const prefix = tokens[tokens.length - 1]!;
  return { exact: tokens.slice(0, -1), prefix };
}
