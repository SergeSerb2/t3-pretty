import type {
  AgentMonitoringStatus,
  ApplicationStoredEvent,
  ServerSettings,
} from "@t3tools/contracts";
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
import * as ScopedRef from "effect/ScopedRef";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import * as Settings from "../serverSettings.ts";
import * as AgentMonitoringExporter from "./AgentMonitoringExporter.ts";
import * as AgentMonitoringJournal from "./AgentMonitoringJournal.ts";
import { observationId, toAgentObservation } from "./AgentObservation.ts";

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
    readonly status: Effect.Effect<AgentMonitoringStatus>;
  }
>()("t3/observability/AgentMonitoring") {}

const inactiveStatus = (
  state: "disabled" | "unavailable",
  configurationSource: AgentMonitoringStatus["configurationSource"] = "settings",
): AgentMonitoringStatus => ({
  monitoringEnvironmentId: null,
  enabled: state !== "disabled",
  configured: false,
  state,
  configurationSource,
  pendingCount: null,
  droppedPendingCount: null,
  lastObservedAt: null,
  lastExportAt: null,
});
const disabled = AgentMonitoring.of({
  enabled: false,
  flush: Effect.void,
  status: Effect.succeed(inactiveStatus("disabled")),
});

interface MonitoringConfiguration {
  readonly consentVersion: number;
  readonly enabled: boolean;
  readonly dsn: string | undefined;
  readonly otlpBaseUrl: string | undefined;
  readonly protocol: string;
  readonly source: AgentMonitoringStatus["configurationSource"];
}

type MonitoringRuntime = AgentMonitoring["Service"] & {
  readonly pause: Effect.Effect<void, AgentMonitoringError>;
};
const inactiveRuntime = (service: AgentMonitoring["Service"]): MonitoringRuntime => ({
  ...service,
  pause: Effect.void,
});

const makeRuntime = (configuration: MonitoringConfiguration, skipUncaptured: boolean) =>
  Effect.gen(function* () {
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
    yield* journal.enroll(
      yield* store.latestApplicationSequence,
      skipUncaptured,
      configuration.consentVersion,
    );
    let destinationFailed = false;
    const exporterContext = yield* Layer.build(
      AgentMonitoringExporter.layer({
        dsn: configuration.dsn,
        otlpBaseUrl: configuration.otlpBaseUrl,
        protocol: configuration.protocol === "http/json" ? "http/json" : "http/protobuf",
      }),
    ).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          destinationFailed = true;
        }).pipe(
          Effect.andThen(
            Effect.logWarning(
              "Agent monitoring destination could not initialize; retaining local observations.",
            ),
          ),
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
    // Receipts are scoped to a hashed destination; changing it retries pending observations there.
    const destinationId = observationId(
      `${configuration.dsn ?? ""}\n${configuration.otlpBaseUrl ?? ""}`,
    );
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
          const ids = pending.map((record) => record.id);
          yield* exporter.send(pending, {
            receipts: yield* journal.deliveryReceipts(destinationId, ids),
            acknowledge: (signal, ids) =>
              journal.acknowledgeSignal(destinationId, signal, ids).pipe(
                Effect.mapError(
                  () =>
                    new AgentMonitoringExporter.AgentMonitoringExportError({
                      operation: "save receipt",
                    }),
                ),
              ),
          });
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
    const status = Effect.gen(function* () {
      const statistics = yield* journal.statistics;
      return {
        monitoringEnvironmentId: observationId(environmentId),
        enabled: true,
        configured: exporter.configured,
        state:
          destinationFailed || captureFailed
            ? ("unavailable" as const)
            : !exporter.configured
              ? ("collecting" as const)
              : exportFailures > 0
                ? ("retrying" as const)
                : ("ready" as const),
        configurationSource: configuration.source,
        pendingCount: statistics.pendingCount,
        droppedPendingCount: statistics.droppedPendingCount,
        lastObservedAt: statistics.lastObservedAt,
        lastExportAt: statistics.lastExportAt,
      };
    }).pipe(
      Effect.catch(() => Effect.succeed(inactiveStatus("unavailable", configuration.source))),
    );
    return {
      ...AgentMonitoring.of({
        enabled: true,
        flush: capture.pipe(Effect.andThen(deliver)),
        status,
      }),
      pause: capture
        .pipe(Effect.andThen(journal.pause))
        .pipe(Effect.mapError(() => new AgentMonitoringError({ operation: "pause" }))),
    } satisfies MonitoringRuntime;
  });

const pausePersistedJournal = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filename = path.join(config.logsDir, journalFileName);
  if (!(yield* fs.exists(filename))) return;
  const context = yield* Layer.build(AgentMonitoringJournal.layerAt(filename));
  yield* Context.get(context, AgentMonitoringJournal.AgentMonitoringJournal).pause;
});

const make = Effect.gen(function* () {
  const runtimeDependencies =
    yield* Effect.context<Exclude<Effect.Services<ReturnType<typeof makeRuntime>>, Scope.Scope>>();
  const settings = yield* Settings.ServerSettingsService;
  const monitoringEnvironmentId = observationId(
    yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId,
  );
  const changes = yield* settings.subscribeChanges;
  const overrides = yield* Config.all({
    dsn: Config.String("SENTRY_DSN").pipe(Config.option),
    otlpBaseUrl: Config.String("T3CODE_AGENT_MONITORING_OTLP_BASE_URL").pipe(Config.option),
    protocol: Config.String("T3CODE_AGENT_MONITORING_OTLP_PROTOCOL").pipe(Config.option),
  });
  const configurationOf = (snapshot: ServerSettings): MonitoringConfiguration => ({
    consentVersion: snapshot.agentMonitoringConsentVersion,
    enabled: snapshot.agentMonitoring.enabled,
    dsn: Option.getOrElse(overrides.dsn, () => snapshot.agentMonitoring.sentryDsn) || undefined,
    otlpBaseUrl: Option.getOrUndefined(overrides.otlpBaseUrl),
    protocol: Option.getOrElse(overrides.protocol, () => "http/protobuf"),
    // The client edits enabled and destination; protocol is a separate startup transport setting.
    source: [overrides.dsn, overrides.otlpBaseUrl].some((option) => option._tag === "Some")
      ? "environment"
      : "settings",
  });
  const runtime = yield* ScopedRef.make<MonitoringRuntime>(() => inactiveRuntime(disabled));
  const lock = yield* Semaphore.make(1);
  let current: MonitoringConfiguration | undefined;
  // Consent comes exclusively from saved settings, whose version survives journal write failures.
  let wasDisabled = false;
  const configure = (snapshot: ServerSettings) =>
    lock.withPermit(
      Effect.gen(function* () {
        const next = configurationOf(snapshot);
        if (
          current &&
          next.consentVersion === current.consentVersion &&
          next.enabled === current.enabled &&
          next.dsn === current.dsn &&
          next.otlpBaseUrl === current.otlpBaseUrl &&
          next.protocol === current.protocol
        )
          return;
        // Stop the old exporter before acquiring another, so a destination change never overlaps exports.
        if (!next.enabled) yield* (yield* ScopedRef.get(runtime)).pause.pipe(Effect.ignore);
        yield* ScopedRef.set(runtime, Effect.succeed(inactiveRuntime(disabled)));
        current = undefined;
        if (!next.enabled) {
          const paused = yield* pausePersistedJournal.pipe(
            Effect.scoped,
            Effect.provide(runtimeDependencies),
            Effect.result,
          );
          wasDisabled = true;
          yield* ScopedRef.set(
            runtime,
            Effect.succeed(
              inactiveRuntime(
                AgentMonitoring.of({
                  ...disabled,
                  status: Effect.succeed(
                    inactiveStatus(
                      paused._tag === "Success" ? "disabled" : "unavailable",
                      next.source,
                    ),
                  ),
                }),
              ),
            ),
          );
          if (paused._tag === "Success") current = next;
          return;
        }
        yield* ScopedRef.set(
          runtime,
          makeRuntime(next, wasDisabled).pipe(Effect.provide(runtimeDependencies)),
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              current = next;
              wasDisabled = false;
            }),
          ),
          Effect.catch(() =>
            Effect.logWarning(
              "Agent monitoring is unavailable; agent execution remains enabled.",
            ).pipe(
              Effect.andThen(
                ScopedRef.set(
                  runtime,
                  Effect.succeed(
                    inactiveRuntime(
                      AgentMonitoring.of({
                        enabled: false,
                        flush: Effect.void,
                        status: Effect.succeed(inactiveStatus("unavailable", next.source)),
                      }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }),
    );
  yield* configure(yield* settings.getSettings);
  // Retry failed configuration/disable markers without requiring another settings change.
  yield* Effect.suspend(() =>
    current === undefined ? settings.getSettings.pipe(Effect.flatMap(configure)) : Effect.void,
  ).pipe(Effect.andThen(Effect.sleep("2 seconds")), Effect.forever, Effect.forkScoped);
  yield* changes.pipe(
    Stream.runForEach(() => settings.getSettings.pipe(Effect.flatMap(configure))),
    Effect.forkScoped,
  );
  const synchronized = Effect.gen(function* () {
    yield* configure(yield* settings.getSettings);
    return yield* ScopedRef.get(runtime);
  });
  return AgentMonitoring.of({
    get enabled() {
      return ScopedRef.getUnsafe(runtime).enabled;
    },
    flush: synchronized.pipe(
      Effect.flatMap((active) => active.flush),
      Effect.mapError(() => new AgentMonitoringError({ operation: "flush" })),
    ),
    status: synchronized.pipe(
      Effect.flatMap((active) => active.status),
      Effect.catch(() => Effect.succeed(inactiveStatus("unavailable"))),
      Effect.map((status) => ({ ...status, monitoringEnvironmentId })),
    ),
  });
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
