import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffRendering";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();
const MAX_HIGHLIGHTER_CACHE_ENTRIES = 128;

function cacheHighlighterPromise(language: string, promise: Promise<DiffsHighlighter>): void {
  highlighterPromiseCache.set(language, promise);
  while (highlighterPromiseCache.size > MAX_HIGHLIGHTER_CACHE_ENTRIES) {
    const oldest = highlighterPromiseCache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    if (oldest === "text") {
      const text = highlighterPromiseCache.get(oldest);
      highlighterPromiseCache.delete(oldest);
      if (text) highlighterPromiseCache.set(oldest, text);
      continue;
    }
    highlighterPromiseCache.delete(oldest);
  }
}

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) {
    highlighterPromiseCache.delete(language);
    highlighterPromiseCache.set(language, cached);
    return cached;
  }

  let promise: Promise<DiffsHighlighter>;
  promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  })
    .catch((error) => {
      if (language === "text") throw error;
      // Language not supported by Shiki — fall back to "text".
      return getSyntaxHighlighterPromise("text");
    })
    .catch((error) => {
      if (highlighterPromiseCache.get(language) === promise) {
        highlighterPromiseCache.delete(language);
      }
      throw error;
    });
  cacheHighlighterPromise(language, promise);
  return promise;
}

export function __resetSyntaxHighlighterCacheForTests(): void {
  highlighterPromiseCache.clear();
}
