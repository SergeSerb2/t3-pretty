import type {
  DirItem,
  DirSearchResult,
  FileItem,
  FileFinder,
  GrepCursor,
  MixedItem,
  MixedSearchResult,
  Result,
  SearchResult,
} from "@ff-labs/fff-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Schema from "effect/Schema";

import {
  PROJECT_PATH_MAX_LENGTH,
  PROJECT_LIST_ENTRIES_MAX,
  PROJECT_LIST_ENTRIES_TOTAL_PATH_CHARS_MAX,
  PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH,
  PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX,
  PROJECT_SEARCH_CONTENT_REGEX_ERROR_MAX_LENGTH,
  PROJECT_SEARCH_CONTENT_TOTAL_LINE_CHARS_MAX,
  PROJECT_SEARCH_CONTENT_TOTAL_MATCH_RANGES_MAX,
  PROJECT_SEARCH_CONTENT_TOTAL_PATH_CHARS_MAX,
  type ProjectContentMatchRange,
  type ProjectEntry,
  type ProjectEntryKind,
  type ProjectListEntriesResult,
  type ProjectSearchContentsInput,
  type ProjectSearchContentsResult,
  type ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

const WORKSPACE_INDEX_MAX_ENTRIES = PROJECT_LIST_ENTRIES_MAX;
const WORKSPACE_INDEX_PAGE_SIZE = WORKSPACE_INDEX_MAX_ENTRIES + 2;
const WORKSPACE_INDEX_SCAN_TIMEOUT = "15 seconds";
const WORKSPACE_INDEX_SCAN_TIMEOUT_MS = 15_000;
const WORKSPACE_INDEX_IDLE_TTL = "15 minutes";
const CONTENT_SEARCH_TIME_BUDGET_MS = 250;
const CONTENT_SEARCH_MAX_MATCHES_PER_FILE = 100;

export class WorkspaceSearchIndexCreateFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexCreateFailed>()(
  "WorkspaceSearchIndexCreateFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to create the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexScanTimedOut extends Schema.TaggedErrorClass<WorkspaceSearchIndexScanTimedOut>()(
  "WorkspaceSearchIndexScanTimedOut",
  {
    cwd: Schema.String,
    timeout: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace search index for '${this.cwd}' did not finish scanning within ${this.timeout}`;
  }
}

export class WorkspaceSearchIndexSearchFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexSearchFailed>()(
  "WorkspaceSearchIndexSearchFailed",
  {
    cwd: Schema.String,
    queryLength: Schema.Number,
    pageSize: Schema.Number,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace search failed for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexRefreshFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexRefreshFailed>()(
  "WorkspaceSearchIndexRefreshFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to refresh the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexDestroyFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexDestroyFailed>()(
  "WorkspaceSearchIndexDestroyFailed",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to destroy the workspace search index for '${this.cwd}'.`;
  }
}

export type WorkspaceSearchIndexError =
  | WorkspaceSearchIndexCreateFailed
  | WorkspaceSearchIndexScanTimedOut
  | WorkspaceSearchIndexSearchFailed
  | WorkspaceSearchIndexRefreshFailed;

export class WorkspaceSearchIndex extends Context.Service<
  WorkspaceSearchIndex,
  {
    readonly list: () => Effect.Effect<ProjectListEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly search: (
      query: string,
      limit: number,
      kind?: ProjectEntryKind,
      imageOnly?: boolean,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly searchContents: (
      input: Omit<ProjectSearchContentsInput, "cwd">,
    ) => Effect.Effect<ProjectSearchContentsResult, WorkspaceSearchIndexSearchFailed>;
    readonly refresh: () => Effect.Effect<
      void,
      WorkspaceSearchIndexRefreshFailed | WorkspaceSearchIndexScanTimedOut
    >;
  }
>()("t3/workspace/WorkspaceSearchIndex") {}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function trimDirectorySeparator(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? undefined : input.slice(0, separatorIndex);
}

function toProjectEntry(item: MixedItem): ProjectEntry | null {
  const normalizedPath = trimDirectorySeparator(toPosixPath(item.item.relativePath));
  if (!normalizedPath || normalizedPath.length > PROJECT_PATH_MAX_LENGTH) {
    return null;
  }

  return {
    path: normalizedPath,
    kind: item.type,
  };
}

function toFileEntry(item: FileItem): ProjectEntry | null {
  const normalizedPath = trimDirectorySeparator(toPosixPath(item.relativePath));
  return normalizedPath && normalizedPath.length <= PROJECT_PATH_MAX_LENGTH
    ? { path: normalizedPath, kind: "file" }
    : null;
}

function toDirectoryEntry(item: DirItem): ProjectEntry | null {
  const normalizedPath = trimDirectorySeparator(toPosixPath(item.relativePath));
  return normalizedPath && normalizedPath.length <= PROJECT_PATH_MAX_LENGTH
    ? { path: normalizedPath, kind: "directory" }
    : null;
}

function mapFileSearchResult(
  result: SearchResult,
  limit: number,
  imageOnly = false,
): ProjectSearchEntriesResult {
  let skippedInvalidPath = false;
  const entries = result.items.flatMap((item) => {
    const entry = toFileEntry(item);
    if (!entry) {
      skippedInvalidPath = true;
      return [];
    }
    return !imageOnly || isWorkspaceImagePreviewPath(entry.path) ? [entry] : [];
  });
  return {
    entries: entries.slice(0, limit),
    truncated:
      skippedInvalidPath || entries.length > limit || result.totalMatched > result.items.length,
  };
}

function mapDirectorySearchResult(
  result: DirSearchResult,
  limit: number,
): ProjectSearchEntriesResult {
  const entries = result.items.flatMap((item) => {
    const entry = toDirectoryEntry(item);
    return entry ? [entry] : [];
  });
  const rootDirectoryCount = result.items.some((item) => item.relativePath.length === 0) ? 1 : 0;
  return {
    entries: entries.slice(0, limit),
    truncated:
      entries.length < result.items.length - rootDirectoryCount ||
      result.totalMatched - rootDirectoryCount > limit,
  };
}

function mapMixedSearchResult(
  result: MixedSearchResult,
  limit: number,
): { readonly entries: ProjectEntry[]; readonly truncated: boolean } {
  const entries: ProjectEntry[] = [];
  let skippedInvalidPath = false;
  for (const item of result.items) {
    const entry = toProjectEntry(item);
    if (entry) {
      entries.push(entry);
    } else if (!(item.type === "directory" && item.item.relativePath.length === 0)) {
      skippedInvalidPath = true;
    }
    if (entries.length >= limit) {
      break;
    }
  }

  const rootDirectoryCount = result.items.some(
    (item) => item.type === "directory" && item.item.relativePath.length === 0,
  )
    ? 1
    : 0;
  return {
    entries,
    truncated: skippedInvalidPath || result.totalMatched - rootDirectoryCount > limit,
  };
}

const WORD_CHARACTER = /[\p{Letter}\p{Mark}\p{Number}_]/u;

function codePointAt(line: string, index: number): string | undefined {
  const codePoint = line.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function codePointBefore(line: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const previousCodeUnit = line.charCodeAt(index - 1);
  const previousIndex =
    previousCodeUnit >= 0xdc00 && previousCodeUnit <= 0xdfff ? index - 2 : index - 1;
  return codePointAt(line, previousIndex);
}

function buildContentSearchQuery(input: Omit<ProjectSearchContentsInput, "cwd">): {
  readonly searchQuery: string;
  readonly regexMode: boolean;
} {
  if (input.caseSensitive) {
    return { searchQuery: input.query, regexMode: input.useRegex };
  }
  // Plain mode relies on smart case: an all-lowercase needle matches
  // case-insensitively. Regex mode needs an explicit inline flag instead.
  return input.useRegex
    ? { searchQuery: `(?i)${input.query}`, regexMode: true }
    : { searchQuery: input.query.toLowerCase(), regexMode: false };
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function mapContentMatchRanges(
  line: string,
  byteRanges: ReadonlyArray<readonly [number, number]>,
): Array<{ readonly start: number; readonly end: number }> {
  const boundaries = [
    ...new Set(byteRanges.flatMap(([start, end]) => [Math.max(0, start), Math.max(0, end)])),
  ].toSorted((left, right) => left - right);
  const stringIndexByByteOffset = new Map<number, number>();
  let boundaryIndex = 0;
  let byteOffset = 0;
  let stringIndex = 0;

  while (stringIndex < line.length && boundaryIndex < boundaries.length) {
    while (boundaries[boundaryIndex] !== undefined && boundaries[boundaryIndex]! <= byteOffset) {
      stringIndexByByteOffset.set(boundaries[boundaryIndex]!, stringIndex);
      boundaryIndex += 1;
    }
    if (boundaryIndex >= boundaries.length) break;
    const codePoint = line.codePointAt(stringIndex)!;
    const nextByteOffset = byteOffset + utf8ByteLength(codePoint);
    while (boundaries[boundaryIndex] !== undefined && boundaries[boundaryIndex]! < nextByteOffset) {
      stringIndexByByteOffset.set(boundaries[boundaryIndex]!, stringIndex);
      boundaryIndex += 1;
    }
    byteOffset = nextByteOffset;
    stringIndex += codePoint > 0xffff ? 2 : 1;
  }
  while (boundaryIndex < boundaries.length) {
    stringIndexByByteOffset.set(boundaries[boundaryIndex]!, line.length);
    boundaryIndex += 1;
  }

  return byteRanges.map(([startByte, endByte]) => ({
    start: stringIndexByByteOffset.get(Math.max(0, startByte)) ?? line.length,
    end: stringIndexByByteOffset.get(Math.max(0, endByte)) ?? line.length,
  }));
}

export function boundContentMatchLine(
  line: string,
  ranges: ReadonlyArray<ProjectContentMatchRange>,
  maxLength = PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH,
): {
  readonly lineContent: string;
  readonly matchRanges: ProjectContentMatchRange[];
  readonly truncated: boolean;
} {
  const boundedMaxLength = Math.max(1, Math.floor(maxLength));
  if (line.length <= boundedMaxLength) {
    return {
      lineContent: line,
      matchRanges: ranges
        .flatMap((range) => {
          const start = Math.max(0, Math.min(line.length, range.start));
          const end = Math.max(0, Math.min(line.length, range.end));
          return end < start ? [] : [{ start, end }];
        })
        .slice(0, PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX),
      truncated: ranges.length > PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX,
    };
  }

  const anchor = ranges[0] ?? { start: 0, end: 0 };
  const anchorStart = Math.max(0, Math.min(line.length, anchor.start));
  const anchorEnd = Math.max(anchorStart, Math.min(line.length, anchor.end));
  const anchorWidth = Math.min(boundedMaxLength, anchorEnd - anchorStart);
  const maximumStart = line.length - boundedMaxLength;
  const windowStart = Math.max(
    0,
    Math.min(maximumStart, anchorStart - Math.floor((boundedMaxLength - anchorWidth) / 2)),
  );
  const windowEnd = windowStart + boundedMaxLength;
  const matchRanges = ranges
    .flatMap((range) => {
      const start = Math.max(0, Math.min(line.length, range.start));
      const end = Math.max(start, Math.min(line.length, range.end));
      if (end < windowStart || start > windowEnd) return [];
      return [
        {
          start: Math.max(start, windowStart) - windowStart,
          end: Math.min(end, windowEnd) - windowStart,
        },
      ];
    })
    .slice(0, PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX);

  return {
    lineContent: line.slice(windowStart, windowEnd),
    matchRanges,
    truncated: true,
  };
}

/**
 * Whole-word filtering happens after the grep rather than by wrapping the
 * pattern in boundary regex: consuming boundaries such as `(?:^|\W)` swallow
 * the separator between adjacent matches and widen the reported ranges, and
 * `\b` cannot match punctuation-edged queries at all. Matching VS Code, a
 * match edge is a word boundary when it touches the line edge, the
 * neighbouring character is not a word character, or the match's own edge
 * character is not a word character.
 */
function isWholeWordRange(
  line: string,
  range: { readonly start: number; readonly end: number },
): boolean {
  if (range.end <= range.start) return false;
  const isWord = (character: string | undefined) =>
    character !== undefined && WORD_CHARACTER.test(character);
  const leftIsBoundary =
    range.start === 0 ||
    !isWord(codePointBefore(line, range.start)) ||
    !isWord(codePointAt(line, range.start));
  const rightIsBoundary =
    range.end >= line.length ||
    !isWord(codePointAt(line, range.end)) ||
    !isWord(codePointBefore(line, range.end));
  return leftIsBoundary && rightIsBoundary;
}

function withDirectoryAncestors(entries: ReadonlyArray<ProjectEntry>): ProjectEntry[] {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    let parentPath = parentPathOf(entry.path);
    while (parentPath) {
      if (!entryByPath.has(parentPath)) {
        entryByPath.set(parentPath, { path: parentPath, kind: "directory" });
      }
      parentPath = parentPathOf(parentPath);
    }
  }
  return [...entryByPath.values()];
}

function boundProjectListEntries(entries: ReadonlyArray<ProjectEntry>): {
  readonly entries: ProjectEntry[];
  readonly truncated: boolean;
} {
  const bounded: ProjectEntry[] = [];
  let totalPathCharacters = 0;
  for (const entry of entries) {
    const nextTotalPathCharacters = totalPathCharacters + entry.path.length;
    if (
      bounded.length >= PROJECT_LIST_ENTRIES_MAX ||
      nextTotalPathCharacters > PROJECT_LIST_ENTRIES_TOTAL_PATH_CHARS_MAX
    ) {
      return { entries: bounded, truncated: true };
    }
    bounded.push(entry);
    totalPathCharacters = nextTotalPathCharacters;
  }
  return { entries: bounded, truncated: false };
}

const loadFffNode = () => import("@ff-labs/fff-node");

const createFinder = Effect.fn("WorkspaceSearchIndex.createFinder")(function* (
  cwd: string,
  variant: WorkspaceSearchIndexVariant,
) {
  const { FileFinder } = yield* Effect.tryPromise({
    try: () => loadFffNode(),
    catch: (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.create threw unexpectedly.",
        cause,
      }),
  });
  const result = yield* Effect.try({
    try: () =>
      FileFinder.create({
        basePath: cwd,
        disableMmapCache: true,
        // Content indexing costs scan CPU and memory, so only the on-demand
        // content-search index pays for it; path-only consumers (file tree,
        // composer path search, file picker) keep the lightweight index.
        disableContentIndexing: variant !== "content",
        aiMode: false,
        enableFsRootScanning: true,
        enableHomeDirScanning: true,
      }),
    catch: (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.create threw unexpectedly.",
        cause,
      }),
  });
  if (result.ok) return result.value;
  return yield* new WorkspaceSearchIndexCreateFailed({
    cwd,
    reason: result.error,
  });
});

const waitForIndexReady = Effect.fn("WorkspaceSearchIndex.waitForIndexReady")(function* <E>(
  cwd: string,
  finder: FileFinder,
  onFailure: (input: { readonly reason: string; readonly cause?: unknown }) => E,
): Effect.fn.Return<void, E | WorkspaceSearchIndexScanTimedOut> {
  const result = yield* Effect.tryPromise({
    try: () => finder.waitForIndexReady(WORKSPACE_INDEX_SCAN_TIMEOUT_MS),
    catch: (cause) =>
      onFailure({
        reason: "FileFinder.waitForIndexReady rejected unexpectedly.",
        cause,
      }),
  });
  if (!result.ok) {
    return yield* Effect.fail(onFailure({ reason: result.error }));
  }
  if (!result.value) {
    return yield* new WorkspaceSearchIndexScanTimedOut({
      cwd,
      timeout: WORKSPACE_INDEX_SCAN_TIMEOUT,
    });
  }
});

export const make = Effect.fn("WorkspaceSearchIndex.make")(function* (
  cwd: string,
  variant: WorkspaceSearchIndexVariant = "paths",
) {
  const finder = yield* Effect.acquireRelease(createFinder(cwd, variant), (finder) =>
    Effect.try({
      try: () => finder.destroy(),
      catch: (cause) => new WorkspaceSearchIndexDestroyFailed({ cwd, cause }),
    }).pipe(Effect.orDie),
  );
  yield* waitForIndexReady(
    cwd,
    finder,
    ({ reason, cause }) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason,
        cause,
      }),
  );

  const runSearch = Effect.fn("WorkspaceSearchIndex.runSearch")(function* <A>(
    query: string,
    pageSize: number,
    operation: "directorySearch" | "fileSearch" | "grep" | "mixedSearch",
    execute: () => Result<A>,
  ): Effect.fn.Return<A, WorkspaceSearchIndexSearchFailed> {
    const result = yield* Effect.try({
      try: execute,
      catch: (cause) =>
        new WorkspaceSearchIndexSearchFailed({
          cwd,
          queryLength: query.length,
          pageSize,
          reason: `FileFinder.${operation} threw unexpectedly.`,
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexSearchFailed({
        cwd,
        queryLength: query.length,
        pageSize,
        reason: result.error,
      });
    }
    return result.value;
  });

  const refresh: WorkspaceSearchIndex["Service"]["refresh"] = Effect.fn(
    "WorkspaceSearchIndex.refresh",
  )(function* () {
    const result = yield* Effect.try({
      try: () => finder.scanFiles(),
      catch: (cause) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason: "FileFinder.scanFiles threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexRefreshFailed({
        cwd,
        reason: result.error,
      });
    }
    yield* waitForIndexReady(
      cwd,
      finder,
      ({ reason, cause }) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason,
          cause,
        }),
    );
  });

  const list: WorkspaceSearchIndex["Service"]["list"] = Effect.fn("WorkspaceSearchIndex.list")(
    function* () {
      const result = yield* runSearch("", WORKSPACE_INDEX_PAGE_SIZE, "mixedSearch", () =>
        finder.mixedSearch("", { pageSize: WORKSPACE_INDEX_PAGE_SIZE }),
      );
      const mapped = mapMixedSearchResult(result, WORKSPACE_INDEX_MAX_ENTRIES);
      const sortedEntries = withDirectoryAncestors(mapped.entries).toSorted((left, right) =>
        left.path.localeCompare(right.path),
      );
      const bounded = boundProjectListEntries(sortedEntries);
      return {
        entries: bounded.entries,
        truncated: mapped.truncated || bounded.truncated,
      };
    },
  );

  const search: WorkspaceSearchIndex["Service"]["search"] = Effect.fn(
    "WorkspaceSearchIndex.search",
  )(function* (query, limit, kind, imageOnly) {
    const pageSize = imageOnly ? WORKSPACE_INDEX_PAGE_SIZE : Math.max(1, limit + 1);
    if (kind === "file" || imageOnly) {
      const result = yield* runSearch(query, pageSize, "fileSearch", () =>
        finder.fileSearch(query, { pageSize }),
      );
      return mapFileSearchResult(result, limit, imageOnly);
    }
    if (kind === "directory") {
      const result = yield* runSearch(query, pageSize, "directorySearch", () =>
        finder.directorySearch(query, { pageSize }),
      );
      return mapDirectorySearchResult(result, limit);
    }
    const result = yield* runSearch(query, pageSize, "mixedSearch", () =>
      finder.mixedSearch(query, { pageSize }),
    );
    return mapMixedSearchResult(result, limit);
  });

  const searchContents: WorkspaceSearchIndex["Service"]["searchContents"] = Effect.fn(
    "WorkspaceSearchIndex.searchContents",
  )(function* (input) {
    const { searchQuery, regexMode } = buildContentSearchQuery(input);
    const deadline = performance.now() + CONTENT_SEARCH_TIME_BUDGET_MS;
    // Grep cursors advance by file, so whole-word post-filtering needs enough
    // raw candidates from the current file before moving to the next one.
    const rawPageSize = input.wholeWord
      ? Math.max(input.limit, CONTENT_SEARCH_MAX_MATCHES_PER_FILE)
      : input.limit;
    const matches: Array<ProjectSearchContentsResult["matches"][number]> = [];
    let nextCursor: GrepCursor | null = null;
    let regexFallbackError: string | undefined;
    let totalLineCharacters = 0;
    let totalPathCharacters = 0;
    let totalMatchRanges = 0;
    let resultTruncated = false;
    let aggregateBudgetExhausted = false;

    do {
      const remainingTimeBudgetMs = Math.max(1, Math.ceil(deadline - performance.now()));
      const result = yield* runSearch(input.query, input.limit, "grep", () =>
        finder.grep(searchQuery, {
          mode: regexMode ? "regex" : "plain",
          smartCase: !input.caseSensitive && !regexMode,
          // A single dense file must not consume the whole result page.
          maxMatchesPerFile: Math.min(CONTENT_SEARCH_MAX_MATCHES_PER_FILE, rawPageSize),
          pageSize: rawPageSize,
          cursor: nextCursor,
          timeBudgetMs: remainingTimeBudgetMs,
        }),
      );

      for (const match of result.items) {
        const path = toPosixPath(match.relativePath);
        if (path.length === 0 || path.length > PROJECT_PATH_MAX_LENGTH) {
          resultTruncated = true;
          continue;
        }
        const fullMatchRanges = mapContentMatchRanges(match.lineContent, match.matchRanges).filter(
          (range) => !input.wholeWord || isWholeWordRange(match.lineContent, range),
        );
        if (fullMatchRanges.length === 0) continue;
        const bounded = boundContentMatchLine(match.lineContent, fullMatchRanges);
        if (bounded.matchRanges.length === 0) {
          resultTruncated = true;
          continue;
        }
        const nextLineCharacters = totalLineCharacters + bounded.lineContent.length;
        const nextPathCharacters = totalPathCharacters + path.length;
        const nextMatchRanges = totalMatchRanges + bounded.matchRanges.length;
        if (
          matches.length >= input.limit ||
          nextLineCharacters > PROJECT_SEARCH_CONTENT_TOTAL_LINE_CHARS_MAX ||
          nextPathCharacters > PROJECT_SEARCH_CONTENT_TOTAL_PATH_CHARS_MAX ||
          nextMatchRanges > PROJECT_SEARCH_CONTENT_TOTAL_MATCH_RANGES_MAX
        ) {
          resultTruncated = true;
          aggregateBudgetExhausted = true;
          break;
        }
        matches.push({
          path,
          lineNumber: match.lineNumber,
          lineContent: bounded.lineContent,
          matchRanges: bounded.matchRanges,
        });
        totalLineCharacters = nextLineCharacters;
        totalPathCharacters = nextPathCharacters;
        totalMatchRanges = nextMatchRanges;
        resultTruncated ||= bounded.truncated;
      }
      nextCursor = result.nextCursor;
      regexFallbackError ??= result.regexFallbackError?.slice(
        0,
        PROJECT_SEARCH_CONTENT_REGEX_ERROR_MAX_LENGTH,
      );
    } while (
      !aggregateBudgetExhausted &&
      matches.length < input.limit &&
      nextCursor !== null &&
      performance.now() < deadline
    );

    return {
      matches,
      truncated: resultTruncated || nextCursor !== null,
      ...(regexFallbackError !== undefined ? { regexFallbackError } : {}),
    };
  });

  return WorkspaceSearchIndex.of({ list, refresh, search, searchContents });
});

export const WORKSPACE_SEARCH_INDEX_VARIANTS = ["paths", "content"] as const;
export type WorkspaceSearchIndexVariant = (typeof WORKSPACE_SEARCH_INDEX_VARIANTS)[number];

/**
 * Composite LayerMap key so the lightweight path index and the on-demand
 * content-search index of the same workspace are separate resources with
 * independent lifecycles. "\n" cannot appear in a filesystem path.
 */
export const workspaceSearchIndexKey = (cwd: string, variant: WorkspaceSearchIndexVariant) =>
  `${variant}\n${cwd}`;

function parseWorkspaceSearchIndexKey(key: string): {
  readonly cwd: string;
  readonly variant: WorkspaceSearchIndexVariant;
} {
  const separatorIndex = key.indexOf("\n");
  return {
    variant: key.slice(0, separatorIndex) as WorkspaceSearchIndexVariant,
    cwd: key.slice(separatorIndex + 1),
  };
}

/**
 * A layer factory is required because every index is scoped to a concrete
 * workspace root and variant. WorkspaceSearchIndexMap owns memoization and
 * idle cleanup; using a default cwd here would mix resources from different
 * workspaces.
 */
export const layer = (key: string) => {
  const { cwd, variant } = parseWorkspaceSearchIndexKey(key);
  return Layer.effect(WorkspaceSearchIndex, make(cwd, variant));
};

export class WorkspaceSearchIndexMap extends LayerMap.Service<WorkspaceSearchIndexMap>()(
  "t3/workspace/WorkspaceSearchIndexMap",
  {
    lookup: layer,
    idleTimeToLive: WORKSPACE_INDEX_IDLE_TTL,
  },
) {}
