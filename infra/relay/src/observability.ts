import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Output from "alchemy/Output";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { relayResourceNameForStage } from "./deploymentConfig.ts";

const relayRecentSpansQuery = (dataset: string) =>
  [
    `['${dataset}']`,
    `| where isnotnull(span_id) or isnotnull(trace_id)`,
    `| extend requestMethod = column_ifexists('attributes.http.request.method', ''), path = column_ifexists('attributes.url.path', ''), endpoint = column_ifexists('attributes.http.route', ''), statusCode = column_ifexists('attributes.http.response.status_code', 0), customAttributes = column_ifexists('attributes.custom', dynamic({}))`,
    `| extend userId = customAttributes['user']['id']`,
    `| project _time, name, trace_id, span_id, duration, requestMethod, path, statusCode, endpoint, userId`,
    `| order by _time desc`,
    `| limit 200`,
  ].join("\n");

export const RelayObservability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const traces = yield* Axiom.Dataset("RelayTracesDataset", {
    name: relayResourceNameForStage("t3-code-relay-traces", stage),
    kind: "otel:traces:v1",
    description: "T3 Code relay Worker HTTP request spans.",
    retentionDays: 30,
    useRetentionPeriod: true,
  });

  const workerIngestToken = yield* Axiom.ApiToken("RelayWorkerAxiomIngestToken", {
    name: relayResourceNameForStage("t3-code-relay-otel-ingest", stage),
    description: "Owned by Alchemy. Scoped OTLP ingest token for relay HTTP spans.",
    datasetCapabilities: Output.map(traces.name, (dataset) => ({
      [dataset]: { ingest: ["create" as const] },
    })),
  });

  const mobileIngestToken = yield* Axiom.ApiToken("RelayMobileAxiomIngestToken", {
    name: relayResourceNameForStage("t3-code-mobile-otel-ingest", stage),
    description: "Owned by Alchemy. Scoped OTLP ingest token for T3 Code mobile spans.",
    datasetCapabilities: Output.map(traces.name, (dataset) => ({
      [dataset]: { ingest: ["create" as const] },
    })),
  });

  const clientIngestToken = yield* Axiom.ApiToken("RelayClientAxiomIngestToken", {
    name: relayResourceNameForStage("t3-code-relay-client-otel-ingest", stage),
    description: "Owned by Alchemy. Scoped OTLP ingest token for first-party relay client spans.",
    datasetCapabilities: Output.map(traces.name, (dataset) => ({
      [dataset]: { ingest: ["create" as const] },
    })),
  });

  yield* Axiom.View("RelayRecentSpansView", {
    name: relayResourceNameForStage("t3-code-relay-recent-spans", stage),
    description: "Recent relay HTTP request spans.",
    datasets: [traces.name],
    aplQuery: Output.map(traces.name, relayRecentSpansQuery),
  });

  return { traces, workerIngestToken, mobileIngestToken, clientIngestToken } as const;
});

export const withSpanAttributes =
  (attributes: Record<string, unknown>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.annotateCurrentSpan(attributes).pipe(
      Effect.andThen(effect.pipe(Effect.annotateSpans(attributes))),
    );

export const RELAY_SCHEMA_ERROR_ATTRIBUTE_MAX_COUNT = 32;
export const RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH = 1_024;
export const RELAY_SCHEMA_ERROR_ATTRIBUTE_ARRAY_MAX_COUNT = 16;

type RelayTraceAttributeScalar = string | number | boolean | bigint;

function boundedTraceAttribute(
  value: unknown,
): RelayTraceAttributeScalar | ReadonlyArray<RelayTraceAttributeScalar> | undefined {
  if (typeof value === "string") {
    return value.slice(0, RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const bounded: RelayTraceAttributeScalar[] = [];
  let elementType: "string" | "number" | "boolean" | "bigint" | undefined;
  for (const item of value.slice(0, RELAY_SCHEMA_ERROR_ATTRIBUTE_ARRAY_MAX_COUNT)) {
    const itemType = typeof item;
    if (
      (itemType !== "string" &&
        itemType !== "number" &&
        itemType !== "boolean" &&
        itemType !== "bigint") ||
      (elementType !== undefined && itemType !== elementType)
    ) {
      return undefined;
    }
    elementType = itemType;
    bounded.push(
      itemType === "string"
        ? (item as string).slice(0, RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH)
        : (item as number | boolean | bigint),
    );
  }
  return bounded;
}

export const schemaErrorAttributes = (error: unknown): Record<string, unknown> | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  let constructor: unknown;
  try {
    constructor = Object.getPrototypeOf(error)?.constructor;
  } catch {
    return undefined;
  }
  if (!Schema.isSchema(constructor) || !("fields" in constructor)) {
    return undefined;
  }

  const fields = constructor.fields;
  if (typeof fields !== "object" || fields === null) {
    return undefined;
  }
  const tag = Object.getOwnPropertyDescriptor(error, "_tag")?.value;
  if (typeof tag !== "string") {
    return undefined;
  }

  const attributes: Record<string, unknown> = {
    "error.type": tag.slice(0, RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH),
  };
  let attributeCount = 1;
  for (const key of Object.keys(fields)) {
    if (
      attributeCount >= RELAY_SCHEMA_ERROR_ATTRIBUTE_MAX_COUNT ||
      key === "_tag" ||
      key === "cause"
    ) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (!descriptor || !("value" in descriptor)) {
      continue;
    }
    const value = boundedTraceAttribute(descriptor.value);
    if (value !== undefined) {
      attributes[`error.${key}`] = value;
      attributeCount += 1;
    }
  }
  return attributes;
};

const annotateSchemaError = (span: Tracer.Span, exit: Exit.Exit<unknown, unknown>): void => {
  if (Exit.isSuccess(exit)) {
    return;
  }
  for (const reason of exit.cause.reasons) {
    const error = Cause.isFailReason(reason)
      ? reason.error
      : Cause.isDieReason(reason)
        ? reason.defect
        : undefined;
    const attributes = schemaErrorAttributes(error);
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.attribute(key, value);
      }
      return;
    }
  }
};

class RelayTraceSpan implements Tracer.Span {
  readonly _tag = "Span";
  private readonly delegate: Tracer.Span;

  constructor(delegate: Tracer.Span) {
    this.delegate = delegate;
  }

  get name() {
    return this.delegate.name;
  }
  get spanId() {
    return this.delegate.spanId;
  }
  get traceId() {
    return this.delegate.traceId;
  }
  get parent() {
    return this.delegate.parent;
  }
  get annotations() {
    return this.delegate.annotations;
  }
  get status() {
    return this.delegate.status;
  }
  get attributes() {
    return this.delegate.attributes;
  }
  get links() {
    return this.delegate.links;
  }
  get sampled() {
    return this.delegate.sampled;
  }
  get kind() {
    return this.delegate.kind;
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    annotateSchemaError(this.delegate, exit);
    this.delegate.end(endTime, exit);
  }

  attribute(key: string, value: unknown): void {
    this.delegate.attribute(key, value);
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    this.delegate.event(name, startTime, attributes);
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.delegate.addLinks(links);
  }
}

const withSchemaErrorAttributes = (delegate: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span: (options) => new RelayTraceSpan(delegate.span(options)),
    ...(delegate.context ? { context: delegate.context } : {}),
  });

export const makeRelayTraceLayer = (input: {
  readonly tracesEndpoint: string;
  readonly tracesDatasetName: string;
  readonly ingestToken: Redacted.Redacted<string>;
}) =>
  Layer.effect(
    Tracer.Tracer,
    OtlpTracer.make({
      url: input.tracesEndpoint,
      resource: {
        serviceName: "t3-code-relay-worker",
        attributes: {
          "service.runtime": "cloudflare-worker",
          "service.component": "relay",
        },
      },
      headers: {
        Authorization: `Bearer ${Redacted.value(input.ingestToken)}`,
        "X-Axiom-Dataset": input.tracesDatasetName,
      },
      exportInterval: "1 second",
    }).pipe(Effect.map(withSchemaErrorAttributes)),
  ).pipe(Layer.provideMerge(OtlpExporter.layerFlusher), Layer.provide(OtlpSerialization.layerJson));
