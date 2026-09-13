import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import type { HttpClient } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

export interface RelayClientTracingConfig {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
}

export interface RelayClientTracingResource {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly runtime: string;
  readonly client: string;
  readonly component?: string;
}

const TRACE_ERROR_MESSAGE_MAX_LENGTH = 4_096;
const TRACE_ERROR_NAME_MAX_LENGTH = 128;
const TRACE_ERROR_STACK_MAX_LENGTH = 64 * 1_024;
const TRACE_ERROR_CAUSE_MAX_DEPTH = 16;
const TRACE_EXIT_REASON_LIMIT = 64;

export class RelayClientTracer extends Context.Reference(
  "@t3tools/shared/relayTracing/RelayClientTracer",
  {
    defaultValue: () => Option.none<Tracer.Tracer>(),
  },
) {}

export const withRelayClientTracing = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  RelayClientTracer.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => effect,
        onSome: (tracer) => effect.pipe(Effect.provideService(Tracer.Tracer, tracer)),
      }),
    ),
  );

function readProperty(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

function fallbackTraceMessage(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return value.slice(0, TRACE_ERROR_MESSAGE_MAX_LENGTH);
    case "boolean":
    case "number":
    case "bigint":
    case "undefined":
      return String(value);
    case "symbol":
      return value.description?.slice(0, TRACE_ERROR_MESSAGE_MAX_LENGTH) ?? "symbol";
    case "function":
      return "function";
    case "object":
      return "object";
  }
  return "unknown";
}

function cleanTraceStack(value: object, name: string, message: string): string {
  const stack =
    boundedString(readProperty(value, "stack"), TRACE_ERROR_STACK_MAX_LENGTH) ??
    `${name}: ${message}`;
  const lines = stack.split("\n");
  const effectFrameIndex = lines.findIndex(
    (line, index) => index > 0 && /(?:Generator\.next|~effect\/Effect)/.test(line),
  );
  return effectFrameIndex < 0 ? stack : lines.slice(0, effectFrameIndex).join("\n");
}

function traceSafeError(value: unknown, seen = new WeakSet<object>(), depth = 0): Error {
  const record = typeof value === "object" && value !== null ? value : undefined;
  const message =
    boundedString(
      record === undefined ? undefined : readProperty(record, "message"),
      TRACE_ERROR_MESSAGE_MAX_LENGTH,
    ) ?? fallbackTraceMessage(value);
  const name =
    boundedString(
      record === undefined ? undefined : readProperty(record, "name"),
      TRACE_ERROR_NAME_MAX_LENGTH,
    ) ?? "Error";

  let cause: Error | undefined;
  if (record !== undefined && !seen.has(record)) {
    seen.add(record);
    const causeValue = readProperty(record, "cause");
    if (causeValue !== undefined) {
      cause =
        depth < TRACE_ERROR_CAUSE_MAX_DEPTH
          ? traceSafeError(causeValue, seen, depth + 1)
          : new Error(`Additional cause omitted after ${TRACE_ERROR_CAUSE_MAX_DEPTH} levels.`);
    }
  }

  const error = new Error(message, cause ? { cause } : undefined);
  error.name = name;
  if (record !== undefined) {
    error.stack = cleanTraceStack(record, name, message);
  }
  if (cause) {
    error.stack =
      `${error.stack ?? `${error.name}: ${error.message}`}\nCaused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`.slice(
        0,
        TRACE_ERROR_STACK_MAX_LENGTH,
      );
  }
  return error;
}

function traceSafeExit(exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> {
  if (Exit.isSuccess(exit)) {
    return exit;
  }
  const reasons: Array<Cause.Reason<unknown>> = [];
  const retainedCount = Math.min(exit.cause.reasons.length, TRACE_EXIT_REASON_LIMIT);
  for (let index = 0; index < retainedCount; index += 1) {
    const reason = exit.cause.reasons[index];
    if (reason === undefined) continue;
    if (Cause.isFailReason(reason)) {
      reasons.push(Cause.makeFailReason(traceSafeError(reason.error)));
    } else if (Cause.isDieReason(reason)) {
      reasons.push(Cause.makeDieReason(traceSafeError(reason.defect)));
    } else {
      reasons.push(reason);
    }
  }
  if (exit.cause.reasons.length > retainedCount) {
    reasons.push(
      Cause.makeDieReason(
        new Error(`${exit.cause.reasons.length - retainedCount} additional reasons omitted.`),
      ),
    );
  }
  return Exit.failCause(Cause.fromReasons(reasons));
}

function nonInterferingTracer(delegate: Tracer.Tracer): Tracer.Tracer {
  return Tracer.make({
    span(options) {
      const span = delegate.span(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        try {
          end(endTime, traceSafeExit(exit));
        } catch {
          // Telemetry is best-effort and must never change application behavior.
        }
      };
      return span;
    },
    ...(delegate.context ? { context: delegate.context } : {}),
  });
}

export function makeRelayClientTracingLayer(
  config: RelayClientTracingConfig | null,
  resource: RelayClientTracingResource,
): Layer.Layer<never, never, HttpClient.HttpClient> {
  if (config === null) {
    return Layer.succeed(RelayClientTracer, Option.none());
  }

  const tracerLayer = OtlpTracer.layer({
    url: config.tracesUrl,
    headers: {
      Authorization: `Bearer ${config.tracesToken}`,
      "X-Axiom-Dataset": config.tracesDataset,
    },
    resource: {
      serviceName: resource.serviceName,
      serviceVersion: resource.serviceVersion,
      attributes: {
        "service.runtime": resource.runtime,
        "service.component": resource.component ?? "relay-client",
        "t3.client.surface": resource.client,
      },
    },
  }).pipe(Layer.provide(OtlpSerialization.layerJson));

  return Layer.effect(
    RelayClientTracer,
    Tracer.Tracer.pipe(Effect.map(nonInterferingTracer), Effect.map(Option.some)),
  ).pipe(Layer.provide(tracerLayer));
}
