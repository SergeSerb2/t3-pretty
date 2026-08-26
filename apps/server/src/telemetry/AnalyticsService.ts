/**
 * Anonymous PostHog telemetry service.
 *
 * Persists an installation-scoped anonymous identifier, buffers events in
 * memory, and flushes batches over Effect's HTTP client.
 *
 * @module AnalyticsService
 */
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import { releaseHttpClientResponseBody } from "../stream/releaseHttpClientResponseBody.ts";
import { getTelemetryIdentifier } from "./Identify.ts";

interface BufferedAnalyticsEvent {
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

const ANALYTICS_REQUEST_TIMEOUT = "10 seconds";
const ANALYTICS_SHUTDOWN_FLUSH_TIMEOUT = "2 seconds";
const ANALYTICS_FLUSH_INTERVAL_MS = 1_000;
const ANALYTICS_MAX_RETRY_DELAY_MS = 60_000;
const ANALYTICS_MAX_BATCH_SIZE = 100;
const ANALYTICS_MAX_BUFFERED_EVENTS = 10_000;

const boundedInteger = (value: number, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : fallback)));

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.string("T3CODE_POSTHOG_KEY").pipe(
    Config.withDefault("phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m"),
  ),
  posthogHost: Config.string("T3CODE_POSTHOG_HOST").pipe(
    Config.withDefault("https://us.i.posthog.com"),
  ),
  enabled: Config.boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),
  flushBatchSize: Config.number("T3CODE_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number("T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
  wslDistroName: Config.string("WSL_DISTRO_NAME").pipe(Config.option),
});

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Record an anonymous event for best-effort buffered delivery. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;

    /** Flush all currently queued telemetry events. */
    readonly flush: Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {
  /** No-op layer for callers that intentionally disable telemetry. */
  static readonly layerTest = Layer.succeed(
    AnalyticsService,
    AnalyticsService.of({
      record: () => Effect.void,
      flush: Effect.void,
    }),
  );
}

export const make = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;
  const flushBatchSize = boundedInteger(
    telemetryConfig.flushBatchSize,
    20,
    1,
    ANALYTICS_MAX_BATCH_SIZE,
  );
  const maxBufferedEvents = boundedInteger(
    telemetryConfig.maxBufferedEvents,
    1_000,
    0,
    ANALYTICS_MAX_BUFFERED_EVENTS,
  );
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const identifier = yield* getTelemetryIdentifier;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const flushFailureCountRef = yield* Ref.make(0);
  const flushSemaphore = yield* Semaphore.make(1);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;

  const enqueueBufferedEvent = (event: string, properties?: Readonly<Record<string, unknown>>) =>
    Effect.flatMap(DateTime.now, (now) =>
      Ref.modify(bufferRef, (current) => {
        const appended = [
          ...current,
          {
            event,
            ...(properties ? { properties } : {}),
            capturedAt: DateTime.formatIso(now),
          } satisfies BufferedAnalyticsEvent,
        ];

        const next =
          appended.length > maxBufferedEvents
            ? appended.slice(appended.length - maxBufferedEvents)
            : appended;

        return [
          {
            size: next.length,
            dropped: next.length !== appended.length,
          } as const,
          next,
        ] as const;
      }),
    );

  const sendBatch = Effect.fn("AnalyticsService.sendBatch")(function* (
    events: ReadonlyArray<BufferedAnalyticsEvent>,
  ) {
    if (!telemetryConfig.enabled || !identifier) return;

    const payload = {
      api_key: telemetryConfig.posthogKey,
      batch: events.map((event) => ({
        event: event.event,
        distinct_id: identifier,
        properties: {
          ...event.properties,
          $process_person_profile: false,
          platform: hostPlatform,
          wsl: Option.getOrUndefined(telemetryConfig.wslDistroName),
          arch: hostArchitecture,
          t3CodeVersion: packageJson.version,
          clientType,
        },
        timestamp: event.capturedAt,
      })),
    };

    yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap((response) =>
        releaseHttpClientResponseBody(response).pipe(
          Effect.andThen(HttpClientResponse.filterStatusOk(response)),
        ),
      ),
      Effect.timeout(ANALYTICS_REQUEST_TIMEOUT),
    );
  });

  const flush: AnalyticsService["Service"]["flush"] = flushSemaphore.withPermits(1)(
    Effect.gen(function* () {
      while (true) {
        const batch = yield* Ref.modify(bufferRef, (current) => {
          if (current.length === 0) {
            return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const;
          }
          const nextBatch = current.slice(0, flushBatchSize);
          const remaining = current.slice(nextBatch.length);
          return [nextBatch, remaining] as const;
        });

        if (batch.length === 0) {
          return;
        }

        yield* sendBatch(batch).pipe(
          Effect.catch((error) =>
            Ref.update(bufferRef, (current) => {
              const requeued = [...batch, ...current];
              const overflow = requeued.length - maxBufferedEvents;
              return overflow > 0 ? requeued.slice(overflow) : requeued;
            }).pipe(Effect.flatMap(() => Effect.fail(error))),
          ),
        );
      }
    }).pipe(
      Effect.tap(() => Ref.set(flushFailureCountRef, 0)),
      // HTTP failures retain request data, including telemetry properties and the PostHog key.
      // The service is best-effort, so keep its diagnostic stable and payload-free.
      Effect.catch(() =>
        Ref.update(flushFailureCountRef, (count) => Math.min(count + 1, 16)).pipe(
          Effect.andThen(Effect.logError("Failed to flush telemetry")),
        ),
      ),
    ),
  );

  const record: AnalyticsService["Service"]["record"] = Effect.fn("AnalyticsService.record")(
    function* (event, properties) {
      if (!telemetryConfig.enabled || !identifier) return;

      const enqueueResult = yield* enqueueBufferedEvent(event, properties);
      if (enqueueResult.dropped) {
        yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
          size: enqueueResult.size,
          event,
        });
      }
    },
  );

  const periodicFlush = Ref.get(flushFailureCountRef).pipe(
    Effect.flatMap((failureCount) =>
      Effect.sleep(
        Math.min(
          ANALYTICS_MAX_RETRY_DELAY_MS,
          ANALYTICS_FLUSH_INTERVAL_MS * 2 ** Math.min(failureCount, 6),
        ),
      ),
    ),
    Effect.andThen(flush),
  );
  yield* Effect.forever(periodicFlush, { disableYield: true }).pipe(Effect.forkScoped);

  yield* Effect.addFinalizer(() =>
    flush.pipe(Effect.timeout(ANALYTICS_SHUTDOWN_FLUSH_TIMEOUT), Effect.ignore),
  );

  return AnalyticsService.of({ record, flush });
});

export const layer = Layer.effect(AnalyticsService, make);

export const layerTest = AnalyticsService.layerTest;
