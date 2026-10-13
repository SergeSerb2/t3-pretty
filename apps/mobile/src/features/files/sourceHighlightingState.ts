import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import {
  highlightSourceFile,
  type ReviewDiffTheme,
  type ReviewHighlightedToken,
} from "../review/shikiReviewHighlighter";

const SOURCE_HIGHLIGHT_IDLE_TTL_MS = 5 * 60_000;
const SOURCE_HIGHLIGHT_CACHE_FILES = 8;
const SOURCE_HIGHLIGHT_CACHE_CHARACTERS = 4 * 1024 * 1024;
const SOURCE_HIGHLIGHT_CACHE_NODES = 100_000;

export interface SourceHighlightInput {
  readonly path: string;
  readonly contents: string;
  readonly theme: ReviewDiffTheme;
}

export type SourceHighlightTokens = ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>>;

type SourceHighlighter = (
  input: SourceHighlightInput & { readonly signal?: AbortSignal },
) => Promise<SourceHighlightTokens>;

class SourceHighlightCacheKey extends Data.Class<SourceHighlightInput> {}

class SourceHighlightError extends Data.TaggedError("SourceHighlightError")<{
  readonly cause: unknown;
}> {}

interface CachedSourceHighlight {
  readonly contents: string;
  readonly tokens: SourceHighlightTokens;
  readonly characters: number;
  readonly nodes: number;
  expiresAt: number;
}

function makeSourceHighlightCache() {
  return {
    entries: new Map<string, CachedSourceHighlight>(),
    characters: 0,
    nodes: 0,
  };
}
type SourceHighlightCache = ReturnType<typeof makeSourceHighlightCache>;

function removeSourceHighlight(cache: SourceHighlightCache, key: string): void {
  const entry = cache.entries.get(key);
  if (!entry) return;
  cache.entries.delete(key);
  cache.characters -= entry.characters;
  cache.nodes -= entry.nodes;
}

function readSourceHighlight(cache: SourceHighlightCache, key: string, contents: string) {
  const now = Date.now();
  for (const [entryKey, entry] of cache.entries) {
    if (entry.expiresAt <= now) removeSourceHighlight(cache, entryKey);
  }
  const entry = cache.entries.get(key);
  if (!entry || entry.contents !== contents) return undefined;
  cache.entries.delete(key);
  cache.entries.set(key, entry);
  return entry;
}

function cacheSourceHighlight(
  cache: SourceHighlightCache,
  key: string,
  contents: string,
  tokens: SourceHighlightTokens,
  expiresAt: number,
): void {
  removeSourceHighlight(cache, key);
  let characters = key.length + contents.length;
  let nodes = tokens.length;
  if (characters > SOURCE_HIGHLIGHT_CACHE_CHARACTERS || nodes > SOURCE_HIGHLIGHT_CACHE_NODES)
    return;
  for (const line of tokens) {
    nodes += line.length;
    for (const token of line) characters += token.content.length;
    if (characters > SOURCE_HIGHLIGHT_CACHE_CHARACTERS || nodes > SOURCE_HIGHLIGHT_CACHE_NODES)
      return;
  }
  while (
    cache.entries.size >= SOURCE_HIGHLIGHT_CACHE_FILES ||
    cache.characters + characters > SOURCE_HIGHLIGHT_CACHE_CHARACTERS ||
    cache.nodes + nodes > SOURCE_HIGHLIGHT_CACHE_NODES
  ) {
    const oldest = cache.entries.keys().next().value;
    if (oldest === undefined) break;
    removeSourceHighlight(cache, oldest);
  }
  cache.entries.set(key, {
    contents,
    tokens,
    characters,
    nodes,
    expiresAt,
  });
  cache.characters += characters;
  cache.nodes += nodes;
}

export function createSourceHighlightAtomFamily(options?: {
  readonly highlight?: SourceHighlighter;
  readonly idleTtlMs?: number;
}) {
  const highlight = options?.highlight ?? highlightSourceFile;
  const idleTtlMs = options?.idleTtlMs ?? SOURCE_HIGHLIGHT_IDLE_TTL_MS;
  // Per-registry results outlive route remounts without retaining an atom and
  // full token graph for every file visited during the idle window.
  const cacheAtom = Atom.make(makeSourceHighlightCache).pipe(Atom.setIdleTTL(idleTtlMs));
  const family = Atom.family((request: SourceHighlightCacheKey) =>
    Atom.make((get) => {
      const cache = get(cacheAtom);
      const key = JSON.stringify([request.theme, request.path]);
      const cached = readSourceHighlight(cache, key, request.contents);
      if (cached) cached.expiresAt = Infinity;
      let currentTokens = cached?.tokens;
      let active = true;
      get.addFinalizer(() => {
        active = false;
        const retained = cache.entries.get(key);
        // A long open visit starts its idle window when the atom releases.
        if (retained?.contents === request.contents && retained.tokens === currentTokens) {
          retained.expiresAt = Date.now() + idleTtlMs;
        }
      });
      if (cached) return Effect.succeed(cached.tokens);
      return Effect.tryPromise({
        try: (signal) =>
          highlight({ ...request, signal }).then((tokens) => {
            if (active && !signal.aborted) {
              currentTokens = tokens;
              cacheSourceHighlight(cache, key, request.contents, tokens, Infinity);
            }
            return tokens;
          }),
        catch: (cause) => new SourceHighlightError({ cause }),
      });
    }).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`mobile:source-highlight:${request.theme}:${request.path}`),
    ),
  );

  return (input: SourceHighlightInput) => family(new SourceHighlightCacheKey(input));
}

export const sourceHighlightAtom = createSourceHighlightAtomFamily();
