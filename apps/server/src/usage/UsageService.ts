/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * The scan reads the provider CLIs' own session files rather than T3 Code's
 * orchestration projections, so usage covers turns driven outside T3 Code too.
 * This is the approach `ccusage` takes.
 *
 * Transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSource,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/unstable/http";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { readTextWithinLimit } from "../boundedFileRead.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import { releaseHttpClientResponseBody } from "../stream/releaseHttpClientResponseBody.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { resolveKimiHomePath } from "../provider/Drivers/KimiHome.ts";
import { isValidUsageTimeZone, UsageAggregator } from "./usageAggregation.ts";
import { parseRateTable, type RateTable } from "./usagePricing.ts";
import {
  listTranscriptFiles,
  readDirectoryVolumeId,
  readTranscriptRecords,
} from "./usageTranscriptReader.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type ScanCache,
  USAGE_SCAN_CACHE_MAX_FILES,
  USAGE_SCAN_CACHE_MAX_RECORDS,
} from "./usageScanCache.ts";
import type { UsageRecord } from "./usageTranscripts.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Rates move rarely; a day-old table keeps the page working offline. */
const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const RATES_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
const RATES_CACHE_MAX_BYTES = 20 * 1024 * 1024;
const SCAN_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const TRANSCRIPT_FILE_MAX_BYTES = 512 * 1024 * 1024;
const TRANSCRIPT_PROVIDER_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const TRANSCRIPT_PROVIDER_RECORD_MAX = 200_000;
const TRANSCRIPT_PROVIDER_SESSION_MAX = 50_000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const MAX_HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Longest window the UI offers, plus slack. Older entries are pruned. */
const CACHE_RETENTION_DAYS = 90;

/** On-disk shape of the rate snapshot. */
const RatesCacheFile = Schema.Struct({
  fetchedAtMs: Schema.Number,
  document: Schema.Unknown,
});
const decodeRatesCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);
const encodeRatesCache = Schema.encodeEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);

/** The scan cache is narrowed by hand in `usageScanCache`, so JSON is enough here. */
const ScanCacheJson = Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>);
const decodeScanCacheFile = Schema.decodeUnknownEffect(ScanCacheJson);
const encodeScanCacheFile = Schema.encodeEffect(ScanCacheJson);

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
  }
>()("t3/usage/UsageService") {}

/** Empty summary, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  UsageService,
  UsageService.of({
    readSummary: (input) =>
      Effect.succeed({
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: "1970-01-01T00:00:00.000Z",
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        buckets: [],
        sources: [],
        pricing: {
          status: "unavailable",
          source: LITELLM_RATES_URL,
          fetchedAt: null,
          knownModels: 0,
        },
        scanDurationMs: 0,
      }),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const scanSemaphore = yield* Semaphore.make(1);

  const fileCache: ScanCache = new Map();
  let cachedRecordCount = 0;
  let cacheDirty = false;

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsageSummary["pricing"]["status"] = "unavailable";
  const writeCacheFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing.
   */
  const ensureRates = Effect.fn("UsageService.ensureRates")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < RATES_TTL_MS) return;

    if (ratesFetchedAtMs === null) {
      const fromDisk = yield* readTextWithinLimit(
        fileSystem,
        ratesCachePath,
        RATES_CACHE_MAX_BYTES,
      ).pipe(
        Effect.flatMap((raw) => decodeRatesCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk !== null) {
        const parsed = parseRateTable(fromDisk.document);
        if (parsed.size > 0) {
          rates = parsed;
          ratesFetchedAtMs = fromDisk.fetchedAtMs;
          ratesStatus = "cached";
          if (now - fromDisk.fetchedAtMs < RATES_TTL_MS) return;
        }
      }
    }

    const fetched = yield* httpClient.get(LITELLM_RATES_URL).pipe(
      Effect.flatMap((response) => {
        return Effect.gen(function* () {
          if (response.status < 200 || response.status >= 300) {
            yield* releaseHttpClientResponseBody(response);
            return yield* Effect.fail("rates-request-failed" as const);
          }
          const declaredLength = Number(response.headers["content-length"]);
          if (Number.isFinite(declaredLength) && declaredLength > RATES_RESPONSE_MAX_BYTES) {
            yield* releaseHttpClientResponseBody(response);
            return yield* Effect.fail("rates-response-too-large" as const);
          }
          const collected = yield* collectUint8StreamText({
            stream: response.stream,
            maxBytes: RATES_RESPONSE_MAX_BYTES,
            drainAfterTruncation: false,
          });
          if (collected.truncated) {
            return yield* Effect.fail("rates-response-too-large" as const);
          }
          return yield* decodeScanCacheFile(collected.text);
        });
      }),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      // The refresh failed; whatever we are serving is now past its TTL and
      // must not keep claiming to be fresh.
      if (rates.size > 0) ratesStatus = "cached";
      return;
    }

    const parsed = parseRateTable(fetched);
    if (parsed.size === 0) return;

    rates = parsed;
    ratesFetchedAtMs = now;
    ratesStatus = "fresh";

    yield* encodeRatesCache({ fetchedAtMs: now, document: fetched }).pipe(
      Effect.flatMap((serialized) =>
        new TextEncoder().encode(serialized).byteLength > RATES_CACHE_MAX_BYTES
          ? Effect.void
          : writeCacheFile(ratesCachePath, serialized),
      ),
      Effect.catchCause(() => Effect.void),
    );
  });

  /**
   * Claude's config dir is the home itself when overridden, but a default
   * install nests transcripts under `~/.claude/projects`. Probe both.
   */
  const resolveClaudeTranscriptDir = (homePath: string) =>
    Effect.gen(function* () {
      const nested = path.join(homePath, ".claude", "projects");
      const nestedExists = yield* fileSystem
        .exists(nested)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      return nestedExists ? nested : path.join(homePath, "projects");
    });

  /** Resolves the transcript directory for each provider. */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* () {
    // A settings failure must surface as an error: swallowing it here would
    // present "zero usage from every provider" as a valid answer.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(
        (cause) =>
          new UsageReadError({
            reason: "scanFailed",
            // Bounded description; the squashed failure travels as the cause.
            // Squashed, not the Cause tree: a full tree in a Defect field is
            // the unbounded wire payload the bounded detail exists to avoid.
            detail: "Server settings could not be read.",
            cause: Cause.squash(cause),
          }),
      ),
    );

    const claudeHome = yield* resolveClaudeHomePath(settings.providers.claudeAgent);
    const claudeDir = yield* resolveClaudeTranscriptDir(claudeHome);
    const codexLayout = yield* resolveCodexHomeLayout(settings.providers.codex);
    const kimiHome = yield* resolveKimiHomePath(settings.providers.kimi);

    return [
      { provider: "claude" as const, dir: claudeDir },
      { provider: "codex" as const, dir: path.join(codexLayout.sharedHomePath, "sessions") },
      {
        provider: "grok" as const,
        dir: path.join(NodeOS.homedir(), ".grok", "sessions"),
        fileName: "updates.jsonl",
      },
      {
        provider: "kimi" as const,
        dir: path.join(kimiHome, "sessions"),
        fileName: "wire.jsonl",
      },
    ];
  });

  /**
   * Loads the persisted scan cache exactly once per process.
   *
   * `Effect.cached` makes concurrent first readers await the same load rather
   * than each seeing a "loaded" flag set before the read finished and cold
   * scanning against an empty cache.
   */
  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* readTextWithinLimit(
        fileSystem,
        scanCachePath,
        SCAN_CACHE_MAX_BYTES,
      ).pipe(
        Effect.flatMap((raw) => decodeScanCacheFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      for (const [filePath, entry] of decodeScanCache(document)) {
        if (
          fileCache.size >= USAGE_SCAN_CACHE_MAX_FILES ||
          cachedRecordCount + entry.records.length > USAGE_SCAN_CACHE_MAX_RECORDS
        ) {
          cacheDirty = true;
          break;
        }
        fileCache.set(filePath, entry);
        cachedRecordCount += entry.records.length;
      }
    }),
  );

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    // Cleared only after the write lands, so a failed persist is retried on
    // the next scan instead of leaving disk permanently stale.
    yield* encodeScanCacheFile(encodeScanCache(fileCache)).pipe(
      Effect.flatMap((serialized) => {
        const encodedBytes = new TextEncoder().encode(serialized).byteLength;
        if (encodedBytes > SCAN_CACHE_MAX_BYTES) {
          return Effect.logWarning("usage scan cache exceeds the persistence limit, skipping", {
            encodedBytes,
            maximumBytes: SCAN_CACHE_MAX_BYTES,
          });
        }
        return writeCacheFile(scanCachePath, serialized);
      }),
      Effect.map(() => {
        cacheDirty = false;
      }),
      // A cache we cannot write is a slower next start, not a failed read.
      Effect.catchCause(() => Effect.void),
    );
  });

  /** Parses one transcript, reusing the cached result when it is unchanged. */
  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: UsageProviderKind,
    maxRecords: number,
  ): Effect.Effect<{
    readonly records: readonly UsageRecord[];
    readonly oversizedRecords: number;
    readonly unreadable: boolean;
    readonly recordLimitReached: boolean;
  }> =>
    Effect.gen(function* () {
      const cached = fileCache.get(filePath);
      // Provider is part of the identity: if both providers were ever pointed
      // at one directory, a hit parsed by the other parser must not be reused.
      if (
        cached &&
        cached.size === size &&
        cached.mtimeMs === mtimeMs &&
        cached.provider === provider
      ) {
        return cached.records.length > maxRecords
          ? {
              records: cached.records.slice(0, maxRecords),
              oversizedRecords: 0,
              unreadable: false,
              recordLimitReached: true,
            }
          : {
              records: cached.records,
              oversizedRecords: 0,
              unreadable: false,
              recordLimitReached: false,
            };
      }

      // A changed file's old records are no longer a valid cache entry. Drop
      // them before parsing so repeated edits cannot accumulate stale records
      // behind one path when the replacement is partial or unreadable.
      if (cached !== undefined) {
        fileCache.delete(filePath);
        cachedRecordCount -= cached.records.length;
        cacheDirty = true;
      }

      const parsed = yield* Effect.promise(() =>
        readTranscriptRecords(filePath, provider, maxRecords),
      );
      // A read failure is not an empty transcript: caching it under this
      // (size, mtime) would silently drop the file's usage until it changes.
      if (parsed === null) {
        return {
          records: [],
          oversizedRecords: 0,
          unreadable: true,
          recordLimitReached: false,
        };
      }
      // Stored already de-duplicated within the file, which is 99% of all
      // duplicates. The aggregator still runs the cross-file dedupe pass.
      const records = dedupeWithinFile(parsed.records);

      // A partial parse must be tried again on the next scan and must keep
      // surfacing as partial rather than turning into a clean warm-cache hit.
      if (
        parsed.oversizedRecords === 0 &&
        !parsed.recordLimitReached &&
        fileCache.size < USAGE_SCAN_CACHE_MAX_FILES &&
        cachedRecordCount + records.length <= USAGE_SCAN_CACHE_MAX_RECORDS
      ) {
        fileCache.set(filePath, { size, mtimeMs, provider, records });
        cachedRecordCount += records.length;
        cacheDirty = true;
      }
      return {
        records,
        oversizedRecords: parsed.oversizedRecords,
        unreadable: false,
        recordLimitReached: parsed.recordLimitReached,
      };
    });

  const readSummaryCore = Effect.fn("UsageService.readSummary")(function* (
    input: UsageSummaryInput,
  ) {
    if (!isValidUsageTimeZone(input.timeZone)) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `timeZone '${input.timeZone}' is not supported`,
      });
    }
    if (input.sinceDay > input.untilDay) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
      });
    }

    let hourlyWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null = null;
    if (input.resolution === "hour") {
      const sinceTime =
        input.sinceTime === undefined ? Option.none() : DateTime.make(input.sinceTime);
      const untilTime =
        input.untilTime === undefined ? Option.none() : DateTime.make(input.untilTime);
      if (Option.isNone(sinceTime) || Option.isNone(untilTime)) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Hourly usage requires valid sinceTime and untilTime instants",
        });
      }
      const sinceTimeMs = DateTime.toEpochMillis(sinceTime.value);
      const untilTimeMs = DateTime.toEpochMillis(untilTime.value);
      const durationMs = untilTimeMs - sinceTimeMs;
      if (durationMs <= 0 || durationMs > MAX_HOURLY_WINDOW_MS) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Hourly usage window must be greater than zero and at most 24 hours",
        });
      }
      hourlyWindow = { sinceTimeMs, untilTimeMs };
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    yield* ensureRates();
    yield* ensureScanCacheLoaded;

    const hostId = NodeOS.hostname();
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so `readSummary` stays context-free.
    const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));
    const windowStart = DateTime.make(`${input.sinceDay}T00:00:00Z`);
    const windowEnd = DateTime.make(`${input.untilDay}T00:00:00Z`);
    if (Option.isNone(windowStart) || Option.isNone(windowEnd)) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `Usage window '${input.sinceDay}' through '${input.untilDay}' contains an invalid date`,
      });
    }
    const windowStartMs =
      (hourlyWindow?.sinceTimeMs ?? DateTime.toEpochMillis(windowStart.value)) - MTIME_SLACK_MS;

    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      resolution: input.resolution ?? "day",
      ...hourlyWindow,
      rates,
    });

    const sources: UsageSource[] = [];
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    for (const { provider, dir, fileName } of dirs) {
      const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));

      if (!exists) {
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
          status: "missing",
          scannedFiles: 0,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 0,
          message: "No transcript directory on this environment.",
        });
        continue;
      }

      const listing = yield* Effect.promise(() =>
        listTranscriptFiles(dir, windowStartMs, fileName),
      );
      // Absence only proves deletion after a complete walk. Treating a
      // truncated or partially unreadable listing as authoritative would evict
      // valid warm entries that the walk simply never reached.
      if (!listing.truncated && listing.unreadableDirectories === 0) walkedRoots.push(dir);
      const { files } = listing;
      let scannedFiles = 0;
      let skippedFiles = 0;
      let malformedRecords = 0;
      let unreadableFiles = 0;
      let oversizedFiles = 0;
      let corpusBytes = 0;
      let corpusLimitReached = false;
      let recordLimitReached = false;
      let sessionLimitReached = false;
      let retainedRecords = 0;
      // Distinct per directory. Buckets carry per-cell session counts, but a
      // session spans days and models, so clients total this figure instead.
      const sessionIds = new Set<string>();

      for (const file of files) livePaths.add(file.path);
      const orderedFiles = files.toSorted((left, right) => right.mtimeMs - left.mtimeMs);

      for (let index = 0; index < orderedFiles.length; index += 1) {
        const file = orderedFiles[index]!;
        if (file.size > TRANSCRIPT_FILE_MAX_BYTES) {
          oversizedFiles += 1;
          skippedFiles += 1;
          continue;
        }
        if (corpusBytes + file.size > TRANSCRIPT_PROVIDER_MAX_BYTES) {
          corpusLimitReached = true;
          skippedFiles += orderedFiles.length - index;
          break;
        }
        corpusBytes += file.size;

        const remainingRecords = TRANSCRIPT_PROVIDER_RECORD_MAX - retainedRecords;
        if (remainingRecords <= 0) {
          recordLimitReached = true;
          skippedFiles += orderedFiles.length - index;
          break;
        }

        const result = yield* readFileRecords(
          file.path,
          file.size,
          file.mtimeMs,
          provider,
          remainingRecords,
        );
        malformedRecords += result.oversizedRecords;
        if (result.unreadable) unreadableFiles += 1;
        const { records } = result;
        retainedRecords += records.length;
        if (records.length === 0) {
          skippedFiles += 1;
          if (result.recordLimitReached) {
            recordLimitReached = true;
            skippedFiles += orderedFiles.length - index - 1;
            break;
          }
          continue;
        }
        scannedFiles += 1;
        for (const record of records) {
          // Only sessions that contributed in-window count: the mtime slack
          // admits boundary files whose records fall outside the range.
          if (aggregator.add(record) && record.sessionId.length > 0) {
            if (sessionIds.has(record.sessionId)) continue;
            if (sessionIds.size < TRANSCRIPT_PROVIDER_SESSION_MAX) {
              sessionIds.add(record.sessionId);
            } else {
              sessionLimitReached = true;
            }
          }
        }
        if (result.recordLimitReached || retainedRecords >= TRANSCRIPT_PROVIDER_RECORD_MAX) {
          recordLimitReached = true;
          skippedFiles += orderedFiles.length - index - 1;
          break;
        }
      }

      const aggregateCapacity = aggregator.capacityForProvider(provider);
      const isPartial =
        malformedRecords > 0 ||
        unreadableFiles > 0 ||
        oversizedFiles > 0 ||
        corpusLimitReached ||
        recordLimitReached ||
        sessionLimitReached ||
        aggregateCapacity.droppedRecords > 0 ||
        aggregateCapacity.omittedSessionMemberships > 0 ||
        listing.truncated ||
        listing.unreadableDirectories > 0;

      sources.push({
        fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
        status: isPartial ? "partial" : "ok",
        scannedFiles,
        skippedFiles,
        malformedRecords,
        distinctSessions: sessionIds.size,
        message: isPartial
          ? [
              malformedRecords > 0
                ? `${malformedRecords} oversized transcript record${malformedRecords === 1 ? " was" : "s were"} skipped.`
                : null,
              unreadableFiles > 0
                ? `${unreadableFiles} transcript file${unreadableFiles === 1 ? " was" : "s were"} unreadable.`
                : null,
              oversizedFiles > 0
                ? `${oversizedFiles} transcript file${oversizedFiles === 1 ? " exceeded" : "s exceeded"} 512 MiB and ${oversizedFiles === 1 ? "was" : "were"} skipped.`
                : null,
              corpusLimitReached
                ? "Transcript discovery exceeded the 4 GiB per-provider scan budget."
                : null,
              recordLimitReached
                ? "Transcript parsing reached the 200,000-record per-provider limit."
                : null,
              sessionLimitReached
                ? "Distinct-session counting reached the 50,000-session per-provider limit."
                : null,
              aggregateCapacity.droppedRecords > 0
                ? `${aggregateCapacity.droppedRecords} usage record${aggregateCapacity.droppedRecords === 1 ? " exceeded" : "s exceeded"} aggregate identity or bucket limits and ${aggregateCapacity.droppedRecords === 1 ? "was" : "were"} omitted.`
                : null,
              aggregateCapacity.omittedSessionMemberships > 0
                ? `${aggregateCapacity.omittedSessionMemberships} bucket session membership${aggregateCapacity.omittedSessionMemberships === 1 ? " exceeded" : "s exceeded"} the aggregate limit.`
                : null,
              listing.unreadableDirectories > 0
                ? `${listing.unreadableDirectories} transcript director${listing.unreadableDirectories === 1 ? "y was" : "ies were"} unreadable.`
                : null,
              listing.truncated ? "Transcript discovery reached its safety limit." : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" ")
          : null,
      });
    }

    const pruned = pruneScanCache(fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs: startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    });
    if (pruned > 0) {
      cachedRecordCount = 0;
      for (const entry of fileCache.values()) cachedRecordCount += entry.records.length;
      cacheDirty = true;
    }
    yield* persistScanCache();

    const aggregated = aggregator.finish();
    const readAt = yield* DateTime.now;
    const finishedAtMs = yield* Clock.currentTimeMillis;

    return {
      contractVersion: USAGE_CONTRACT_VERSION,
      readAt: DateTime.formatIso(readAt),
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      buckets: aggregated.buckets,
      sources,
      pricing: {
        status: ratesStatus,
        source: LITELLM_RATES_URL,
        fetchedAt:
          ratesFetchedAtMs === null
            ? null
            : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
        knownModels: rates.size,
      },
      scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    } satisfies UsageSummary;
  });

  const readSummary: UsageService["Service"]["readSummary"] = (input) =>
    scanSemaphore.withPermits(1)(readSummaryCore(input));

  return { readSummary } as const;
});

export const layer = Layer.effect(UsageService, make);
