// @effect-diagnostics nodeBuiltinImport:off - the test owns a local HTTP ingestion receiver.
import * as NodeHttp from "node:http";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  NonNegativeInt,
  PositiveInt,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestrationEventStoreLive } from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
const SqlitePersistenceMemory = SqlitePersistence.layerMemory;
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import * as AgentMonitoring from "./AgentMonitoring.ts";
import * as Settings from "../serverSettings.ts";
import * as Exporter from "./AgentMonitoringExporter.ts";
import * as Journal from "./AgentMonitoringJournal.ts";
import { type AgentObservation, toAgentObservation } from "./AgentObservation.ts";

const privateContent = "Bearer CANARY_private_prompt_command_output_and_error";
const threadId = ThreadId.make("thread:CANARY_private_thread");
const runId = RunId.make("run:CANARY_private_run");
const at = DateTime.makeUnsafe(1_800_000_000_000);
const run: OrchestrationV2Run = {
  id: runId,
  threadId,
  ordinal: PositiveInt.make(1),
  providerInstanceId: ProviderInstanceId.make("codex-local"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex-local"), model: "gpt-6.1-sol" },
  providerThreadId: null,
  userMessageId: MessageId.make("message:private"),
  rootNodeId: null,
  activeAttemptId: null,
  status: "running",
  requestedAt: at,
  startedAt: at,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
};
const toolBase = {
  id: TurnItemId.make("tool:1"),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: PositiveInt.make(1),
  status: "completed" as const,
  title: privateContent,
  startedAt: at,
  completedAt: DateTime.add(at, { seconds: 1 }),
  updatedAt: at,
};
const toolEvent = (
  id = "tool-event",
  failed = false,
  entity = "tool:1",
): OrchestrationV2DomainEvent => ({
  id: EventId.make(id),
  type: "turn-item.updated",
  threadId,
  runId,
  driver: ProviderDriverKind.make("codex"),
  occurredAt: at,
  payload: {
    ...toolBase,
    id: TurnItemId.make(entity),
    type: "command_execution",
    input: privateContent,
    output: privateContent,
    exitCode: 1,
    outputIndicatesFailure: failed,
  },
});
const errorEvent = (id = "error-event", attempt?: number): OrchestrationV2DomainEvent => ({
  ...toolEvent(id),
  type: "turn-item.updated",
  payload: {
    ...toolBase,
    id: TurnItemId.make("error:1"),
    type: "error",
    failure: {
      class: "transport_error",
      message: privateContent,
      code: privateContent,
      retryable: true,
    },
    ...(attempt === undefined
      ? {}
      : {
          retry: {
            attempt: PositiveInt.make(attempt),
            maxAttempts: PositiveInt.make(3),
            retryDelayMs: NonNegativeInt.make(10),
          },
        }),
  },
});
const observe = (
  event: OrchestrationV2DomainEvent,
  sequence = 1,
  environment = "host-a",
): AgentObservation => {
  const record = toAgentObservation(
    { sequence: NonNegativeInt.make(sequence), commandId: null, event },
    environment,
  );
  assert.ok(record);
  return record;
};
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeTracePayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      resourceSpans: Schema.Array(
        Schema.Struct({
          scopeSpans: Schema.Array(
            Schema.Struct({
              spans: Schema.Array(
                Schema.Struct({
                  attributes: Schema.Array(
                    Schema.Struct({
                      key: Schema.String,
                      value: Schema.Struct({ stringValue: Schema.optional(Schema.String) }),
                    }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
);

const receiver = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{
        url: string;
        server: NodeHttp.Server;
        requests: Array<{ url: string; body: string; contentType?: string }>;
        setStatus: (status: number) => void;
        setBody: (body: string | Uint8Array) => void;
        setEnvelopeStatus: (status: number) => void;
        setTraceStatus: (status: number) => void;
      }>((resolve) => {
        const requests: Array<{ url: string; body: string; contentType?: string }> = [];
        let status = 200;
        let envelopeStatus = 200;
        let traceStatus = 200;
        let body: string | Uint8Array = "{}";
        const server = NodeHttp.createServer(async (request, response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          requests.push({
            url: request.url ?? "",
            body: Buffer.concat(chunks).toString(),
            ...(request.headers["content-type"]
              ? { contentType: request.headers["content-type"] }
              : {}),
          });
          response.writeHead(
            request.url?.includes("/envelope/")
              ? envelopeStatus
              : request.url?.endsWith("/traces/")
                ? traceStatus
                : status,
            {
              "content-type": "application/json",
            },
          );
          response.end(body);
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          assert.ok(address && typeof address !== "string");
          resolve({
            url: `http://127.0.0.1:${address.port}`,
            server,
            requests,
            setStatus: (next) => {
              status = next;
            },
            setBody: (next) => {
              body = next;
            },
            setEnvelopeStatus: (next) => {
              envelopeStatus = next;
            },
            setTraceStatus: (next) => {
              traceStatus = next;
            },
          });
        });
      }),
  ),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
);

it.layer(NodeServices.layer)("agent monitoring pilot", (it) => {
  it.effect("keeps metadata, correlates tools and subagents, and groups errors across hosts", () =>
    Effect.gen(function* () {
      const command = observe(toolEvent());
      assert.equal(command.status, "completed"); // A nonzero exit code alone is not an agent failure.
      assert.equal(command.attributes["t3.exit_code"], 1);
      assert.equal(command.attributes["t3.result_bytes"], Buffer.byteLength(privateContent));
      assert.equal(command.attributes["t3.duration_ms"], 1000);
      assert.equal(Exporter.toSentryAgentError(command), undefined);
      const failedCommand = observe(toolEvent("failed-command", true));
      assert.equal(failedCommand.status, "failed");
      assert.equal(Exporter.toSentryAgentError(failedCommand), undefined);
      const root = observe({
        id: EventId.make("run-event"),
        type: "run.updated",
        threadId,
        runId,
        occurredAt: at,
        payload: run,
      });
      assert.equal(command.traceId, root.traceId);
      assert.equal(command.parentSpanId, root.spanId);
      const child = observe({
        id: EventId.make("subagent-event"),
        type: "subagent.updated",
        threadId,
        runId,
        occurredAt: at,
        payload: {
          id: NodeId.make("subagent:private"),
          threadId,
          runId,
          parentNodeId: NodeId.make("node:private"),
          origin: "app_owned",
          createdBy: "agent",
          driver: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: ProviderInstanceId.make("claude-local"),
          providerThreadId: null,
          childThreadId: null,
          nativeTaskRef: null,
          prompt: privateContent,
          title: privateContent,
          model: "claude-opus-4-6",
          status: "completed",
          progress: privateContent,
          result: privateContent,
          startedAt: at,
          completedAt: at,
          updatedAt: at,
        },
      });
      assert.equal(child.traceId, root.traceId);
      assert.equal(child.parentSpanId, root.spanId);
      const errorA = Exporter.toSentryAgentError(observe(errorEvent()));
      const errorB = Exporter.toSentryAgentError(observe(errorEvent(), 1, "host-b"));
      assert.deepEqual(errorA?.fingerprint, errorB?.fingerprint);
      assert.notEqual(errorA?.tags?.["t3.environment_id"], errorB?.tags?.["t3.environment_id"]);
      const cancelled = { ...command, status: "cancelled" };
      assert.equal(Exporter.toSentryAgentError(cancelled), undefined);
      const encoded = yield* encodeJson([command, child, root, errorA, errorB]);
      assert.ok(!encoded.includes("CANARY"));
      assert.ok(!encoded.includes("Bearer"));
    }),
  );

  it.effect(
    "accepts protobuf success and warnings while retrying rejection or malformed acks",
    () =>
      Effect.gen(function* () {
        const ingestion = yield* receiver;
        yield* Effect.gen(function* () {
          const exporter = yield* Exporter.AgentMonitoringExporter;
          for (const body of [
            [], // Empty Export*ServiceResponse.
            [10, 0], // Empty partial_success.
            [10, 4, 18, 2, 111, 107], // Zero rejected with warning "ok".
            [16, 1], // Future unknown field.
          ]) {
            ingestion.setBody(Uint8Array.from(body));
            yield* exporter.send([observe(toolEvent())]);
          }
          assert.ok(
            ingestion.requests.every((request) => request.contentType === "application/x-protobuf"),
          );
          for (const body of [
            [10, 2, 8, 1], // One rejected log record or span.
            [10, 6, 8, 128, 128, 128, 128, 16], // Rejected count beyond 32 bits.
            [10, 2, 8], // Truncated partial_success.
            [8, 0], // Wrong wire type for partial_success.
            new Uint8Array(65_537), // Oversized acknowledgment must fail before parsing.
          ]) {
            ingestion.setBody(Uint8Array.from(body));
            assert.ok(Exit.isFailure(yield* Effect.exit(exporter.send([observe(toolEvent())]))));
          }
        }).pipe(
          Effect.provide(
            Exporter.layer({
              otlpBaseUrl: ingestion.url,
              protocol: "http/protobuf",
            }).pipe(Layer.provide(FetchHttpClient.layer)),
          ),
        );
      }),
  );

  it.effect("checkpoints accepted signals across exporter and journal restarts", () =>
    Effect.gen(function* () {
      const ingestion = yield* receiver;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-signal-receipts-" });
      const filename = path.join(home, "journal.sqlite");
      const record = observe(errorEvent());
      const attempt = (seed: boolean) =>
        Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* Journal.AgentMonitoringJournal;
            const exporter = yield* Exporter.AgentMonitoringExporter;
            if (seed) {
              yield* journal.enroll(0);
              yield* journal.capture([{ sequence: 1, observation: record }]);
            }
            const pending = yield* journal.pending;
            const result = yield* Effect.exit(
              exporter.send(pending, {
                receipts: yield* journal.deliveryReceipts("destination-a", [record.id]),
                acknowledge: (signal, ids) =>
                  journal
                    .acknowledgeSignal("destination-a", signal, ids)
                    .pipe(
                      Effect.mapError(
                        () => new Exporter.AgentMonitoringExportError({ operation: "receipt" }),
                      ),
                    ),
              }),
            );
            if (Exit.isSuccess(result))
              yield* journal.acknowledge(pending.map((record) => record.id));
            return {
              success: Exit.isSuccess(result),
              report: yield* journal.report,
              otherDestinationReceipts: yield* journal.deliveryReceipts("destination-b", [
                record.id,
              ]),
            };
          }).pipe(
            Effect.provide(
              Layer.merge(
                Journal.layerAt(filename),
                Exporter.layer({
                  dsn: `http://public@127.0.0.1:${new URL(ingestion.url).port}/1`,
                  protocol: "http/json",
                }).pipe(Layer.provide(FetchHttpClient.layer)),
              ),
            ),
          ),
        );
      ingestion.setTraceStatus(503);
      assert.equal((yield* attempt(true)).success, false);
      ingestion.setTraceStatus(200);
      ingestion.setEnvelopeStatus(503);
      const second = yield* attempt(false);
      assert.equal(second.success, false);
      assert.equal(second.report.pendingCount, 1);
      assert.deepEqual(second.otherDestinationReceipts, []);
      ingestion.setEnvelopeStatus(200);
      const third = yield* attempt(false);
      assert.equal(third.success, true);
      assert.equal(third.report.pendingCount, 0);
      assert.equal(ingestion.requests.filter((r) => r.url.endsWith("/logs/")).length, 1);
      assert.equal(ingestion.requests.filter((r) => r.url.endsWith("/traces/")).length, 2);
      assert.equal(ingestion.requests.filter((r) => r.url.includes("/envelope/")).length, 2);
    }),
  );

  it.effect("retains destination receipts across switches and bounds receipt history", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-destination-receipts-" });
      const record = observe(errorEvent());
      const filename = path.join(home, "journal.sqlite");
      yield* Effect.gen(function* () {
        const journal = yield* Journal.AgentMonitoringJournal;
        yield* journal.enroll(0);
        yield* journal.capture([{ sequence: 1, observation: record }]);
        yield* journal.acknowledgeSignal("destination-a", "logs", [record.id]);
        yield* journal.acknowledgeSignal("destination-b", "logs", [record.id]);
      }).pipe(Effect.provide(Journal.layerAt(filename, { maxRecords: 1 })));
      yield* Effect.gen(function* () {
        const journal = yield* Journal.AgentMonitoringJournal;
        assert.deepEqual(yield* journal.deliveryReceipts("destination-a", [record.id]), [
          { id: record.id, signal: "logs" },
        ]);
        assert.deepEqual(yield* journal.deliveryReceipts("destination-b", [record.id]), [
          { id: record.id, signal: "logs" },
        ]);
        yield* journal.acknowledgeSignal("destination-c", "logs", [record.id]);
        yield* journal.acknowledgeSignal("destination-d", "logs", [record.id]);
        assert.deepEqual(yield* journal.deliveryReceipts("destination-a", [record.id]), []);
        assert.equal((yield* journal.deliveryReceipts("destination-b", [record.id])).length, 1);
        yield* journal.acknowledge([record.id]);
        assert.deepEqual(yield* journal.deliveryReceipts("destination-b", [record.id]), []);
      }).pipe(Effect.provide(Journal.layerAt(filename, { maxRecords: 1 })));
    }),
  );

  it.effect(
    "skips disabled activity after a failed pause and process restart while retaining captured records",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pause-restart-" });
        const filename = path.join(home, "userdata", "logs", AgentMonitoring.journalFileName);
        yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
        const storeContext = yield* Layer.build(
          OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
        );
        const store = Context.get(storeContext, OrchestrationEventStore);
        yield* store.appendAgentEvents({ events: [toolEvent("captured-before-disable")] });
        yield* Effect.gen(function* () {
          const journal = yield* Journal.AgentMonitoringJournal;
          yield* journal.enroll(0, false, 1);
          yield* journal.capture([
            { sequence: 1, observation: observe(toolEvent("captured-before-disable")) },
          ]);
        }).pipe(Effect.provide(Journal.layerAt(filename)));
        yield* fs.rename(filename, filename + ".saved");
        yield* fs.makeDirectory(filename);
        const layer = (enabled: boolean) =>
          AgentMonitoring.layer.pipe(
            Layer.provide(
              Settings.layerTest({
                agentMonitoring: { enabled, sentryDsn: "" },
                agentMonitoringConsentVersion: enabled ? 3 : 2,
              }),
            ),
            Layer.provide(ServerConfig.layerTest(home, home)),
            Layer.provide(
              Layer.succeed(ServerEnvironment.ServerEnvironment, {
                getEnvironmentId: Effect.succeed(EnvironmentId.make("pause-failure-host")),
                getDescriptor: Effect.die("unused"),
              }),
            ),
            Layer.provide(Layer.succeed(OrchestrationEventStore, store)),
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
          );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(layer(false));
            const monitor = Context.get(context, AgentMonitoring.AgentMonitoring);
            const unavailable = yield* monitor.status;
            assert.equal(unavailable.state, "unavailable");
            assert.equal(unavailable.enabled, false);
            assert.equal(unavailable.monitoringEnvironmentId, null);
            yield* store.appendAgentEvents({ events: [toolEvent("disabled-private-gap")] });
          }),
        );
        // Restore the last durable, unpaused journal as if the failed write never reached disk.
        yield* fs.remove(filename, { recursive: true });
        yield* fs.rename(filename + ".saved", filename);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(layer(true));
            const monitor = Context.get(context, AgentMonitoring.AgentMonitoring);
            yield* store.appendAgentEvents({ events: [toolEvent("enabled-after-restart")] });
            yield* monitor.flush;
          }),
        );
        const report = yield* Effect.flatMap(
          Journal.AgentMonitoringJournal,
          (journal) => journal.report,
        ).pipe(Effect.provide(Journal.layerAt(filename, { readonly: true })));
        assert.equal(report.recordCount, 2);
        assert.equal(report.pendingCount, 2);
        assert.equal(report.capturedSequence, 3);
      }),
  );

  it.effect(
    "resumes uncaptured enabled activity after restart when saved consent is unchanged",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-enabled-tail-" });
        const filename = path.join(home, "userdata", "logs", AgentMonitoring.journalFileName);
        yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
        const storeContext = yield* Layer.build(
          OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
        );
        const store = Context.get(storeContext, OrchestrationEventStore);
        yield* store.appendAgentEvents({
          events: [toolEvent("captured"), toolEvent("uncaptured-before-crash")],
        });
        yield* Effect.gen(function* () {
          const journal = yield* Journal.AgentMonitoringJournal;
          yield* journal.enroll(0, false, 7);
          yield* journal.capture([{ sequence: 1, observation: observe(toolEvent("captured")) }]);
        }).pipe(Effect.provide(Journal.layerAt(filename)));
        const context = yield* Layer.build(
          AgentMonitoring.layer.pipe(
            Layer.provide(
              Settings.layerTest({
                agentMonitoring: { enabled: true, sentryDsn: "" },
                agentMonitoringConsentVersion: 7,
              }),
            ),
            Layer.provide(ServerConfig.layerTest(home, home)),
            Layer.provide(
              Layer.succeed(ServerEnvironment.ServerEnvironment, {
                getEnvironmentId: Effect.succeed(EnvironmentId.make("enabled-tail-host")),
                getDescriptor: Effect.die("unused"),
              }),
            ),
            Layer.provide(Layer.succeed(OrchestrationEventStore, store)),
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
          ),
        );
        yield* Context.get(context, AgentMonitoring.AgentMonitoring).flush;
        const report = yield* Effect.flatMap(
          Journal.AgentMonitoringJournal,
          (journal) => journal.report,
        ).pipe(Effect.provide(Journal.layerAt(filename, { readonly: true })));
        assert.equal(report.recordCount, 2);
        assert.equal(report.capturedSequence, 2);
      }),
  );

  it.effect("retries the same saved configuration after a transient journal startup failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-monitoring-recovery-" });
      const obstruction = path.join(home, "userdata", "logs", AgentMonitoring.journalFileName);
      yield* fs.makeDirectory(obstruction, { recursive: true });
      const storeContext = yield* Layer.build(
        OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
      );
      const store = Context.get(storeContext, OrchestrationEventStore);
      const context = yield* Layer.build(
        AgentMonitoring.layer.pipe(
          Layer.provide(Settings.layerTest({ agentMonitoring: { enabled: true, sentryDsn: "" } })),
          Layer.provide(ServerConfig.layerTest(home, home)),
          Layer.provide(
            Layer.succeed(ServerEnvironment.ServerEnvironment, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("recovering-host")),
              getDescriptor: Effect.die("unused"),
            }),
          ),
          Layer.provide(Layer.succeed(OrchestrationEventStore, store)),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
        ),
      );
      const monitor = Context.get(context, AgentMonitoring.AgentMonitoring);
      const unavailable = yield* monitor.status;
      assert.equal(unavailable.state, "unavailable");
      assert.equal(unavailable.enabled, false);
      assert.equal(unavailable.monitoringEnvironmentId, null);
      yield* fs.remove(obstruction, { recursive: true });
      assert.equal((yield* monitor.status).state, "collecting");
      yield* store.appendAgentEvents({ events: [toolEvent("recovered")] });
      yield* monitor.flush;
      assert.equal((yield* monitor.status).pendingCount, 1);
    }),
  );

  it.effect(
    "persists a cursor, collapses progress, records resume, and retains delivery acknowledgments across restart",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-journal-" });
        const filename = path.join(directory, "journal.sqlite");
        const runEvent = (sequence: number, status: OrchestrationV2Run["status"]) =>
          observe(
            {
              id: EventId.make(`run-${sequence}`),
              type: "run.updated",
              threadId,
              occurredAt: at,
              payload: { ...run, status },
            },
            sequence,
          );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* Journal.AgentMonitoringJournal;
            yield* journal.enroll(0);
            yield* journal.capture(
              [1, 2].map((sequence) => ({ sequence, observation: runEvent(sequence, "running") })),
            );
            assert.equal((yield* journal.report).recordCount, 1);
            yield* journal.capture([
              { sequence: 3, observation: runEvent(3, "waiting") },
              { sequence: 4, observation: runEvent(4, "running") },
            ]);
            assert.equal((yield* journal.report).recordCount, 3);
            const pending = yield* journal.pending;
            yield* journal.acknowledge(pending.map((item) => item.id));
            yield* journal.capture([{ sequence: 5, observation: runEvent(5, "completed") }]);
            assert.equal((yield* journal.report).activeAgentCount, 0);
          }).pipe(Effect.provide(Journal.layerAt(filename))),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* Journal.AgentMonitoringJournal;
            yield* journal.enroll(99);
            assert.equal((yield* journal.report).capturedSequence, 5);
            assert.equal((yield* journal.pending).length, 1);
            yield* journal.capture([{ sequence: 5, observation: runEvent(5, "completed") }]);
            assert.equal((yield* journal.report).recordCount, 4);
          }).pipe(Effect.provide(Journal.layerAt(filename))),
        );
        const readOnly = yield* Effect.scoped(
          Effect.flatMap(Journal.AgentMonitoringJournal, (journal) => journal.report),
        ).pipe(Effect.provide(Journal.layerAt(filename, { readonly: true })));
        assert.equal(readOnly.pendingCount, 1);
        const fileContents = yield* fs.readFile(filename);
        assert.ok(!Buffer.from(fileContents).includes(Buffer.from("CANARY")));
      }),
  );

  it.effect("counts reported retries without retaining their provider messages", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-retries-" });
      yield* Effect.gen(function* () {
        const journal = yield* Journal.AgentMonitoringJournal;
        yield* journal.enroll(0);
        yield* journal.capture(
          [1, 2].map((sequence) => ({
            sequence,
            observation: observe(errorEvent(`retry-${sequence}`, sequence), sequence),
          })),
        );
        const report = yield* journal.report;
        assert.equal(report.recordCount, 2);
        assert.equal(report.failureGroups[0]?.count, 2);
        const records = yield* journal.pending;
        assert.deepEqual(
          records.map((record) => record.attributes["t3.retry_attempt"]),
          [1, 2],
        );
        assert.ok(!(yield* encodeJson(records)).includes("CANARY"));
      }).pipe(Effect.provide(Journal.layerAt(path.join(directory, "journal.sqlite"))));
    }),
  );

  it.effect("bounds retained records and reports pending observations lost to eviction", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-retention-" });
      yield* Effect.gen(function* () {
        const journal = yield* Journal.AgentMonitoringJournal;
        yield* journal.enroll(0);
        yield* journal.capture(
          [1, 2, 3].map((sequence) => ({
            sequence,
            observation: {
              ...observe(toolEvent(`tool-${sequence}`), sequence),
              entityId: `entity-${sequence}`,
            },
          })),
        );
        const report = yield* journal.report;
        assert.equal(report.recordCount, 2);
        assert.equal(report.droppedPendingCount, 1);
        assert.equal(report.capturedSequence, 3);
      }).pipe(
        Effect.provide(Journal.layerAt(path.join(directory, "journal.sqlite"), { maxRecords: 2 })),
      );
    }),
  );

  it.effect("exports safe OTLP and native Sentry errors, and rejects unavailable ingestion", () =>
    Effect.gen(function* () {
      const ingestion = yield* receiver;
      const configured = Exporter.layer({
        dsn: `http://public@127.0.0.1:${new URL(ingestion.url).port}/1`,
        protocol: "http/json",
      }).pipe(Layer.provide(FetchHttpClient.layer));
      yield* Effect.gen(function* () {
        const exporter = yield* Exporter.AgentMonitoringExporter;
        yield* exporter.send([observe(errorEvent()), observe(toolEvent("failed-tool", true))]);
        assert.ok(ingestion.requests.some((request) => request.url.endsWith("/traces/")));
        assert.ok(ingestion.requests.some((request) => request.url.endsWith("/logs/")));
        // The provider error becomes an issue; the failed shell command stays a span.
        assert.equal(
          ingestion.requests.filter((request) => request.url.includes("/envelope/")).length,
          1,
        );
        const payloads = ingestion.requests.map((request) => request.body).join("\n");
        assert.ok(!payloads.includes("CANARY"));
        assert.ok(payloads.includes("transport_error"));
        assert.ok(payloads.includes("gen_ai.execute_tool"));
        const traces = yield* decodeTracePayload(
          ingestion.requests.find((request) => request.url.endsWith("/traces/"))!.body,
        );
        assert.deepEqual(
          traces.resourceSpans[0]!.scopeSpans[0]!.spans.map(
            (span) =>
              span.attributes.find((attribute) => attribute.key === "gen_ai.operation.type")?.value
                .stringValue,
          ),
          [undefined, "tool"],
        );
        assert.ok(
          !traces.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.some((attribute) =>
            attribute.key.startsWith("gen_ai."),
          ),
        );
        ingestion.setEnvelopeStatus(503);
        assert.ok(Exit.isFailure(yield* Effect.exit(exporter.send([observe(errorEvent())]))));
        ingestion.setEnvelopeStatus(200);
        ingestion.setStatus(503);
        assert.ok(Exit.isFailure(yield* Effect.exit(exporter.send([observe(errorEvent())]))));
        ingestion.setStatus(200);
        ingestion.setBody(
          '{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"CANARY_private_response"}}',
        );
        assert.ok(Exit.isFailure(yield* Effect.exit(exporter.send([observe(errorEvent())]))));
      }).pipe(Effect.provide(configured));
    }),
  );

  it.effect(
    "captures only enrolled committed events and recovers pending delivery without blocking event appends",
    () =>
      Effect.gen(function* () {
        const ingestion = yield* receiver;
        ingestion.setStatus(503);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-monitoring-" });
        const storeContext = yield* Layer.build(
          OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
        );
        const store = Context.get(storeContext, OrchestrationEventStore);
        yield* store.appendAgentEvents({ events: [toolEvent("pre-enrollment")] });
        const environment = Layer.succeed(ServerEnvironment.ServerEnvironment, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("pilot-host")),
          getDescriptor: Effect.die("not needed by monitoring"),
        });
        const monitorLayer = AgentMonitoring.layer.pipe(
          Layer.provide(Settings.layerTest({ agentMonitoring: { enabled: true, sentryDsn: "" } })),
          Layer.provide(ServerConfig.layerTest(home, home)),
          Layer.provide(environment),
          Layer.provide(Layer.succeed(OrchestrationEventStore, store)),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                T3CODE_AGENT_MONITORING_OTLP_BASE_URL: ingestion.url,
                T3CODE_AGENT_MONITORING_OTLP_PROTOCOL: "http/json",
              }),
            ),
          ),
        );
        const monitorContext = yield* Layer.build(monitorLayer);
        const monitor = Context.get(monitorContext, AgentMonitoring.AgentMonitoring);
        assert.equal(monitor.enabled, true);
        const [event] = yield* store.appendAgentEvents({ events: [errorEvent("post-enrollment")] });
        assert.ok(event);
        assert.ok(Exit.isFailure(yield* Effect.exit(monitor.flush)));
        yield* store.appendAgentEvents({ events: [toolEvent("still-commits")] });
        ingestion.setStatus(200);
        yield* monitor.flush;
        const filename = path.join(home, "userdata", "logs", AgentMonitoring.journalFileName);
        const report = yield* Effect.flatMap(
          Journal.AgentMonitoringJournal,
          (journal) => journal.report,
        ).pipe(Effect.provide(Journal.layerAt(filename, { readonly: true })));
        assert.equal(report.recordCount, 2);
        assert.equal(report.pendingCount, 0);
        assert.equal(report.capturedSequence, 3);
        assert.equal(report.failureGroups[0]?.category, "transport_error");
      }),
  );
  it.effect("keeps saved enabled and DSN settings editable with only a protocol override", () =>
    Effect.gen(function* () {
      const ingestion = yield* receiver;
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-mixed-monitoring-" });
      const dsn = `http://public@127.0.0.1:${new URL(ingestion.url).port}/1`;
      const settingsContext = yield* Layer.build(
        Settings.layerTest({ agentMonitoring: { enabled: false, sentryDsn: dsn } }),
      );
      const settings = Context.get(settingsContext, Settings.ServerSettingsService);
      const context = yield* Layer.build(
        AgentMonitoring.layer.pipe(
          Layer.provide(Layer.succeed(Settings.ServerSettingsService, settings)),
          Layer.provide(ServerConfig.layerTest(home, home)),
          Layer.provide(
            Layer.succeed(ServerEnvironment.ServerEnvironment, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("mixed-config-host")),
              getDescriptor: Effect.die("unused"),
            }),
          ),
          Layer.provide(OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory))),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                T3CODE_AGENT_MONITORING_ENABLED: true,
                T3CODE_AGENT_MONITORING_OTLP_PROTOCOL: "http/json",
              }),
            ),
          ),
        ),
      );
      const monitor = Context.get(context, AgentMonitoring.AgentMonitoring);
      assert.equal((yield* monitor.status).state, "disabled");
      yield* settings.updateSettings({ agentMonitoring: { enabled: true } });
      const status = yield* monitor.status;
      assert.equal(status.state, "ready");
      assert.equal(status.configurationSource, "settings");
      assert.equal((yield* settings.getSettings).agentMonitoring.sentryDsn, dsn);
      yield* settings.updateSettings({ agentMonitoring: { enabled: false } });
      assert.equal((yield* monitor.status).state, "disabled");
    }),
  );

  it.effect("uses saved settings live and skips disabled activity across a restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-monitoring-settings-" });
        const storeContext = yield* Layer.build(
          OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
        );
        const store = Context.get(storeContext, OrchestrationEventStore);
        const settingsContext = yield* Layer.build(Settings.layerTest());
        const settings = Context.get(settingsContext, Settings.ServerSettingsService);
        const monitorLayer = AgentMonitoring.layer.pipe(
          Layer.provide(Layer.succeed(Settings.ServerSettingsService, settings)),
          Layer.provide(ServerConfig.layerTest(home, home)),
          Layer.provide(
            Layer.succeed(ServerEnvironment.ServerEnvironment, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("saved-settings-host")),
              getDescriptor: Effect.die("unused"),
            }),
          ),
          Layer.provide(Layer.succeed(OrchestrationEventStore, store)),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
        );
        const read = Effect.flatMap(
          Journal.AgentMonitoringJournal,
          (journal) => journal.report,
        ).pipe(
          Effect.provide(
            Journal.layerAt(path.join(home, "userdata", "logs", AgentMonitoring.journalFileName), {
              readonly: true,
            }),
          ),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(Layer.fresh(monitorLayer));
            const monitor = Context.get(context, AgentMonitoring.AgentMonitoring);
            assert.equal((yield* monitor.status).state, "disabled");
            yield* store.appendAgentEvents({ events: [toolEvent("before-enable")] });
            yield* settings.updateSettings({ agentMonitoring: { enabled: true } });
            assert.equal((yield* monitor.status).state, "collecting");
            assert.equal((yield* monitor.status).configurationSource, "settings");
            assert.equal(
              (yield* monitor.status).monitoringEnvironmentId,
              observe(toolEvent(), 1, "saved-settings-host").attributes["t3.environment_id"],
            );
            yield* store.appendAgentEvents({ events: [toolEvent("enabled")] });
            yield* monitor.flush;
            assert.equal((yield* read).recordCount, 1);
            yield* store.appendAgentEvents({
              events: [toolEvent("before-disable", false, "tool:before-disable")],
            });
            yield* settings.updateSettings({ agentMonitoring: { enabled: false } });
            assert.equal((yield* monitor.status).state, "disabled");
            yield* store.appendAgentEvents({ events: [errorEvent("while-disabled")] });
            yield* monitor.flush;
            assert.equal((yield* read).recordCount, 2);
          }),
        );
        // Restart while the saved setting is enabled: the durable pause marker skips the disabled gap.
        yield* settings.updateSettings({ agentMonitoring: { enabled: true } });
        const restartedContext = yield* Layer.build(Layer.fresh(monitorLayer));
        const restarted = Context.get(restartedContext, AgentMonitoring.AgentMonitoring);
        yield* store.appendAgentEvents({
          events: [toolEvent("after-restart", false, "tool:after-restart")],
        });
        yield* restarted.flush;
        const report = yield* read;
        assert.equal(report.recordCount, 3);
        assert.equal(report.pendingCount, 3);
        assert.equal(report.failureGroups.length, 0);
        assert.equal((yield* restarted.status).pendingCount, 3);
      }),
    ),
  );
});
