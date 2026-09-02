import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as ExitRuntime from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import { OtlpResource, OtlpTracer } from "effect/unstable/observability";

import { RotatingFileSink } from "./logging.ts";

const FLUSH_BUFFER_THRESHOLD = 256;
const textEncoder = new TextEncoder();

export type TraceAttributes = Readonly<Record<string, unknown>>;

export interface TraceRecordEvent {
  readonly name: string;
  readonly timeUnixNano: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface TraceRecordLink {
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

interface BaseTraceRecord {
  readonly name: string;
  readonly kind: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly sampled: boolean;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: ReadonlyArray<TraceRecordEvent>;
  readonly links: ReadonlyArray<TraceRecordLink>;
}

export interface EffectTraceRecord extends BaseTraceRecord {
  readonly type: "effect-span";
  readonly exit:
    | {
        readonly _tag: "Success";
      }
    | {
        readonly _tag: "Interrupted";
        readonly cause: string;
      }
    | {
        readonly _tag: "Failure";
        readonly cause: string;
      };
}

export interface OtlpTraceRecord extends BaseTraceRecord {
  readonly type: "otlp-span";
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
  readonly scope: Readonly<{
    readonly name?: string;
    readonly version?: string;
    readonly attributes: Readonly<Record<string, unknown>>;
  }>;
  readonly status?:
    | {
        readonly code?: string;
        readonly message?: string;
      }
    | undefined;
}

export type TraceRecord = EffectTraceRecord | OtlpTraceRecord;

function isStructuralTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z][A-Za-z0-9._:/-]*$/.test(value)
  );
}

export function errorTag(error: unknown): string {
  try {
    if (typeof error === "object" && error !== null && "_tag" in error) {
      return isStructuralTag(error._tag) ? error._tag : "TaggedError";
    }
    if (error instanceof Error) {
      return isStructuralTag(error.name) ? error.name : "Error";
    }
  } catch {
    return "UnknownError";
  }
  return typeof error;
}

export function causeErrorTag(cause: Cause.Cause<unknown>): string {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    return errorTag(failure.value);
  }
  return cause.reasons[0]?._tag ?? "Empty";
}

export interface TraceSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
  readonly onFlush?: (stats: TraceSinkFlushStats) => Effect.Effect<void>;
}

export interface TraceSinkFlushStats {
  readonly logicalWriteBytes: number;
  readonly count: number;
  readonly durationMs: number;
}

export interface TraceSink {
  readonly filePath: string;
  push: (record: TraceRecord) => void;
  flush: Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

export interface LocalFileTracerOptions extends TraceSinkOptions {
  readonly delegate?: Tracer.Tracer;
  readonly sink?: TraceSink;
}

type OtlpSpan = OtlpTracer.ScopeSpan["spans"][number];
type OtlpSpanEvent = OtlpSpan["events"][number];
type OtlpSpanLink = OtlpSpan["links"][number];
type OtlpSpanStatus = OtlpSpan["status"];

interface SerializableSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly status: Tracer.SpanStatus;
  readonly sampled: boolean;
  readonly kind: Tracer.SpanKind;
  readonly attributes: ReadonlyMap<string, unknown>;
  readonly links: ReadonlyArray<Tracer.SpanLink>;
  readonly events: ReadonlyArray<
    readonly [name: string, startTime: bigint, attributes: Record<string, unknown>]
  >;
}

const TRACE_ATTRIBUTE_MAX_DEPTH = 8;
const TRACE_ATTRIBUTE_MAX_ENTRIES = 128;
const TRACE_ATTRIBUTE_KEY_MAX_LENGTH = 256;
const TRACE_SPAN_EVENT_MAX_ENTRIES = 256;
const TRACE_SPAN_LINK_MAX_ENTRIES = 128;
const OTLP_RESOURCE_SPAN_MAX_ENTRIES = 256;
const OTLP_SCOPE_SPAN_MAX_ENTRIES = 1_024;
const OTLP_TRACE_RECORD_MAX_ENTRIES = 4_096;
const TRACE_TEXT_MAX_LENGTH = 1_024;
const TRACE_STRUCTURE_TRUNCATED = "[Truncated]";
const TRACE_VALUE_UNSERIALIZABLE = "[Unserializable]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function markSeen(value: object, seen: WeakSet<object>): boolean {
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  return false;
}

function boundedTraceText(value: string, maxLength = TRACE_TEXT_MAX_LENGTH): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function boundedAttributeKey(key: string): string {
  return boundedTraceText(key, TRACE_ATTRIBUTE_KEY_MAX_LENGTH);
}

function setTraceRecordEntry(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function normalizeJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  try {
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value ?? null;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        ...(value.stack ? { stack: value.stack } : {}),
      };
    }
    if (depth >= TRACE_ATTRIBUTE_MAX_DEPTH) {
      return TRACE_STRUCTURE_TRUNCATED;
    }
    if (Array.isArray(value)) {
      if (markSeen(value, seen)) {
        return "[Circular]";
      }
      const normalized: unknown[] = [];
      const retained = Math.min(value.length, TRACE_ATTRIBUTE_MAX_ENTRIES);
      for (let index = 0; index < retained; index += 1) {
        normalized.push(normalizeJsonValue(value[index], seen, depth + 1));
      }
      if (value.length > retained) normalized.push(TRACE_STRUCTURE_TRUNCATED);
      return normalized;
    }
    if (value instanceof Map) {
      if (markSeen(value, seen)) {
        return "[Circular]";
      }
      const normalized: Record<string, unknown> = {};
      let retained = 0;
      for (const [key, entryValue] of value) {
        if (retained >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
          normalized[TRACE_STRUCTURE_TRUNCATED] = true;
          break;
        }
        setTraceRecordEntry(
          normalized,
          boundedAttributeKey(String(key)),
          normalizeJsonValue(entryValue, seen, depth + 1),
        );
        retained += 1;
      }
      return normalized;
    }
    if (value instanceof Set) {
      if (markSeen(value, seen)) {
        return "[Circular]";
      }
      const normalized: unknown[] = [];
      for (const entry of value) {
        if (normalized.length >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
          normalized.push(TRACE_STRUCTURE_TRUNCATED);
          break;
        }
        normalized.push(normalizeJsonValue(entry, seen, depth + 1));
      }
      return normalized;
    }
    if (!isPlainObject(value)) {
      return String(value);
    }
    if (markSeen(value, seen)) {
      return "[Circular]";
    }
    const normalized: Record<string, unknown> = {};
    let retained = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (retained >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
        normalized[TRACE_STRUCTURE_TRUNCATED] = true;
        break;
      }
      setTraceRecordEntry(
        normalized,
        boundedAttributeKey(key),
        normalizeJsonValue(value[key], seen, depth + 1),
      );
      retained += 1;
    }
    return normalized;
  } catch {
    return TRACE_VALUE_UNSERIALIZABLE;
  }
}

export function compactTraceAttributes(
  attributes: Readonly<Record<string, unknown>>,
): TraceAttributes {
  const normalized: Record<string, unknown> = {};
  let retained = 0;
  for (const key in attributes) {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
    if (LOCAL_TRACE_OMITTED_ATTRIBUTES.has(key)) continue;
    const value = attributes[key];
    if (value === undefined) continue;
    if (retained >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
      normalized[TRACE_STRUCTURE_TRUNCATED] = true;
      break;
    }
    setTraceRecordEntry(
      normalized,
      boundedAttributeKey(key),
      truncateNestedValue(normalizeJsonValue(value)),
    );
    retained += 1;
  }
  return normalized;
}

function formatTraceExit(exit: Exit.Exit<unknown, unknown>): EffectTraceRecord["exit"] {
  if (ExitRuntime.isSuccess(exit)) {
    return { _tag: "Success" };
  }
  if (Cause.hasInterruptsOnly(exit.cause)) {
    return {
      _tag: "Interrupted",
      cause: boundedTraceText(Cause.pretty(exit.cause), 4_096),
    };
  }
  return {
    _tag: "Failure",
    cause: boundedTraceText(Cause.pretty(exit.cause), 4_096),
  };
}

const TRACE_ATTRIBUTE_MAX_LENGTH = 500;
const TRACE_ATTRIBUTE_TRUNCATION_SUFFIX = "…[truncated]";
const LOCAL_TRACE_OMITTED_ATTRIBUTES: ReadonlySet<string> = new Set(["db.query.text"]);
const VERBOSE_LOCAL_SPAN_NAMES: ReadonlySet<string> = new Set([
  "runProjectorForEvent",
  "runAttachmentSideEffects",
]);

export function isVerboseLocalSpan(name: string): boolean {
  return name.startsWith("sql.") || VERBOSE_LOCAL_SPAN_NAMES.has(name);
}

// Clamps strings nested inside already-normalized attribute values (arrays and
// plain objects from normalizeJsonValue, e.g. an Error's `stack`). Returns the
// input reference when nothing was clamped.
function truncateNestedValue(value: unknown, depth = 0): unknown {
  try {
    if (typeof value === "string") {
      return value.length <= TRACE_ATTRIBUTE_MAX_LENGTH
        ? value
        : `${value.slice(0, TRACE_ATTRIBUTE_MAX_LENGTH)}${TRACE_ATTRIBUTE_TRUNCATION_SUFFIX}`;
    }
    if (depth >= TRACE_ATTRIBUTE_MAX_DEPTH && typeof value === "object" && value !== null) {
      return TRACE_STRUCTURE_TRUNCATED;
    }
    if (Array.isArray(value)) {
      const retained = Math.min(value.length, TRACE_ATTRIBUTE_MAX_ENTRIES);
      const truncated: unknown[] = [];
      let changed = retained !== value.length;
      for (let index = 0; index < retained; index += 1) {
        const current = value[index];
        const next = truncateNestedValue(current, depth + 1);
        truncated.push(next);
        changed ||= next !== current;
      }
      if (value.length > retained) truncated.push(TRACE_STRUCTURE_TRUNCATED);
      return changed ? truncated : value;
    }
    if (isPlainObject(value)) {
      const truncated: Record<string, unknown> = {};
      let changed = false;
      let retained = 0;
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (retained >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
          truncated[TRACE_STRUCTURE_TRUNCATED] = true;
          changed = true;
          break;
        }
        const boundedKey = boundedAttributeKey(key);
        const current = value[key];
        const next = truncateNestedValue(current, depth + 1);
        setTraceRecordEntry(truncated, boundedKey, next);
        changed ||= boundedKey !== key || next !== current;
        retained += 1;
      }
      return changed ? truncated : value;
    }
    return value;
  } catch {
    return TRACE_VALUE_UNSERIALIZABLE;
  }
}

/**
 * Clamps oversized attribute values on the serialized trace record so the file
 * sink stays small, including strings nested inside arrays and objects (e.g.
 * error stacks). Returns a new record when anything was clamped; never
 * mutates the input (the live span's attributes are shared with other tracers).
 */
export function truncateTraceAttributes(attributes: TraceAttributes): TraceAttributes {
  const truncated: Record<string, unknown> = {};
  let changed = false;
  let retained = 0;
  for (const key in attributes) {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
    if (LOCAL_TRACE_OMITTED_ATTRIBUTES.has(key)) {
      changed = true;
      continue;
    }
    if (retained >= TRACE_ATTRIBUTE_MAX_ENTRIES) {
      truncated[TRACE_STRUCTURE_TRUNCATED] = true;
      changed = true;
      break;
    }
    const boundedKey = boundedAttributeKey(key);
    const value = attributes[key];
    const next = truncateNestedValue(value);
    setTraceRecordEntry(truncated, boundedKey, next);
    changed ||= boundedKey !== key || next !== value;
    retained += 1;
  }
  return changed ? truncated : attributes;
}

export function spanToTraceRecord(span: SerializableSpan): EffectTraceRecord {
  const status = span.status as Extract<Tracer.SpanStatus, { _tag: "Ended" }>;
  const parentSpanId = Option.getOrUndefined(span.parent)?.spanId;

  return {
    type: "effect-span",
    name: boundedTraceText(span.name),
    traceId: span.traceId,
    spanId: span.spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    sampled: span.sampled,
    kind: span.kind,
    startTimeUnixNano: String(status.startTime),
    endTimeUnixNano: String(status.endTime),
    durationMs: Number(status.endTime - status.startTime) / 1_000_000,
    attributes: truncateTraceAttributes(
      compactTraceAttributes(Object.fromEntries(span.attributes)),
    ),
    events: span.events
      .slice(-TRACE_SPAN_EVENT_MAX_ENTRIES)
      .map(([name, startTime, attributes]) => ({
        name: boundedTraceText(name),
        timeUnixNano: String(startTime),
        attributes: truncateTraceAttributes(compactTraceAttributes(attributes)),
      })),
    links: span.links.slice(0, TRACE_SPAN_LINK_MAX_ENTRIES).map((link) => ({
      traceId: link.span.traceId,
      spanId: link.span.spanId,
      attributes: truncateTraceAttributes(compactTraceAttributes(link.attributes)),
    })),
    exit: formatTraceExit(status.exit),
  };
}

export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const sink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
    throwOnError: true,
  });

  let buffer: Array<string> = [];
  let pendingFlushStats: TraceSinkFlushStats = {
    logicalWriteBytes: 0,
    count: 0,
    durationMs: 0,
  };

  const flushUnsafe = () => {
    if (buffer.length === 0) {
      return;
    }

    const records = buffer;
    buffer = [];
    let persistedCount = 0;

    while (persistedCount < records.length) {
      const firstRecordBytes = textEncoder.encode(records[persistedCount]).byteLength;
      if (firstRecordBytes > options.maxBytes) {
        persistedCount += 1;
        continue;
      }

      let nextIndex = persistedCount + 1;
      let chunkBytes = firstRecordBytes;
      while (nextIndex < records.length) {
        const nextRecordBytes = textEncoder.encode(records[nextIndex]).byteLength;
        if (chunkBytes + nextRecordBytes > options.maxBytes) break;
        chunkBytes += nextRecordBytes;
        nextIndex += 1;
      }

      const chunk = records.slice(persistedCount, nextIndex).join("");
      const startedAt = performance.now();
      try {
        sink.write(chunk);
      } catch {
        buffer.unshift(...records.slice(persistedCount));
        return;
      }
      pendingFlushStats = {
        logicalWriteBytes: pendingFlushStats.logicalWriteBytes + chunkBytes,
        count: pendingFlushStats.count + nextIndex - persistedCount,
        durationMs: pendingFlushStats.durationMs + Math.max(0, performance.now() - startedAt),
      };
      persistedCount = nextIndex;
    }
  };

  const flush = Effect.sync(() => {
    flushUnsafe();
    const stats = pendingFlushStats;
    pendingFlushStats = {
      logicalWriteBytes: 0,
      count: 0,
      durationMs: 0,
    };
    return stats;
  }).pipe(
    Effect.flatMap((stats) =>
      stats.count > 0 && options.onFlush ? options.onFlush(stats).pipe(Effect.ignore) : Effect.void,
    ),
    Effect.withTracerEnabled(false),
  );

  yield* Effect.addFinalizer(() => flush.pipe(Effect.ignore));
  yield* Effect.forkScoped(
    Effect.sleep(`${options.batchWindowMs} millis`).pipe(Effect.andThen(flush), Effect.forever),
  );

  return {
    filePath: options.filePath,
    push(record) {
      try {
        buffer.push(`${JSON.stringify(record)}\n`);
        if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
          flushUnsafe();
        }
      } catch {
        return;
      }
    },
    flush,
    close: () => flush,
  } satisfies TraceSink;
});

class LocalFileSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Tracer.Span["annotations"];
  readonly links: Array<Tracer.SpanLink>;
  readonly sampled: boolean;
  readonly kind: Tracer.SpanKind;

  status: Tracer.SpanStatus;
  attributes: Map<string, unknown>;
  events: Array<[name: string, startTime: bigint, attributes: Record<string, unknown>]>;
  private readonly delegate: Tracer.Span;
  private readonly push: (record: EffectTraceRecord) => void;

  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    delegate: Tracer.Span,
    push: (record: EffectTraceRecord) => void,
  ) {
    this.delegate = delegate;
    this.push = push;
    this.name = delegate.name;
    this.spanId = delegate.spanId;
    this.traceId = delegate.traceId;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links.slice(0, TRACE_SPAN_LINK_MAX_ENTRIES);
    this.sampled = delegate.sampled;
    this.kind = delegate.kind;
    this.status = {
      _tag: "Started",
      startTime: options.startTime,
    };
    this.attributes = new Map();
    this.events = [];
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    this.status = {
      _tag: "Ended",
      startTime: this.status.startTime,
      endTime,
      exit,
    };
    this.delegate.end(endTime, exit);

    if (this.sampled && !isVerboseLocalSpan(this.name)) {
      try {
        this.push(spanToTraceRecord(this));
      } catch {
        // Observability must never fail the operation whose span just ended.
      }
    }
  }

  attribute(key: string, value: unknown): void {
    const retained = this.attributes.has(key) || this.attributes.size < TRACE_ATTRIBUTE_MAX_ENTRIES;
    if (retained) {
      this.attributes.set(key, value);
      this.delegate.attribute(key, value);
    }
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    const nextAttributes = attributes ?? {};
    const event: [name: string, startTime: bigint, attributes: Record<string, unknown>] = [
      name,
      startTime,
      nextAttributes,
    ];
    const retained = this.events.length < TRACE_SPAN_EVENT_MAX_ENTRIES;
    if (retained) {
      this.events.push(event);
      this.delegate.event(name, startTime, nextAttributes);
    } else {
      // Keep the beginning of the span plus its newest event without growing
      // one long-lived span for every progress heartbeat it observes.
      this.events[TRACE_SPAN_EVENT_MAX_ENTRIES - 1] = event;
    }
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    const remaining = TRACE_SPAN_LINK_MAX_ENTRIES - this.links.length;
    if (remaining <= 0) return;
    const retained = links.slice(0, remaining);
    this.links.push(...retained);
    this.delegate.addLinks(retained);
  }
}

export const makeLocalFileTracer = Effect.fn("makeLocalFileTracer")(function* (
  options: LocalFileTracerOptions,
) {
  const sink =
    options.sink ??
    (yield* makeTraceSink({
      filePath: options.filePath,
      maxBytes: options.maxBytes,
      maxFiles: options.maxFiles,
      batchWindowMs: options.batchWindowMs,
      ...(options.onFlush ? { onFlush: options.onFlush } : {}),
    }));

  const delegate =
    options.delegate ??
    Tracer.make({
      span: (spanOptions) => new Tracer.NativeSpan(spanOptions),
    });

  return Tracer.make({
    span(spanOptions) {
      const boundedOptions = {
        ...spanOptions,
        links: spanOptions.links.slice(0, TRACE_SPAN_LINK_MAX_ENTRIES),
      };
      return new LocalFileSpan(boundedOptions, delegate.span(boundedOptions), sink.push);
    },
    ...(delegate.context ? { context: delegate.context } : {}),
  });
});

const SPAN_KIND_MAP: Record<number, OtlpTraceRecord["kind"]> = {
  1: "internal",
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
};

export function decodeOtlpTraceRecords(
  payload: OtlpTracer.TraceData,
): ReadonlyArray<OtlpTraceRecord> {
  const records: Array<OtlpTraceRecord> = [];
  let resourceSpanCount = 0;
  let scopeSpanCount = 0;

  resourceSpans: for (const resourceSpan of payload.resourceSpans) {
    resourceSpanCount += 1;
    if (resourceSpanCount > OTLP_RESOURCE_SPAN_MAX_ENTRIES) break;
    const resourceAttributes = decodeAttributes(resourceSpan.resource?.attributes ?? []);

    for (const scopeSpan of resourceSpan.scopeSpans) {
      scopeSpanCount += 1;
      if (scopeSpanCount > OTLP_SCOPE_SPAN_MAX_ENTRIES) break resourceSpans;
      for (const span of scopeSpan.spans) {
        if (records.length >= OTLP_TRACE_RECORD_MAX_ENTRIES) break resourceSpans;
        records.push(
          otlpSpanToTraceRecord({
            resourceAttributes,
            scopeAttributes: decodeAttributes(
              "attributes" in scopeSpan.scope && Array.isArray(scopeSpan.scope.attributes)
                ? scopeSpan.scope.attributes
                : [],
            ),
            scopeName: scopeSpan.scope.name,
            scopeVersion:
              "version" in scopeSpan.scope && typeof scopeSpan.scope.version === "string"
                ? scopeSpan.scope.version
                : undefined,
            span,
          }),
        );
      }
    }
  }

  return records;
}

function otlpSpanToTraceRecord(input: {
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
  readonly scopeAttributes: Readonly<Record<string, unknown>>;
  readonly scopeName: string | undefined;
  readonly scopeVersion: string | undefined;
  readonly span: OtlpSpan;
}): OtlpTraceRecord {
  return {
    type: "otlp-span",
    name: boundedTraceText(input.span.name),
    traceId: boundedTraceText(input.span.traceId, 128),
    spanId: boundedTraceText(input.span.spanId, 64),
    ...(input.span.parentSpanId
      ? { parentSpanId: boundedTraceText(input.span.parentSpanId, 64) }
      : {}),
    sampled: true,
    kind: normalizeSpanKind(input.span.kind),
    startTimeUnixNano: boundedTraceText(input.span.startTimeUnixNano, 64),
    endTimeUnixNano: boundedTraceText(input.span.endTimeUnixNano, 64),
    durationMs:
      Number(parseBigInt(input.span.endTimeUnixNano) - parseBigInt(input.span.startTimeUnixNano)) /
      1_000_000,
    attributes: decodeAttributes(input.span.attributes),
    resourceAttributes: input.resourceAttributes,
    scope: {
      ...(input.scopeName ? { name: boundedTraceText(input.scopeName) } : {}),
      ...(input.scopeVersion ? { version: boundedTraceText(input.scopeVersion) } : {}),
      attributes: input.scopeAttributes,
    },
    events: decodeEvents(input.span.events),
    links: decodeLinks(input.span.links),
    status: decodeStatus(input.span.status),
  };
}

function decodeStatus(input: OtlpSpanStatus): OtlpTraceRecord["status"] {
  const code = boundedTraceText(String(input.code), 64);
  const message = input.message;

  return {
    code,
    ...(message ? { message: boundedTraceText(message) } : {}),
  };
}

function decodeEvents(input: ReadonlyArray<OtlpSpanEvent>): ReadonlyArray<TraceRecordEvent> {
  return input.slice(-TRACE_SPAN_EVENT_MAX_ENTRIES).map((current) => ({
    name: boundedTraceText(current.name),
    timeUnixNano: boundedTraceText(current.timeUnixNano, 64),
    attributes: decodeAttributes(current.attributes),
  }));
}

function decodeLinks(input: ReadonlyArray<OtlpSpanLink>): ReadonlyArray<TraceRecordLink> {
  return input.slice(0, TRACE_SPAN_LINK_MAX_ENTRIES).map((current) => {
    const traceId = boundedTraceText(current.traceId, 128);
    const spanId = boundedTraceText(current.spanId, 64);
    return {
      traceId,
      spanId,
      attributes: decodeAttributes(current.attributes),
    };
  });
}

function decodeAttributes(
  input: ReadonlyArray<OtlpResource.KeyValue>,
): Readonly<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};

  for (const attribute of input.slice(0, TRACE_ATTRIBUTE_MAX_ENTRIES)) {
    setTraceRecordEntry(entries, boundedAttributeKey(attribute.key), decodeValue(attribute.value));
  }

  return compactTraceAttributes(entries);
}

function decodeValue(input: OtlpResource.AnyValue | null | undefined, depth = 0): unknown {
  if (input == null) {
    return null;
  }
  if (depth >= TRACE_ATTRIBUTE_MAX_DEPTH) {
    return TRACE_STRUCTURE_TRUNCATED;
  }
  if ("stringValue" in input) {
    return input.stringValue;
  }
  if ("boolValue" in input) {
    return input.boolValue;
  }
  if ("intValue" in input) {
    return input.intValue;
  }
  if ("doubleValue" in input) {
    return input.doubleValue;
  }
  if ("bytesValue" in input) {
    return input.bytesValue;
  }
  if (input.arrayValue) {
    return input.arrayValue.values
      .slice(0, TRACE_ATTRIBUTE_MAX_ENTRIES)
      .map((entry) => decodeValue(entry, depth + 1));
  }
  if (input.kvlistValue) {
    const entries: Record<string, unknown> = {};
    for (const attribute of input.kvlistValue.values.slice(0, TRACE_ATTRIBUTE_MAX_ENTRIES)) {
      setTraceRecordEntry(
        entries,
        boundedAttributeKey(attribute.key),
        decodeValue(attribute.value, depth + 1),
      );
    }
    return compactTraceAttributes(entries);
  }
  return null;
}

function normalizeSpanKind(input: number): OtlpTraceRecord["kind"] {
  return SPAN_KIND_MAP[input] || "internal";
}

function parseBigInt(input: string): bigint {
  if (input.length > 64) return 0n;
  try {
    return BigInt(input);
  } catch {
    return 0n;
  }
}
