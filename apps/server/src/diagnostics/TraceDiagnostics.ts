import {
  SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT,
  SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH,
  SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT,
  SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT,
  SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH,
  SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT,
  type ServerTraceDiagnosticsErrorKind,
  type ServerTraceDiagnosticsFailureSummary,
  type ServerTraceDiagnosticsLogEvent,
  type ServerTraceDiagnosticsRecentFailure,
  type ServerTraceDiagnosticsResult,
  type ServerTraceDiagnosticsSpanOccurrence,
  type ServerTraceDiagnosticsSpanSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { TRACE_MAX_FILES_LIMIT } from "../config.ts";

interface TraceRecordLike {
  readonly name?: unknown;
  readonly traceId?: unknown;
  readonly spanId?: unknown;
  readonly startTimeUnixNano?: unknown;
  readonly endTimeUnixNano?: unknown;
  readonly durationMs?: unknown;
  readonly exit?: unknown;
  readonly events?: unknown;
}

interface TraceEventLike {
  readonly name?: unknown;
  readonly timeUnixNano?: unknown;
  readonly attributes?: unknown;
}

export interface TraceDiagnosticsOptions {
  readonly traceFilePath: string;
  readonly maxFiles: number;
  readonly slowSpanThresholdMs?: number;
  readonly readAt?: DateTime.Utc;
}

export class TraceFileReadError extends Schema.TaggedErrorClass<TraceFileReadError>()(
  "TraceFileReadError",
  {
    traceFilePath: Schema.String,
    causeTag: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read local trace file '${this.traceFilePath}'.`;
  }
}

export class TraceDiagnostics extends Context.Service<
  TraceDiagnostics,
  {
    readonly read: (
      options: TraceDiagnosticsOptions,
    ) => Effect.Effect<ServerTraceDiagnosticsResult>;
  }
>()("t3/diagnostics/TraceDiagnostics") {}

interface TraceDiagnosticsInput {
  readonly traceFilePath: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly text: string }>;
  readonly scannedFilePaths?: ReadonlyArray<string>;
  readonly slowSpanThresholdMs?: number;
  readonly readAt: DateTime.Utc;
  readonly error?: TraceDiagnosticsErrorSummary;
  readonly partialFailure?: boolean;
}

interface TraceDiagnosticsErrorSummary {
  readonly kind: ServerTraceDiagnosticsErrorKind;
  readonly message: string;
}

const DEFAULT_SLOW_SPAN_THRESHOLD_MS = 1_000;
const TRACE_RECORD_MAX_LENGTH = 1024 * 1024;
const TRACE_AGGREGATE_KEY_LIMIT = 4_096;
const TRACE_DIAGNOSTICS_READ_BUDGET_BYTES = 32 * 1024 * 1024;

function toRotatedTracePaths(traceFilePath: string, maxFiles: number): ReadonlyArray<string> {
  const backupCount = Math.min(TRACE_MAX_FILES_LIMIT, Math.max(0, Math.floor(maxFiles)));
  const backups = Array.from(
    { length: backupCount },
    (_, index) => `${traceFilePath}.${backupCount - index}`,
  );
  return [...backups, traceFilePath];
}

function isRecordObject(value: unknown): value is TraceRecordLike {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH);
}

function toDiagnosticPath(value: string): string {
  const trimmed = value.trim();
  const nonEmpty = trimmed.length > 0 ? trimmed : "unknown";
  return nonEmpty.slice(0, SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH);
}

function toDiagnosticError(
  error: TraceDiagnosticsErrorSummary | undefined,
): TraceDiagnosticsErrorSummary | undefined {
  return error === undefined
    ? undefined
    : {
        kind: error.kind,
        message: toStringValue(error.message) ?? "Trace diagnostics failed.",
      };
}

function toNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unixNanoToDateTime(value: unknown): DateTime.Utc | null {
  const text = toStringValue(value);
  if (!text) return null;
  try {
    const millis = Number(BigInt(text) / 1_000_000n);
    return Option.getOrNull(DateTime.make(millis));
  } catch {
    return null;
  }
}

function readExitTag(exit: unknown): string | null {
  if (!isRecordObject(exit) || !("_tag" in exit)) return null;
  return toStringValue(exit._tag);
}

function readExitCause(exit: unknown): string {
  if (!isRecordObject(exit) || !("cause" in exit)) return "Failure";
  return toStringValue(exit.cause)?.trim() ?? "Failure";
}

function isTraceEvent(value: unknown): value is TraceEventLike {
  return typeof value === "object" && value !== null;
}

function readEventAttributes(event: TraceEventLike): Readonly<Record<string, unknown>> {
  return typeof event.attributes === "object" && event.attributes !== null
    ? (event.attributes as Readonly<Record<string, unknown>>)
    : {};
}

function makeEmptyDiagnostics(input: {
  readonly traceFilePath: string;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly readAt: DateTime.Utc;
  readonly slowSpanThresholdMs: number;
  readonly error?: TraceDiagnosticsErrorSummary;
  readonly partialFailure?: boolean;
}): ServerTraceDiagnosticsResult {
  return {
    traceFilePath: toDiagnosticPath(input.traceFilePath),
    scannedFilePaths: input.scannedFilePaths
      .slice(0, SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT)
      .map(toDiagnosticPath),
    readAt: input.readAt,
    recordCount: 0,
    parseErrorCount: 0,
    firstSpanAt: Option.none(),
    lastSpanAt: Option.none(),
    failureCount: 0,
    interruptionCount: 0,
    slowSpanThresholdMs: input.slowSpanThresholdMs,
    slowSpanCount: 0,
    logLevelCounts: {},
    topSpansByCount: [],
    slowestSpans: [],
    commonFailures: [],
    latestFailures: [],
    latestWarningAndErrorLogs: [],
    partialFailure: input.partialFailure ? Option.some(true) : Option.none(),
    error: Option.fromNullishOr(toDiagnosticError(input.error)),
  };
}

function isNotFoundError(error: PlatformError.PlatformError): boolean {
  return error.reason._tag === "NotFound";
}

function insertBoundedSlowestSpan(
  slowestSpans: ServerTraceDiagnosticsSpanOccurrence[],
  span: ServerTraceDiagnosticsSpanOccurrence,
): void {
  if (
    slowestSpans.length >= SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT &&
    span.durationMs <= slowestSpans[slowestSpans.length - 1]!.durationMs
  ) {
    return;
  }

  slowestSpans.push(span);
  slowestSpans.sort((left, right) => right.durationMs - left.durationMs);
  if (slowestSpans.length > SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT) {
    slowestSpans.length = SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT;
  }
}

function insertBoundedRecent<T>(items: T[], item: T, timestamp: (item: T) => DateTime.Utc): void {
  const itemTimestamp = DateTime.toEpochMillis(timestamp(item));
  if (
    items.length >= SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT &&
    itemTimestamp <= DateTime.toEpochMillis(timestamp(items[items.length - 1]!))
  ) {
    return;
  }

  items.push(item);
  items.sort(
    (left, right) =>
      DateTime.toEpochMillis(timestamp(right)) - DateTime.toEpochMillis(timestamp(left)),
  );
  if (items.length > SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT) {
    items.length = SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT;
  }
}

function* traceLines(text: string): Generator<string | null> {
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const rawEnd = newline === -1 ? text.length : newline;
    const end = rawEnd > start && text.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
    yield end - start <= TRACE_RECORD_MAX_LENGTH ? text.slice(start, end) : null;
    if (newline === -1) return;
    start = newline + 1;
  }
}

export function aggregateTraceDiagnostics(
  input: TraceDiagnosticsInput,
): ServerTraceDiagnosticsResult {
  const readAt = input.readAt;
  const slowSpanThresholdMs = input.slowSpanThresholdMs ?? DEFAULT_SLOW_SPAN_THRESHOLD_MS;
  const scannedFilePaths = (input.scannedFilePaths ?? input.files.map((file) => file.path))
    .slice(0, SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT)
    .map(toDiagnosticPath);
  if (input.files.length === 0) {
    return makeEmptyDiagnostics({
      traceFilePath: input.traceFilePath,
      scannedFilePaths,
      readAt,
      slowSpanThresholdMs,
      error: input.error ?? {
        kind: "trace-file-not-found",
        message: "No local trace files were found.",
      },
      ...(input.partialFailure ? { partialFailure: true } : {}),
    });
  }

  let parseErrorCount = 0;
  let recordCount = 0;
  let failureCount = 0;
  let interruptionCount = 0;
  let slowSpanCount = 0;
  let firstSpanAt: DateTime.Utc | null = null;
  let lastSpanAt: DateTime.Utc | null = null;

  const spansByName = new Map<
    string,
    { count: number; failureCount: number; totalDurationMs: number; maxDurationMs: number }
  >();
  const failuresByKey = new Map<string, ServerTraceDiagnosticsFailureSummary>();
  const latestFailures: ServerTraceDiagnosticsRecentFailure[] = [];
  const slowestSpans: ServerTraceDiagnosticsSpanOccurrence[] = [];
  const latestWarningAndErrorLogs: ServerTraceDiagnosticsLogEvent[] = [];
  const logLevelCounts = new Map<string, number>();

  for (const file of input.files) {
    for (const line of traceLines(file.text)) {
      if (line === null) {
        parseErrorCount += 1;
        continue;
      }
      if (line.trim().length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        parseErrorCount += 1;
        continue;
      }

      if (!isRecordObject(parsed)) {
        parseErrorCount += 1;
        continue;
      }

      const name = toStringValue(parsed.name);
      const traceId = toStringValue(parsed.traceId);
      const spanId = toStringValue(parsed.spanId);
      const durationMs = toNumberValue(parsed.durationMs);
      const endedAt = unixNanoToDateTime(parsed.endTimeUnixNano);
      const startedAt = unixNanoToDateTime(parsed.startTimeUnixNano);

      if (!name || !traceId || !spanId || durationMs === null || !endedAt) {
        parseErrorCount += 1;
        continue;
      }

      recordCount += 1;
      firstSpanAt =
        startedAt && (firstSpanAt === null || DateTime.isLessThan(startedAt, firstSpanAt))
          ? startedAt
          : firstSpanAt;
      lastSpanAt =
        lastSpanAt === null || DateTime.isGreaterThan(endedAt, lastSpanAt) ? endedAt : lastSpanAt;

      const exitTag = readExitTag(parsed.exit);
      const isFailure = exitTag === "Failure";
      const isInterrupted = exitTag === "Interrupted";
      if (isFailure) failureCount += 1;
      if (isInterrupted) interruptionCount += 1;

      let spanSummary = spansByName.get(name);
      if (spanSummary === undefined && spansByName.size < TRACE_AGGREGATE_KEY_LIMIT) {
        spanSummary = {
          count: 0,
          failureCount: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
        };
        spansByName.set(name, spanSummary);
      }
      if (spanSummary !== undefined) {
        spanSummary.count += 1;
        spanSummary.totalDurationMs += durationMs;
        spanSummary.maxDurationMs = Math.max(spanSummary.maxDurationMs, durationMs);
        if (isFailure) spanSummary.failureCount += 1;
      }

      const spanItem = { name, durationMs, endedAt, traceId, spanId };
      if (durationMs >= slowSpanThresholdMs) {
        slowSpanCount += 1;
      }
      insertBoundedSlowestSpan(slowestSpans, spanItem);

      if (isFailure) {
        const cause = readExitCause(parsed.exit);
        insertBoundedRecent(latestFailures, { ...spanItem, cause }, (item) => item.endedAt);

        const failureKey = `${name}\0${cause}`;
        const existing = failuresByKey.get(failureKey);
        if (existing !== undefined || failuresByKey.size < TRACE_AGGREGATE_KEY_LIMIT) {
          const isLatestFailure = !existing || DateTime.isGreaterThan(endedAt, existing.lastSeenAt);
          failuresByKey.set(failureKey, {
            name,
            cause,
            count: (existing?.count ?? 0) + 1,
            lastSeenAt: isLatestFailure ? endedAt : existing!.lastSeenAt,
            traceId: isLatestFailure ? traceId : existing!.traceId,
            spanId: isLatestFailure ? spanId : existing!.spanId,
          });
        }
      }

      if (Array.isArray(parsed.events)) {
        for (const rawEvent of parsed.events) {
          if (!isTraceEvent(rawEvent)) continue;
          const attributes = readEventAttributes(rawEvent);
          const level = toStringValue(attributes["effect.logLevel"]);
          if (!level) continue;

          const existingLevelCount = logLevelCounts.get(level);
          if (existingLevelCount !== undefined) {
            logLevelCounts.set(level, existingLevelCount + 1);
          } else if (logLevelCounts.size < SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT) {
            logLevelCounts.set(level, 1);
          }
          const normalizedLevel = level.toLowerCase();
          if (
            normalizedLevel !== "warning" &&
            normalizedLevel !== "warn" &&
            normalizedLevel !== "error" &&
            normalizedLevel !== "fatal"
          ) {
            continue;
          }

          const seenAt = unixNanoToDateTime(rawEvent.timeUnixNano) ?? endedAt;
          const message = toStringValue(rawEvent.name)?.trim() ?? "Log event";
          insertBoundedRecent(
            latestWarningAndErrorLogs,
            {
              spanName: name,
              level,
              message,
              seenAt,
              traceId,
              spanId,
            },
            (item) => item.seenAt,
          );
        }
      }
    }
  }

  const topSpansByCount: ServerTraceDiagnosticsSpanSummary[] = [...spansByName.entries()]
    .map(([name, span]) => ({
      name,
      count: span.count,
      failureCount: span.failureCount,
      totalDurationMs: span.totalDurationMs,
      averageDurationMs: span.count > 0 ? span.totalDurationMs / span.count : 0,
      maxDurationMs: span.maxDurationMs,
    }))
    .toSorted((left, right) => right.count - left.count || right.maxDurationMs - left.maxDurationMs)
    .slice(0, SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT);

  return {
    traceFilePath: toDiagnosticPath(input.traceFilePath),
    scannedFilePaths,
    readAt,
    recordCount,
    parseErrorCount,
    firstSpanAt: Option.fromNullishOr(firstSpanAt),
    lastSpanAt: Option.fromNullishOr(lastSpanAt),
    failureCount,
    interruptionCount,
    slowSpanThresholdMs,
    slowSpanCount,
    logLevelCounts: Object.fromEntries(logLevelCounts),
    topSpansByCount,
    slowestSpans,
    commonFailures: [...failuresByKey.values()]
      .toSorted(
        (left, right) =>
          right.count - left.count ||
          DateTime.toEpochMillis(right.lastSeenAt) - DateTime.toEpochMillis(left.lastSeenAt),
      )
      .slice(0, SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT),
    latestFailures,
    latestWarningAndErrorLogs,
    partialFailure: input.partialFailure ? Option.some(true) : Option.none(),
    error: Option.fromNullishOr(toDiagnosticError(input.error)),
  };
}

type TraceFileReadResult =
  | {
      readonly _tag: "Loaded";
      readonly path: string;
      readonly text: string;
      readonly byteLength: number;
      readonly truncated: boolean;
    }
  | { readonly _tag: "Missing"; readonly path: string };

function readTraceFile(
  fileSystem: FileSystem.FileSystem,
  path: string,
  maximumBytes: number,
): Effect.Effect<TraceFileReadResult, TraceFileReadError> {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fileSystem.open(path, { flag: "r" });
      const info = yield* handle.stat;
      const readLimit = BigInt(Math.max(0, Math.floor(maximumBytes)));
      const bytesToRead = info.size < readLimit ? info.size : readLimit;
      const start = info.size - bytesToRead;
      if (start > 0n) {
        yield* handle.seek(start, "start");
      }

      const buffer = new Uint8Array(Number(bytesToRead));
      let byteLength = 0;
      while (byteLength < buffer.byteLength) {
        const bytesRead = Number(yield* handle.read(buffer.subarray(byteLength)));
        if (bytesRead === 0) break;
        byteLength += bytesRead;
      }

      let text = new TextDecoder().decode(buffer.subarray(0, byteLength));
      const truncated = start > 0n;
      if (truncated) {
        const firstNewline = text.indexOf("\n");
        text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
      }

      return {
        _tag: "Loaded",
        path,
        text,
        byteLength,
        truncated,
      } satisfies TraceFileReadResult;
    }),
  ).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        isNotFoundError(cause)
          ? Effect.succeed<TraceFileReadResult>({ _tag: "Missing", path })
          : Effect.fail(
              new TraceFileReadError({
                traceFilePath: path,
                causeTag: cause.reason._tag,
                cause,
              }),
            ),
    }),
  );
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;

  const read: TraceDiagnostics["Service"]["read"] = Effect.fn("TraceDiagnostics.read")(
    function* (options) {
      const readAt = options.readAt ?? (yield* DateTime.now);
      const slowSpanThresholdMs = options.slowSpanThresholdMs ?? DEFAULT_SLOW_SPAN_THRESHOLD_MS;
      const paths = toRotatedTracePaths(options.traceFilePath, options.maxFiles);
      const newestFirstResults: Array<Result.Result<TraceFileReadResult, TraceFileReadError>> = [];
      let remainingBytes = TRACE_DIAGNOSTICS_READ_BUDGET_BYTES;
      for (const path of paths.toReversed()) {
        const result = yield* readTraceFile(fileSystem, path, remainingBytes).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Failed to read local trace file.").pipe(
              Effect.annotateLogs({
                traceFilePath: cause.traceFilePath,
                errorTag: cause._tag,
                causeTag: cause.causeTag,
              }),
            ),
          ),
          Effect.result,
        );
        newestFirstResults.push(result);
        if (Result.isSuccess(result) && result.success._tag === "Loaded") {
          remainingBytes = Math.max(0, remainingBytes - result.success.byteLength);
        }
      }
      const results = newestFirstResults.toReversed();
      const files = results.flatMap((result) =>
        Result.isSuccess(result) && result.success._tag === "Loaded"
          ? [{ path: result.success.path, text: result.success.text }]
          : [],
      );
      const readFailure = results.find(Result.isFailure);
      const wasTruncated = results.some(
        (result) =>
          Result.isSuccess(result) && result.success._tag === "Loaded" && result.success.truncated,
      );
      const partialReadError = readFailure
        ? ({
            kind: "trace-file-read-failed",
            message: readFailure.failure.message,
          } satisfies TraceDiagnosticsErrorSummary)
        : wasTruncated
          ? ({
              kind: "trace-file-read-failed",
              message: "Only the newest 32 MiB of local trace data was analyzed.",
            } satisfies TraceDiagnosticsErrorSummary)
          : undefined;

      if (files.length === 0) {
        return makeEmptyDiagnostics({
          traceFilePath: options.traceFilePath,
          scannedFilePaths: paths,
          readAt,
          slowSpanThresholdMs,
          error:
            partialReadError ??
            ({
              kind: "trace-file-not-found",
              message: "No local trace files were found.",
            } satisfies TraceDiagnosticsErrorSummary),
        });
      }

      return aggregateTraceDiagnostics({
        traceFilePath: options.traceFilePath,
        files,
        scannedFilePaths: paths,
        readAt,
        slowSpanThresholdMs,
        ...(partialReadError ? { partialFailure: true, error: partialReadError } : {}),
      });
    },
  );

  return TraceDiagnostics.of({ read });
});

export const layer = Layer.effect(TraceDiagnostics, make);

export function readTraceDiagnostics(
  options: TraceDiagnosticsOptions,
): Effect.Effect<ServerTraceDiagnosticsResult, never, TraceDiagnostics> {
  return Effect.gen(function* () {
    const diagnostics = yield* TraceDiagnostics;
    return yield* diagnostics.read(options);
  });
}
