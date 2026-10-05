import type * as Sentry from "@sentry/node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { LogsData } from "effect/unstable/observability/OtlpLogger";
import * as OtlpResource from "effect/unstable/observability/OtlpResource";
import * as OtlpSerialization from "effect/unstable/observability/OtlpSerialization";
import type { TraceData } from "effect/unstable/observability/OtlpTracer";

import packageJson from "../../package.json" with { type: "json" };
import { releaseHttpClientResponseBody } from "../stream/releaseHttpClientResponseBody.ts";
import { type AgentObservation } from "./AgentObservation.ts";

export class AgentMonitoringExportError extends Schema.TaggedError<AgentMonitoringExportError>()(
  "AgentMonitoringExportError",
  { operation: Schema.String },
) {
  override get message() {
    return "Agent monitoring export was not acknowledged.";
  }
}

export class AgentMonitoringExporter extends Context.Service<
  AgentMonitoringExporter,
  {
    readonly configured: boolean;
    readonly send: (
      observations: ReadonlyArray<AgentObservation>,
    ) => Effect.Effect<void, AgentMonitoringExportError>;
  }
>()("t3/observability/AgentMonitoringExporter") {}

export interface ExportConfiguration {
  readonly dsn?: string | undefined;
  /** An explicit local collector override. Never reuses the broad application exporter. */
  readonly otlpBaseUrl?: string | undefined;
  readonly protocol: "http/json" | "http/protobuf";
}

const nano = (millis: number) => (BigInt(Math.trunc(millis)) * 1_000_000n).toString();
const rejectedCount = Schema.Union([Schema.Finite, Schema.FiniteFromString]);
const decodeAcknowledgment = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      partialSuccess: Schema.optional(
        Schema.Struct({
          rejectedSpans: Schema.optional(rejectedCount),
          rejectedLogRecords: Schema.optional(rejectedCount),
          errorMessage: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
  { onExcessProperty: "error" },
);
const attributes = (record: AgentObservation) =>
  OtlpResource.entriesToAttributes(
    Object.entries({
      ...record.attributes,
      "t3.observation_id": record.id,
      // Keep provider lifecycle/error observations outside model-request metrics.
      ...(record.operation === "invoke_agent"
        ? { "gen_ai.operation.type": "agent" }
        : record.operation === "execute_tool"
          ? { "gen_ai.operation.type": "tool" }
          : {}),
      "sentry.op":
        record.operation === "invoke_agent"
          ? "gen_ai.invoke_agent"
          : record.operation === "execute_tool"
            ? "gen_ai.execute_tool"
            : record.operation,
    }),
  );

/** Synthetic exceptions group across environments without exporting provider messages or stacks. */
export function toSentryAgentError(record: AgentObservation): Sentry.ErrorEvent | undefined {
  if (record.status !== "failed" || !["error", "tool", "subagent"].includes(record.kind))
    return undefined;
  const category = String(record.attributes["t3.error_class"] ?? "operation_failed");
  const provider = String(record.attributes["t3.provider"] ?? "unknown");
  const tool = String(record.attributes["gen_ai.tool.name"] ?? record.operation);
  const code = String(record.attributes["t3.error_code"] ?? "unknown");
  return {
    type: undefined,
    event_id: record.id,
    timestamp: record.observedAt / 1000,
    level: category === "usage_limit" ? "warning" : "error",
    platform: "node",
    release: `t3@${packageJson.version}`,
    fingerprint: ["t3-agent-v1", record.kind, provider, tool, category, code],
    exception: { values: [{ type: `T3Agent_${category}`, value: `${category} during ${tool}` }] },
    tags: {
      "t3.provider": provider,
      "t3.kind": record.kind,
      "t3.tool": tool,
      "t3.error_class": category,
      "t3.environment_id": String(record.attributes["t3.environment_id"]),
    },
    contexts: { trace: { trace_id: record.traceId, span_id: record.spanId, op: record.operation } },
  };
}

const make = (configuration: ExportConfiguration) =>
  Effect.gen(function* () {
    if (!configuration.dsn && !configuration.otlpBaseUrl)
      return AgentMonitoringExporter.of({ configured: false, send: () => Effect.void });
    const http = yield* HttpClient.HttpClient;
    const serialization = yield* OtlpSerialization.OtlpSerialization;
    // Import the SDK only for opted-in hosts with a destination. No global client or auto instrumentation.
    const sentry = yield* Effect.tryPromise({
      try: () => import("@sentry/node"),
      catch: () => new AgentMonitoringExportError({ operation: "initialize" }),
    });
    const endpoint = configuration.dsn
      ? sentry.getOtlpTracesEndpoint(configuration.dsn)
      : undefined;
    if (configuration.dsn && !endpoint)
      return yield* new AgentMonitoringExportError({ operation: "invalid DSN" });
    const tracesUrl = configuration.otlpBaseUrl
      ? `${configuration.otlpBaseUrl.replace(/\/$/, "")}/v1/traces`
      : endpoint!.url;
    const logsUrl = configuration.otlpBaseUrl
      ? `${configuration.otlpBaseUrl.replace(/\/$/, "")}/v1/logs`
      : endpoint!.url.replace(/\/traces\/?$/, "/logs/");
    const headers = configuration.otlpBaseUrl ? {} : endpoint!.headers;
    const expectedErrors = new Set<string>();
    const deliveredErrors = new Set<string>();
    const safeErrors = new Map<string, Sentry.ErrorEvent>();
    const client = configuration.dsn
      ? yield* Effect.acquireRelease(
          Effect.sync(() => {
            const client = new sentry.NodeClient({
              dsn: configuration.dsn,
              integrations: [],
              stackParser: sentry.defaultStackParser,
              enableOpenTelemetrySetup: false,
              enableRuntimeChannelInjection: false,
              includeServerName: false,
              dataCollection: {
                userInfo: false,
                cookies: false,
                httpHeaders: false,
                httpBodies: [],
                urlQueryParams: false,
                graphQL: { document: false, variables: false },
                genAI: { inputs: false, outputs: false },
                databaseQueryData: false,
                queues: false,
                stackFrameVariables: false,
                frameContextLines: 0,
              },
              sendClientReports: false,
              // Strip SDK enrichment as well as any globally configured scope data.
              beforeSend: (event) => {
                const safe = event.event_id ? safeErrors.get(event.event_id) : undefined;
                if (event.event_id) safeErrors.delete(event.event_id);
                return safe ?? null;
              },
              transport: (options) => {
                const transport = sentry.makeNodeTransport(options);
                return {
                  flush: transport.flush,
                  send: (envelope) =>
                    transport.send(envelope).then(
                      (response) => {
                        if (
                          response.statusCode &&
                          response.statusCode >= 200 &&
                          response.statusCode < 300
                        ) {
                          for (const [header, payload] of envelope[1]) {
                            if (
                              header.type === "event" &&
                              typeof payload === "object" &&
                              payload !== null &&
                              "event_id" in payload &&
                              typeof payload.event_id === "string" &&
                              expectedErrors.has(payload.event_id)
                            ) {
                              deliveredErrors.add(payload.event_id);
                            }
                          }
                        }
                        return response;
                      },
                      (error: unknown) => {
                        throw error;
                      },
                    ),
                };
              },
            });
            client.init();
            return client;
          }),
          (client) => Effect.promise(() => Promise.resolve(client.close(2000))).pipe(Effect.ignore),
        )
      : undefined;

    const resource = OtlpResource.make({
      serviceName: "t3code-server",
      serviceVersion: packageJson.version,
      attributes: { "service.namespace": "t3code", "t3.signal": "agents" },
    });
    const scope = { name: "t3.agent-monitoring", version: "1" };
    const post = (url: string, body: HttpBody.HttpBody, operation: string) =>
      Effect.gen(function* () {
        const response = yield* http.execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.setHeaders(headers),
            HttpClientRequest.setBody(body),
          ),
        );
        if (response.status < 200 || response.status >= 300) {
          yield* releaseHttpClientResponseBody(response);
          return yield* new AgentMonitoringExportError({ operation });
        }
        let responseBytes = 0;
        const chunks = yield* response.stream.pipe(
          Stream.mapEffect((chunk) => {
            responseBytes += chunk.byteLength;
            return responseBytes > 65_536
              ? new AgentMonitoringExportError({ operation })
              : Effect.succeed(chunk);
          }),
          Stream.runCollect,
        );
        if (responseBytes > 0) {
          const text = Buffer.concat(chunks).toString("utf8").trim();
          // Empty protobuf acknowledgments have no fields. Conservatively retry nonempty binary
          // responses, which may represent partial rejection, rather than acknowledging lost records.
          const acknowledgment = yield* decodeAcknowledgment(text);
          if (
            (acknowledgment.partialSuccess?.rejectedSpans ?? 0) !== 0 ||
            (acknowledgment.partialSuccess?.rejectedLogRecords ?? 0) !== 0
          )
            return yield* new AgentMonitoringExportError({ operation });
        }
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() => new AgentMonitoringExportError({ operation })),
      );

    const send: AgentMonitoringExporter["Service"]["send"] = (records) =>
      Effect.gen(function* () {
        if (records.length === 0) return;
        const logs: LogsData = {
          resourceLogs: [
            {
              resource,
              scopeLogs: [
                {
                  scope,
                  logRecords: records.map((record) => ({
                    timeUnixNano: nano(record.observedAt),
                    observedTimeUnixNano: nano(record.observedAt),
                    severityNumber: record.status === "failed" ? 17 : 9,
                    severityText: record.status === "failed" ? "ERROR" : "INFO",
                    body: { stringValue: String(record.attributes["t3.summary"]) },
                    attributes: attributes(record),
                    droppedAttributesCount: 0,
                    traceId: record.traceId,
                    spanId: record.spanId,
                  })),
                },
              ],
            },
          ],
        };
        yield* post(logsUrl, serialization.logs(logs), "logs");
        const completed = records.filter((record) => record.completedAt !== undefined);
        if (completed.length > 0) {
          const traces: TraceData = {
            resourceSpans: [
              {
                resource,
                scopeSpans: [
                  {
                    scope,
                    spans: completed.map((record) => ({
                      traceId: record.traceId,
                      spanId: record.spanId,
                      parentSpanId: record.parentSpanId,
                      name: String(record.attributes["gen_ai.tool.name"] ?? record.operation),
                      kind: 1,
                      startTimeUnixNano: nano(record.startedAt),
                      endTimeUnixNano: nano(record.completedAt!),
                      attributes: attributes(record),
                      droppedAttributesCount: 0,
                      events: [],
                      droppedEventsCount: 0,
                      links: [],
                      droppedLinksCount: 0,
                      status: { code: record.status === "failed" ? 2 : 1 },
                    })),
                  },
                ],
              },
            ],
          };
          yield* post(tracesUrl, serialization.traces(traces), "traces");
        }
        if (client) {
          const errors = records.flatMap((record) => {
            const event = toSentryAgentError(record);
            return event ? [event] : [];
          });
          if (errors.length === 0) return;
          expectedErrors.clear();
          deliveredErrors.clear();
          for (const event of errors) {
            expectedErrors.add(event.event_id!);
            safeErrors.set(event.event_id!, event);
            client.captureEvent(event);
          }
          const flushed = yield* Effect.tryPromise({
            try: () => Promise.resolve(client.flush(10_000)),
            catch: () => new AgentMonitoringExportError({ operation: "errors" }),
          });
          // flush() alone can succeed when rate limits discarded an event before transport.send().
          if (!flushed || !errors.every((event) => deliveredErrors.has(event.event_id!)))
            return yield* new AgentMonitoringExportError({ operation: "errors" });
        }
      });
    return AgentMonitoringExporter.of({ configured: true, send });
  });

export const layer = (configuration: ExportConfiguration) =>
  Layer.effect(AgentMonitoringExporter, make(configuration)).pipe(
    Layer.provide(
      configuration.protocol === "http/json"
        ? OtlpSerialization.layerJson
        : OtlpSerialization.layerProtobuf,
    ),
  );
