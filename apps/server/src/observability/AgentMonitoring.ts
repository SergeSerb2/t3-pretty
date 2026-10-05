import type { ApplicationStoredEvent } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import * as AgentMonitoringExporter from "./AgentMonitoringExporter.ts";
import * as AgentMonitoringJournal from "./AgentMonitoringJournal.ts";
import { toAgentObservation } from "./AgentObservation.ts";

export const journalFileName = "agent-monitoring.sqlite";

export class AgentMonitoringError extends Schema.TaggedError<AgentMonitoringError>()(
  "AgentMonitoringError",
  { operation: Schema.String },
) {
  override get message() {
    return "Agent monitoring could not complete the operation.";
  }
}

export class AgentMonitoring extends Context.Service<
  AgentMonitoring,
  {
    readonly enabled: boolean;
    /** Finite catch-up and one export batch, also usable as a deterministic drain receipt. */
    readonly flush: Effect.Effect<void, AgentMonitoringError>;
  }
>()("t3/observability/AgentMonitoring") {}

const disabled = AgentMonitoring.of({ enabled: false, flush: Effect.void });

const make = Effect.gen(function* () {
  const enabled = yield* Config.Boolean("T3CODE_AGENT_MONITORING_ENABLED").pipe(
    Config.withDefault(false),
  );
  if (!enabled) return disabled;
  const configuration = yield* Config.all({
    dsn: Config.String("SENTRY_DSN").pipe(Config.option),
    otlpBaseUrl: Config.String("T3CODE_AGENT_MONITORING_OTLP_BASE_URL").pipe(Config.option),
    protocol: Config.String("T3CODE_AGENT_MONITORING_OTLP_PROTOCOL").pipe(
      Config.withDefault("http/protobuf"),
    ),
  });
  if (!["http/json", "http/protobuf"].includes(configuration.protocol))
    return yield* new AgentMonitoringError({ operation: "protocol" });
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* OrchestrationEventStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  yield* fs.makeDirectory(config.logsDir, { recursive: true });
  const journalContext = yield* Layer.build(
    AgentMonitoringJournal.layerAt(path.join(config.logsDir, journalFileName)),
  );
  const journal = Context.get(journalContext, AgentMonitoringJournal.AgentMonitoringJournal);
  // Start from enrollment, rather than retroactively uploading existing private conversation history.
  yield* journal.enroll(yield* store.latestApplicationSequence);
  const exporterContext = yield* Layer.build(
    AgentMonitoringExporter.layer({
      dsn: Option.getOrUndefined(configuration.dsn),
      otlpBaseUrl: Option.getOrUndefined(configuration.otlpBaseUrl),
      protocol: configuration.protocol === "http/json" ? "http/json" : "http/protobuf",
    }),
  ).pipe(
    Effect.catch(() =>
      Effect.logWarning(
        "Agent monitoring destination could not initialize; retaining local observations.",
      ).pipe(
        Effect.as(
          Context.make(AgentMonitoringExporter.AgentMonitoringExporter, {
            configured: false,
            send: () => Effect.void,
          }),
        ),
      ),
    ),
  );
  const exporter = Context.get(exporterContext, AgentMonitoringExporter.AgentMonitoringExporter);
  const captureLock = yield* Semaphore.make(1);
  const exportLock = yield* Semaphore.make(1);
  const project = (event: ApplicationStoredEvent) => ({
    sequence: event.sequence,
    ...("event" in event ? { observation: toAgentObservation(event, environmentId) } : {}),
  });
  const capture = captureLock
    .withPermit(
      Effect.gen(function* () {
        const afterSequence = yield* journal.cursor;
        const throughSequence = yield* store.latestApplicationSequence;
        if (throughSequence <= afterSequence) return;
        yield* store
          .readApplicationEvents({ afterSequence, throughSequence })
          .pipe(Stream.map(project), Stream.grouped(100), Stream.runForEach(journal.capture));
      }),
    )
    .pipe(Effect.mapError(() => new AgentMonitoringError({ operation: "capture" })));
  const deliver = exportLock
    .withPermit(
      Effect.gen(function* () {
        if (!exporter.configured) return;
        const pending = yield* journal.pending;
        if (pending.length === 0) return;
        yield* exporter.send(pending);
        yield* journal.acknowledge(pending.map((record) => record.id));
      }),
    )
    .pipe(Effect.mapError(() => new AgentMonitoringError({ operation: "export" })));
  let nextExportAt = 0;
  let exportFailures = 0;
  let captureFailed = false;
  const captureTick = capture.pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        captureFailed = false;
      }),
    ),
    Effect.catch(() =>
      Effect.gen(function* () {
        if (!captureFailed)
          yield* Effect.logWarning(
            "Agent monitoring capture failed; retrying independently of agent execution.",
          );
        captureFailed = true;
      }),
    ),
  );
  const exportTick = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now < nextExportAt) return;
    yield* deliver.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          exportFailures = 0;
          nextExportAt = 0;
        }),
      ),
      Effect.catch(() =>
        Effect.gen(function* () {
          if (exportFailures === 0)
            yield* Effect.logWarning(
              "Agent monitoring export failed; observations remain pending for retry.",
            );
          exportFailures += 1;
          nextExportAt = now + Math.min(60_000, 2_000 * 2 ** Math.min(exportFailures, 5));
        }),
      ),
    );
  });
  // Polling committed rows avoids adding work or subscriber backpressure to the event commit path.
  yield* captureTick.pipe(
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* exportTick.pipe(
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.forever,
    Effect.forkScoped,
  );
  return AgentMonitoring.of({ enabled: true, flush: capture.pipe(Effect.andThen(deliver)) });
});

// Monitoring is optional. A bad destination or full journal must never prevent the server from starting.
export const layer = Layer.effect(
  AgentMonitoring,
  make.pipe(
    Effect.catch(() =>
      Effect.logWarning("Agent monitoring is unavailable; agent execution remains enabled.").pipe(
        Effect.as(disabled),
      ),
    ),
  ),
);
