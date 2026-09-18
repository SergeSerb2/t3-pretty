import * as Deferred from "effect/Deferred";
/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * The scan reads the provider CLIs' own session files (Claude Code, Codex, and
 * Grok Build) rather than T3 Code's orchestration projections, so usage covers
 * turns driven outside T3 Code too. This is the approach `ccusage` takes.
 *
 * Transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  ClaudeSettings,
  CodexSettings,
  type ProviderInstanceConfig,
  USAGE_CONTRACT_VERSION,
  type ServerSettings as ServerSettingsValue,
  type UsageProviderKind,
  type UsageSource,
  type UsagePricing,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
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
import { expandHomePath } from "../pathExpansion.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import { releaseHttpClientResponseBody } from "../stream/releaseHttpClientResponseBody.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import {
  mergeProviderInstanceEnvironment,
  prependGlobalEnvironment,
} from "../provider/ProviderInstanceEnvironment.ts";
import { isValidUsageTimeZone, UsageAggregator } from "./usageAggregation.ts";
import { createOverrideRateTable, parseRateTable, type RateTable } from "./usagePricing.ts";
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

/** An explicit refresh ignores the TTL, but not a table fetched this recently. */
const RATES_REFRESH_FLOOR_MS = 60 * 1000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const MAX_HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Longest window the UI offers, plus slack. Older entries are pruned. */
const CACHE_RETENTION_DAYS = 90;

const decodeCodexSettings = Schema.decodeOption(CodexSettings);
const decodeClaudeSettings = Schema.decodeOption(ClaudeSettings);

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
const encodeUsageRecordKey = Schema.encodeSync(ScanCacheJson);
const CachedSource = Schema.Struct({ dir: Schema.String, volumeId: Schema.String });
const decodeCachedSources = Schema.decodeUnknownOption(
  Schema.Struct({ sources: Schema.Record(Schema.String, CachedSource) }),
);

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
    /** Refetches the rate table ahead of its TTL. See `ensureRates`. */
    readonly refreshRates: Effect.Effect<UsagePricing>;
  }
>()("t3/usage/UsageService") {}

const EMPTY_PRICING: UsagePricing = {
  status: "unavailable",
  source: LITELLM_RATES_URL,
  fetchedAt: null,
  knownModels: 0,
};

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
        pricing: EMPTY_PRICING,
        scanDurationMs: 0,
      }),
    refreshRates: Effect.succeed(EMPTY_PRICING),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const scanSemaphore = yield* Semaphore.make(1);
  const hostEnvironment = yield* HostProcessEnvironment;

  const fileCache: ScanCache = new Map();
  let cachedRecordCount = 0;
  const sourceCache = new Map<string, typeof CachedSource.Type>();
  let cacheDirty = false;
  const isWithinDirectory = (filePath: string, dir: string) => {
    const relative = path.relative(dir, filePath);
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  };

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsagePricing["status"] = "unavailable";
  const writeCacheFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  // One fetch at a time. A burst of refreshes from several clients waits on
  // the first fetch and then sees a table young enough to skip its own.
  const ratesLock = yield* Semaphore.make(1);

  const pricing = (): UsagePricing => ({
    status: ratesStatus,
    source: LITELLM_RATES_URL,
    fetchedAt:
      ratesFetchedAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
    knownModels: rates.size,
  });

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing. `force` refetches inside the TTL so a model that
   * LiteLLM added since the last fetch gets priced now.
   */
  const loadRates = Effect.fn("UsageService.loadRates")(function* (force: boolean) {
    const now = yield* Clock.currentTimeMillis;
    const maxAgeMs = force ? RATES_REFRESH_FLOOR_MS : RATES_TTL_MS;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < maxAgeMs) return;

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
          if (now - fromDisk.fetchedAtMs < maxAgeMs) return;
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

  const ensureRates = (force: boolean) => ratesLock.withPermit(loadRates(force));

  const refreshRates = ensureRates(true).pipe(
    Effect.map(pricing),
    Effect.withSpan("UsageService.refreshRates"),
  );

  // A settings failure must not silently discard custom rates or transcript homes.
  const readSettings = settingsService.getSettings.pipe(
    Effect.catchCause(
      (cause) =>
        new UsageReadError({
          reason: "scanFailed",
          detail: "Server settings could not be read.",
          cause: Cause.squash(cause),
        }),
    ),
  );

  /** Resolves the transcript directory for each provider. */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* (
    settings: ServerSettingsValue,
    retentionCutoffMs: number,
  ) {
    const dirs: Array<{
      provider: UsageProviderKind;
      dir: string;
      volumeId: string;
      fileName?: string;
    }> = [];
    const seen = new Set<string>();
    for (const driver of ["claudeAgent", "codex", "grok"] as const) {
      // Disabled accounts still have history. Explicit default slots replace
      // the legacy settings, just as they do in the provider registry.
      const instances: Array<Pick<ProviderInstanceConfig, "config" | "environment">> =
        Object.values(settings.providerInstances).filter((instance) => instance.driver === driver);
      if (!Object.hasOwn(settings.providerInstances, driver)) {
        instances.push({ config: settings.providers[driver] });
      }
      for (const instance of instances) {
        const environment = mergeProviderInstanceEnvironment(
          prependGlobalEnvironment(settings.globalEnvironment, instance.environment),
          hostEnvironment,
        );
        const provider = driver === "claudeAgent" ? "claude" : driver;
        let home: string;
        if (driver === "codex") {
          const decoded = decodeCodexSettings(instance.config ?? {});
          if (Option.isNone(decoded)) continue;
          const config = decoded.value;
          const environmentHome = environment.CODEX_HOME?.trim();
          const layout = yield* resolveCodexHomeLayout(
            !config.homePath.trim() && !config.shadowHomePath.trim() && environmentHome
              ? { ...config, homePath: environmentHome }
              : config,
          );
          home = layout.sharedHomePath;
        } else if (driver === "claudeAgent") {
          const decoded = decodeClaudeSettings(instance.config ?? {});
          if (Option.isNone(decoded)) continue;
          const configured = decoded.value.homePath.trim();
          home = configured
            ? expandHomePath(configured)
            : environment.CLAUDE_CONFIG_DIR?.trim() || path.join(NodeOS.homedir(), ".claude");
        } else {
          home = expandHomePath(
            environment.GROK_HOME?.trim() || path.join(NodeOS.homedir(), ".grok"),
          );
        }
        const directory = path.resolve(home, provider === "claude" ? "projects" : "sessions");
        const sourceKey = provider + "\0" + directory;
        const previous = sourceCache.get(sourceKey);
        // Keep canonical paths and source fingerprints stable after root cleanup,
        // including aliases and clients merging pre-cleanup environment summaries.
        const dir = yield* fileSystem
          .realPath(directory)
          .pipe(Effect.orElseSucceed(() => previous?.dir ?? directory));
        const currentVolumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
        const hasRetainedHistory = fileCache
          .entries()
          .some(
            ([filePath, entry]) =>
              entry.provider === provider &&
              entry.mtimeMs >= retentionCutoffMs &&
              entry.records.length + entry.tailRecords.length > 0 &&
              isWithinDirectory(filePath, dir),
          );
        // A recreated directory still reports the retained history under its old identity.
        const volumeId =
          previous?.dir === dir && (hasRetainedHistory || !currentVolumeId)
            ? previous.volumeId || currentVolumeId
            : currentVolumeId;
        if (previous?.dir !== dir || previous.volumeId !== volumeId) {
          sourceCache.set(sourceKey, { dir, volumeId });
          cacheDirty = true;
        }
        const key = `${provider}\0${dir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dirs.push({
          provider,
          dir,
          volumeId,
          ...(provider === "grok" ? { fileName: "updates.jsonl" } : {}),
        });
      }
    }
    return dirs;
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
      const sources = decodeCachedSources(document);
      if (Option.isSome(sources)) {
        for (const [key, source] of Object.entries(sources.value.sources))
          sourceCache.set(key, source);
      }
    }),
  );

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    // Cleared only after the write lands, so a failed persist is retried on
    // the next scan instead of leaving disk permanently stale.
    yield* encodeScanCacheFile({
      ...encodeScanCache(fileCache),
      sources: Object.fromEntries(sourceCache),
    }).pipe(
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
        const records =
          cached?.provider === provider
            ? [...cached.records, ...(cached.tailRecords ?? [])]
            : [];
        const recordLimitReached = records.length > maxRecords;
        return {
          records: recordLimitReached ? records.slice(0, maxRecords) : records,
          oversizedRecords: 0,
          unreadable: true,
          recordLimitReached,
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
    settings: ServerSettingsValue,
    retentionCutoffMs: number,
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
    yield* ensureRates(false);
    yield* ensureScanCacheLoaded;

    const hostId = NodeOS.hostname();
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so `readSummary` stays context-free.
    const dirs = yield* resolveTranscriptDirs(settings).pipe(
      Effect.provideService(Path.Path, path),
    );
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
      priceOverrides: createOverrideRateTable(settings.usagePriceOverrides),
    });

    const sources: UsageSource[] = [];

    for (const { provider, dir, fileName } of dirs) {
      const volumeId = yield* Effect.promise(() => readDirectoryVolumeId(dir));
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));

      const listing = exists
        ? yield* Effect.promise(() =>
            listTranscriptFiles(
              dir,
              windowStartMs,
              fileName === undefined ? undefined : { fileName },
            ),
          )
        : undefined;
      const retainedFiles = [...(listing?.files ?? [])];
      const livePaths = new Set(retainedFiles.map((file) => file.path));
      // Cleanup may remove transcripts, but the usage we already saved still
      // contributes to this source. Keep the normal aggregation and dedupe path.
      for (const [filePath, entry] of fileCache) {
        if (
          entry.provider !== provider ||
          entry.mtimeMs < retentionCutoffMs ||
          livePaths.has(filePath) ||
          !isWithinDirectory(filePath, dir) ||
          (fileName !== undefined && path.basename(filePath) !== fileName)
        )
          continue;
        retainedFiles.push({
          path: filePath,
          records: [...entry.records, ...(entry.tailRecords ?? [])],
        });
      }

      if (listing === undefined && retainedFiles.length === 0) {
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

      const orderedFiles = retainedFiles.toSorted((left, right) => {
        const leftMtimeMs =
          "mtimeMs" in left && typeof left.mtimeMs === "number" ? left.mtimeMs : 0;
        const rightMtimeMs =
          "mtimeMs" in right && typeof right.mtimeMs === "number" ? right.mtimeMs : 0;
        return rightMtimeMs - leftMtimeMs;
      });

      for (let index = 0; index < orderedFiles.length; index += 1) {
        const file = orderedFiles[index]!;
        const fileSize = "size" in file && typeof file.size === "number" ? file.size : undefined;
        if (fileSize !== undefined && fileSize > TRANSCRIPT_FILE_MAX_BYTES) {
          oversizedFiles += 1;
          skippedFiles += 1;
          continue;
        }
        if (file.records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        if (fileSize !== undefined && corpusBytes + fileSize > TRANSCRIPT_PROVIDER_MAX_BYTES) {
          corpusLimitReached = true;
          skippedFiles += orderedFiles.length - index;
          break;
        }
        if (fileSize !== undefined) corpusBytes += fileSize;

        const remainingRecords = TRANSCRIPT_PROVIDER_RECORD_MAX - retainedRecords;
        if (remainingRecords <= 0) {
          recordLimitReached = true;
          skippedFiles += orderedFiles.length - index;
          break;
        }

        const records = file.records.slice(0, remainingRecords);
        const fileRecordLimitReached = records.length < file.records.length;
        retainedRecords += records.length;
        if (records.length === 0) {
          skippedFiles += 1;
          if (fileRecordLimitReached) {
            recordLimitReached = true;
            skippedFiles += orderedFiles.length - index - 1;
            break;
          }
          continue;
        }
        scannedFiles += 1;
        const codexEventOccurrences = new Map<string, number>();
        for (const record of records) {
          let usageRecord = record;
          if (record.provider === "codex" && record.sessionId.length > 0) {
            // Match moved rollout copies without collapsing repeated equal events
            // within one rollout (timestamps can have only second precision).
            const key = encodeUsageRecordKey([
              record.provider,
              record.sessionId,
              record.timestampMs,
              record.model,
              record.totals,
            ]);
            const occurrence = (codexEventOccurrences.get(key) ?? 0) + 1;
            codexEventOccurrences.set(key, occurrence);
            usageRecord = { ...record, dedupeKey: key + ":" + occurrence };
          }
          // Only sessions contributing in-window count; the mtime slack can
          // admit boundary files whose records fall outside the range.
          if (aggregator.add(usageRecord) && record.sessionId.length > 0) {
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
        (listing?.truncated ?? false) ||
        (listing?.unreadableDirectories ?? 0) > 0;

      sources.push({
        fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
        // Clients exclude missing sources, so saved records remain an available source.
        status:
          listing === undefined && scannedFiles === 0
            ? "missing"
            : isPartial
              ? "partial"
              : "ok",
        scannedFiles,
        skippedFiles,
        malformedRecords,
        distinctSessions: sessionIds.size,
        message:
          [
            listing === undefined ? "No transcript directory on this environment." : null,
            isPartial
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
                  (listing?.unreadableDirectories ?? 0) > 0
                    ? `${listing?.unreadableDirectories ?? 0} transcript director${(listing?.unreadableDirectories ?? 0) === 1 ? "y was" : "ies were"} unreadable.`
                    : null,
                  listing?.truncated ? "Transcript discovery reached its safety limit." : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" ")
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" ") || null,
      });
    }

    const pruned = pruneScanCache(fileCache, retentionCutoffMs);
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
      pricing: pricing(),
      scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    } satisfies UsageSummary;
  });

  /**
   * In-flight scans by window and custom prices, so concurrent identical requests (the usage
   * page open on two clients at once) share one scan instead of racing over
   * the same corpus twice.
   */
  const inflightScans = new Map<string, Deferred.Deferred<UsageSummary, UsageReadError>>();

  const scanKey = (
    input: UsageSummaryInput,
    priceOverrides: ServerSettingsValue["usagePriceOverrides"],
  ): string =>
    JSON.stringify([
      input.timeZone,
      input.sinceDay,
      input.untilDay,
      input.resolution ?? "day",
      input.sinceTime ?? null,
      input.untilTime ?? null,
      priceOverrides,
    ]);

  const readSummary = Effect.fn("UsageService.readSummary")(function* (input: UsageSummaryInput) {
    const settings = yield* readSettings;
    const key = scanKey(input, settings.usagePriceOverrides);
    const deferred = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const existing = inflightScans.get(key);
        if (existing !== undefined) return existing;

        // Enrollment and detached-fiber creation must be atomic. Otherwise a
        // canceled first caller can leave a Deferred with no scan to finish it.
        const created = Deferred.makeUnsafe<UsageSummary, UsageReadError>();
        inflightScans.set(key, created);
        // Detached so one departing client cannot tear the scan out from under
        // the fibers awaiting it; a finished scan warms the cache either way.
        yield* scanSemaphore
          .withPermits(1)(readSummaryCore(input, settings))
          .pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => inflightScans.delete(key)).pipe(
                Effect.andThen(Deferred.done(created, exit)),
              ),
            ),
            Effect.forkDetach,
          );
        return created;
      }),
    );
    // Waiting stays interruptible. The detached scan continues for other
    // callers and still warms the cache if this caller leaves.
    return yield* Deferred.await(deferred);
  });

  return { readSummary, refreshRates } as const;
});

export const layer = Layer.effect(UsageService, make);
