import { useEffect, useMemo, useRef, useState } from "react";

import { pendingCodeHighlight } from "./pendingCodeHighlight";
import type {
  MarkdownCodeHighlighter,
  MarkdownHighlightedToken,
} from "./SelectableMarkdownText.types";

export type HighlightedCode = ReadonlyArray<ReadonlyArray<MarkdownHighlightedToken>>;

interface HighlightedCodeResult {
  readonly key: string;
  readonly code: string;
  readonly language: string | undefined;
  readonly theme: "light" | "dark";
  readonly tokens: HighlightedCode | null;
}

interface CachedHighlightedCode {
  readonly tokens: HighlightedCode;
  readonly characters: number;
  readonly nodes: number;
}

const highlightedCodeCache = new Map<string, CachedHighlightedCode>();
interface PendingHighlightedCode {
  readonly promise: Promise<HighlightedCode>;
  readonly controller: AbortController;
  consumers: number;
}
const highlightedCodePromiseCache = new Map<string, PendingHighlightedCode>();
const HIGHLIGHTED_CODE_CACHE_LIMIT = 64;
const HIGHLIGHTED_CODE_CACHE_CHARACTERS = 4 * 1024 * 1024;
const HIGHLIGHTED_CODE_CACHE_NODES = 100_000;
let cachedCharacters = 0;
let cachedNodes = 0;

function codeHighlightCacheKey(
  code: string,
  language: string | undefined,
  theme: "light" | "dark",
): string {
  return `${theme}:${language ?? "text"}:${code}`;
}

function cacheHighlightedCode(key: string, tokens: HighlightedCode): void {
  removeCachedHighlightedCode(key);
  let characters = key.length;
  let nodes = tokens.length;
  if (characters > HIGHLIGHTED_CODE_CACHE_CHARACTERS || nodes > HIGHLIGHTED_CODE_CACHE_NODES)
    return;
  for (const line of tokens) {
    nodes += line.length;
    for (const token of line) characters += token.content.length;
    if (characters > HIGHLIGHTED_CODE_CACHE_CHARACTERS || nodes > HIGHLIGHTED_CODE_CACHE_NODES) {
      return;
    }
  }

  while (
    highlightedCodeCache.size >= HIGHLIGHTED_CODE_CACHE_LIMIT ||
    cachedCharacters + characters > HIGHLIGHTED_CODE_CACHE_CHARACTERS ||
    cachedNodes + nodes > HIGHLIGHTED_CODE_CACHE_NODES
  ) {
    const oldestKey = highlightedCodeCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    removeCachedHighlightedCode(oldestKey);
  }
  highlightedCodeCache.set(key, { tokens, characters, nodes });
  cachedCharacters += characters;
  cachedNodes += nodes;
}

function removeCachedHighlightedCode(key: string): void {
  const cached = highlightedCodeCache.get(key);
  if (!cached) return;
  highlightedCodeCache.delete(key);
  cachedCharacters -= cached.characters;
  cachedNodes -= cached.nodes;
}

function touchCachedHighlightedCode(key: string): void {
  const cached = highlightedCodeCache.get(key);
  if (!cached) return;
  highlightedCodeCache.delete(key);
  highlightedCodeCache.set(key, cached);
}

function loadHighlightedCode(
  code: string,
  language: string | undefined,
  theme: "light" | "dark",
  highlightCode: MarkdownCodeHighlighter,
  session: object,
): { readonly promise: Promise<HighlightedCode>; readonly release: () => void } {
  const key = codeHighlightCacheKey(code, language, theme);
  const cached = highlightedCodeCache.get(key);
  if (cached) {
    return { promise: Promise.resolve(cached.tokens), release: () => undefined };
  }

  let pending = highlightedCodePromiseCache.get(key);
  if (!pending) {
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return highlightCode({ code, language, theme, session, signal: controller.signal });
      })
      .then((tokens) => {
        if (!controller.signal.aborted) cacheHighlightedCode(key, tokens);
        return tokens;
      })
      .finally(() => {
        if (highlightedCodePromiseCache.get(key)?.promise === promise) {
          highlightedCodePromiseCache.delete(key);
        }
      });
    pending = { promise, controller, consumers: 0 };
    highlightedCodePromiseCache.set(key, pending);
  }
  const job = pending;
  job.consumers += 1;
  return {
    promise: job.promise,
    release: () => {
      job.consumers -= 1;
      if (job.consumers !== 0) return;
      if (highlightedCodePromiseCache.get(key) === job) highlightedCodePromiseCache.delete(key);
      job.controller.abort();
    },
  };
}

/**
 * Tokens for a code block, or null while nothing usable exists yet. A cached or
 * synchronous result renders in the same pass. Otherwise the most recent
 * completed result seeds `pendingCodeHighlight` so finished lines keep their
 * colors while the asynchronous highlighter catches up.
 */
export function useHighlightedCode(
  code: string,
  language: string | undefined,
  theme: "light" | "dark",
  highlightCode: MarkdownCodeHighlighter,
): HighlightedCode | null {
  const [session] = useState(() => ({}));
  const key = codeHighlightCacheKey(code, language, theme);
  const ready = useMemo(
    () =>
      highlightedCodeCache.get(key)?.tokens ??
      highlightCode.read?.({ code, language, theme, session }),
    [code, language, theme, key, highlightCode, session],
  );
  const [highlighted, setHighlighted] = useState<HighlightedCodeResult>(() => ({
    code,
    language,
    theme,
    key,
    tokens: highlightedCodeCache.get(key)?.tokens ?? null,
  }));
  // Synchronous reads never touch state, so each append costs one render. The
  // ref remembers the newest of them, and is cleared whenever an asynchronous
  // result commits so `highlighted` is the baseline again from then on.
  const latestRead = useRef<HighlightedCodeResult | null>(null);

  useEffect(() => {
    if (ready) {
      touchCachedHighlightedCode(key);
      latestRead.current = { code, language, theme, key, tokens: ready };
      return;
    }
    let active = true;
    const commit = (tokens: HighlightedCode | null) => {
      latestRead.current = null;
      setHighlighted({ code, language, theme, key, tokens });
    };
    const cached = highlightedCodeCache.get(key);
    if (cached) {
      touchCachedHighlightedCode(key);
      commit(cached.tokens);
      return () => {
        active = false;
      };
    }

    const pending = loadHighlightedCode(code, language, theme, highlightCode, session);
    void pending.promise
      .then((tokens) => {
        if (active) {
          commit(tokens);
        }
      })
      .catch(() => {
        if (active) {
          commit(null);
        }
      });
    return () => {
      active = false;
      pending.release();
    };
  }, [code, highlightCode, key, language, theme, ready, session]);

  if (ready) return ready;
  // oxlint-disable-next-line react/refs -- Written only after commit; a discarded render never advances it.
  const baseline = latestRead.current ?? highlighted;
  if (baseline.key === key) return baseline.tokens;
  if (baseline.tokens && baseline.language === language && baseline.theme === theme) {
    return pendingCodeHighlight(baseline.code, code, baseline.tokens);
  }
  return null;
}
