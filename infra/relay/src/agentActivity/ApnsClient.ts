import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ApnsEnvironment as ApnsEnvironmentSchema, type ApnsCredentials } from "../Config.ts";
import type { ApnsLiveActivityAlert, ApnsNotificationPayload } from "./apnsDeliveryJobs.ts";
import {
  sanitizeAgentActivityAggregateState,
  sanitizeApnsLiveActivityAlert,
  sanitizeApnsNotificationPayload,
} from "./agentActivityPayloads.ts";
import { ApnsJwtEncodingError, ApnsJwtSigningError } from "./apnsJwt.ts";
import * as ApnsProviderTokens from "./ApnsProviderTokens.ts";
import {
  RUNNING_AGENT_ACTIVITY_ROW_TTL_MS,
  WAITING_AGENT_ACTIVITY_ROW_TTL_MS,
} from "./agentActivityPayloads.ts";

export { ApnsJwtEncodingError, ApnsJwtSigningError } from "./apnsJwt.ts";

const LIVE_ACTIVITY_NAME = "AgentActivity";
const DISMISS_AFTER_SECONDS = 5 * 60;
// An end without a final content-state leaves whatever the card last showed
// frozen on the lock screen until dismissal — get it off quickly instead of
// parading stale state for the full window.
const CONTENTLESS_DISMISS_AFTER_SECONDS = 15;
export const APNS_PAYLOAD_MAX_BYTES = 4 * 1024;
export const APNS_RESPONSE_MAX_BYTES = 8 * 1024;
export const APNS_REQUEST_TIMEOUT_MS = 15_000;

class ApnsResponseBodyTooLargeError extends Schema.TaggedErrorClass<ApnsResponseBodyTooLargeError>()(
  "ApnsResponseBodyTooLargeError",
  { maxBytes: Schema.Number },
) {
  override get message(): string {
    return `APNs response exceeded ${this.maxBytes} bytes.`;
  }
}

const ApnsLiveActivityEventSchema = Schema.Literals(["start", "update", "end"]);
export type ApnsLiveActivityEvent = typeof ApnsLiveActivityEventSchema.Type;

const ApnsRequestKindSchema = Schema.Literals(["live-activity", "push-notification"]);

interface ApnsLiveActivityRequest {
  readonly token: string;
  readonly event: ApnsLiveActivityEvent;
  readonly priority: "5" | "10";
  readonly payload: unknown;
}

interface ApnsPushNotificationRequest {
  readonly token: string;
  readonly priority: "10";
  readonly payload: unknown;
}

export interface ApnsDeliveryResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason?: string;
  readonly apnsId: string | null;
}

export class ApnsHttpRequestError extends Schema.TaggedErrorClass<ApnsHttpRequestError>()(
  "ApnsHttpRequestError",
  {
    requestKind: ApnsRequestKindSchema,
    event: Schema.NullOr(ApnsLiveActivityEventSchema),
    environment: ApnsEnvironmentSchema,
    bundleId: Schema.String,
    tokenSuffix: Schema.String,
    stage: Schema.Literals(["validate-payload", "send", "read-response", "deadline"]),
    status: Schema.NullOr(Schema.Number),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `APNs ${this.requestKind} request failed during ${this.stage} in ${this.environment}.`;
  }
}

export const ApnsError = Schema.Union([
  ApnsJwtEncodingError,
  ApnsJwtSigningError,
  ApnsHttpRequestError,
]);
export type ApnsError = typeof ApnsError.Type;

const decodeApnsErrorResponseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      reason: Schema.optional(Schema.String),
    }),
  ),
);
function contentState(state: RelayAgentActivityAggregateState) {
  return {
    name: LIVE_ACTIVITY_NAME,
    props: JSON.stringify(state),
  };
}

function apnsPayloadByteLength(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("APNs payload is not JSON serializable.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function payloadFitsApns(payload: unknown): boolean {
  try {
    return apnsPayloadByteLength(payload) <= APNS_PAYLOAD_MAX_BYTES;
  } catch {
    return false;
  }
}

function compactStatus(
  phase: RelayAgentActivityAggregateState["activities"][number]["phase"],
): string {
  switch (phase) {
    case "starting":
      return "Starting";
    case "running":
      return "Working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Input needed";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "stale":
      return "Stale";
  }
}

function compactAgentActivityState(
  state: RelayAgentActivityAggregateState,
  nowIso: string,
  includeFirstRow: boolean,
): RelayAgentActivityAggregateState {
  const first = includeFirstRow ? state.activities[0] : undefined;
  return {
    ...state,
    title: "T3 Code",
    subtitle: state.activeCount === 1 ? "1 active agent" : `${state.activeCount} active agents`,
    updatedAt: nowIso,
    activities: first
      ? [
          {
            ...first,
            projectTitle: "T3 Code",
            threadTitle: "Agent activity",
            modelTitle: "Agent",
            status: compactStatus(first.phase),
            updatedAt: nowIso,
            deepLink: "/",
          },
        ]
      : [],
  };
}

function makeBoundedLiveActivityPayload(input: {
  readonly state: RelayAgentActivityAggregateState;
  readonly alert: ApnsLiveActivityAlert | null;
  readonly nowIso: string;
  readonly build: (
    state: RelayAgentActivityAggregateState,
    alert: ApnsLiveActivityAlert | null,
  ) => unknown;
}): unknown {
  const state = sanitizeAgentActivityAggregateState(input.state);
  const alert = input.alert === null ? null : sanitizeApnsLiveActivityAlert(input.alert);

  for (let activityCount = state.activities.length; activityCount >= 1; activityCount -= 1) {
    const payload = input.build(
      { ...state, activities: state.activities.slice(0, activityCount) },
      alert,
    );
    if (payloadFitsApns(payload)) {
      return payload;
    }
  }

  const compactWithFirstRow = compactAgentActivityState(state, input.nowIso, true);
  const compactRowPayload = input.build(compactWithFirstRow, alert);
  if (payloadFitsApns(compactRowPayload)) {
    return compactRowPayload;
  }

  const countOnlyPayload = input.build({ ...state, activities: [] }, alert);
  if (payloadFitsApns(countOnlyPayload)) {
    return countOnlyPayload;
  }

  const compactCountOnly = compactAgentActivityState(state, input.nowIso, false);
  const compactCountPayload = input.build(compactCountOnly, alert);
  if (payloadFitsApns(compactCountPayload)) {
    return compactCountPayload;
  }

  return input.build(compactCountOnly, null);
}

interface LiveActivityRequestBase {
  readonly token: string;
  readonly nowEpochSeconds: number;
  readonly nowIso: string;
}

type MakeLiveActivityRequestInput =
  | (LiveActivityRequestBase & {
      readonly event: "end";
      readonly state: RelayAgentActivityAggregateState | null;
      readonly alert?: ApnsLiveActivityAlert | null;
    })
  | (LiveActivityRequestBase & {
      readonly event: "start" | "update";
      readonly state: RelayAgentActivityAggregateState;
      readonly alert?: ApnsLiveActivityAlert | null;
      readonly urgent?: boolean;
    });

// An alert dict on an update/end makes it an "alerting" update: iOS wakes the
// screen and plays the haptic (the Apple Sports score-change behavior) instead
// of silently redrawing the activity.
function liveActivityAlertPayload(alert: ApnsLiveActivityAlert) {
  return {
    alert: {
      title: alert.title,
      body: alert.body,
      sound: "default",
    },
  };
}

// Updates only flow on domain events, so a healthy agent can be silent for a
// long stretch (long tool calls, an approval nobody has answered yet) and iOS
// dims a stale card. The card shows its own age through its relative clock,
// so the stale flag only has to agree with the relay's own row lifetimes: a
// running row is considered live for two hours, a waiting one for a day.
function staleAfterSeconds(state: RelayAgentActivityAggregateState): number {
  const running = state.activities.some(
    (row) => row.phase === "running" || row.phase === "starting",
  );
  return (running ? RUNNING_AGENT_ACTIVITY_ROW_TTL_MS : WAITING_AGENT_ACTIVITY_ROW_TTL_MS) / 1_000;
}

function makeLiveActivityRequest(input: MakeLiveActivityRequestInput): ApnsLiveActivityRequest {
  const timestamp = input.nowEpochSeconds;
  if (input.event === "end") {
    const buildPayload = (
      state: RelayAgentActivityAggregateState | null,
      alert: ApnsLiveActivityAlert | null,
    ) => ({
      aps: {
        timestamp,
        event: "end",
        ...(state ? { "content-state": contentState(state) } : {}),
        ...(alert ? liveActivityAlertPayload(alert) : {}),
        "dismissal-date":
          timestamp + (state ? DISMISS_AFTER_SECONDS : CONTENTLESS_DISMISS_AFTER_SECONDS),
      },
    });
    const alert = input.alert ? sanitizeApnsLiveActivityAlert(input.alert) : null;
    const payload = input.state
      ? makeBoundedLiveActivityPayload({
          state: input.state,
          alert,
          nowIso: input.nowIso,
          build: buildPayload,
        })
      : (() => {
          const withAlert = buildPayload(null, alert);
          return payloadFitsApns(withAlert) ? withAlert : buildPayload(null, null);
        })();
    return {
      token: input.token,
      event: input.event,
      priority: "10",
      payload,
    };
  }

  const buildPayload = (
    state: RelayAgentActivityAggregateState,
    alert: ApnsLiveActivityAlert | null,
  ) => ({
    aps: {
      timestamp,
      event: input.event,
      ...(input.event === "start"
        ? {
            "attributes-type": "LiveActivityAttributes",
            attributes: {},
            "input-push-token": 1,
            alert: {
              title: state.title,
              body: state.subtitle,
            },
          }
        : {}),
      ...(input.event === "update" && alert ? liveActivityAlertPayload(alert) : {}),
      "content-state": contentState(state),
      "stale-date": timestamp + staleAfterSeconds(state),
    },
  });
  const payload = makeBoundedLiveActivityPayload({
    state: input.state,
    alert: input.alert ?? null,
    nowIso: input.nowIso,
    build: buildPayload,
  });
  return {
    token: input.token,
    event: input.event,
    // Alerting and shape-changing updates (phase transitions, rows coming or
    // going) must land immediately; routine content redraws stay at the
    // budget-friendly low priority so iOS never throttles the activity.
    priority: input.event === "update" && !input.alert && !input.urgent ? "5" : "10",
    payload,
  };
}

function makePushNotificationRequest(input: {
  readonly token: string;
  readonly notification: ApnsNotificationPayload;
}): ApnsPushNotificationRequest {
  const notification = sanitizeApnsNotificationPayload(input.notification);
  const buildPayload = (includeRouting: boolean, useOriginalCopy: boolean) => ({
    aps: {
      alert: {
        title: useOriginalCopy ? notification.title : "T3 Code",
        body: useOriginalCopy ? notification.body : "Agent activity needs attention",
      },
      sound: "default",
    },
    ...(includeRouting
      ? {
          environmentId: notification.environmentId,
          threadId: notification.threadId,
          deepLink: useOriginalCopy ? notification.deepLink : "/",
        }
      : {}),
  });
  const fullPayload = buildPayload(true, true);
  const compactPayload = buildPayload(true, false);
  return {
    token: input.token,
    priority: "10",
    payload: payloadFitsApns(fullPayload)
      ? fullPayload
      : payloadFitsApns(compactPayload)
        ? compactPayload
        : buildPayload(false, false),
  };
}

function apnsReasonFromBody(body: string): string | undefined {
  if (body.trim().length === 0) {
    return undefined;
  }
  return Option.match(decodeApnsErrorResponseJson(body), {
    onNone: () => body,
    onSome: (parsed) => parsed.reason ?? body,
  });
}

function readApnsResponseText<E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E | ApnsResponseBodyTooLargeError> {
  interface CollectState {
    readonly chunks: Array<Uint8Array>;
    readonly bytes: number;
    readonly truncated: boolean;
  }
  return stream.pipe(
    Stream.mapAccum(
      () => 0,
      (bytes, chunk) => {
        const remaining = Math.max(0, APNS_RESPONSE_MAX_BYTES - bytes);
        const retained = chunk.byteLength > remaining ? chunk.slice(0, remaining) : chunk;
        return [
          bytes + retained.byteLength,
          [{ retained, truncated: chunk.byteLength > remaining }],
        ] as const;
      },
    ),
    Stream.takeUntil((chunk) => chunk.truncated),
    Stream.runFold(
      (): CollectState => ({
        chunks: [] as Array<Uint8Array>,
        bytes: 0,
        truncated: false,
      }),
      (state, chunk) => {
        if (chunk.retained.byteLength > 0) {
          state.chunks.push(chunk.retained);
        }
        return {
          chunks: state.chunks,
          bytes: state.bytes + chunk.retained.byteLength,
          truncated: state.truncated || chunk.truncated,
        };
      },
    ),
    Effect.flatMap((collected) => {
      if (collected.truncated) {
        return Effect.fail(
          new ApnsResponseBodyTooLargeError({ maxBytes: APNS_RESPONSE_MAX_BYTES }),
        );
      }
      return Effect.sync(() => {
        const bytes = new Uint8Array(collected.bytes);
        let offset = 0;
        for (const chunk of collected.chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder().decode(bytes);
      });
    }),
  );
}

function validateApnsPayload(input: {
  readonly requestKind: typeof ApnsRequestKindSchema.Type;
  readonly event: ApnsLiveActivityEvent | null;
  readonly credentials: ApnsCredentials;
  readonly token: string;
  readonly payload: unknown;
}): Effect.Effect<void, ApnsHttpRequestError> {
  return Effect.try({
    try: () => {
      const byteLength = apnsPayloadByteLength(input.payload);
      if (byteLength > APNS_PAYLOAD_MAX_BYTES) {
        throw new Error(
          `APNs payload is ${byteLength} bytes; maximum is ${APNS_PAYLOAD_MAX_BYTES} bytes.`,
        );
      }
    },
    catch: (cause) =>
      new ApnsHttpRequestError({
        requestKind: input.requestKind,
        event: input.event,
        environment: input.credentials.environment,
        bundleId: input.credentials.bundleId,
        tokenSuffix: input.token.slice(-8),
        stage: "validate-payload",
        status: null,
        cause,
      }),
  });
}

interface ApnsRequestContext {
  readonly requestKind: typeof ApnsRequestKindSchema.Type;
  readonly event: ApnsLiveActivityEvent | null;
  readonly environment: ApnsCredentials["environment"];
  readonly bundleId: string;
  readonly tokenSuffix: string;
}

function withApnsRequestDeadline<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: ApnsRequestContext,
): Effect.Effect<A, E | ApnsHttpRequestError, R> {
  return effect.pipe(
    Effect.timeoutOption(APNS_REQUEST_TIMEOUT_MS),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new ApnsHttpRequestError({
              requestKind: context.requestKind,
              event: context.event,
              environment: context.environment,
              bundleId: context.bundleId,
              tokenSuffix: context.tokenSuffix,
              stage: "deadline",
              status: null,
              cause: new Error(`APNs request exceeded ${APNS_REQUEST_TIMEOUT_MS}ms.`),
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
}

export class ApnsClient extends Context.Service<
  ApnsClient,
  {
    readonly makeLiveActivityRequest: typeof makeLiveActivityRequest;
    readonly makePushNotificationRequest: typeof makePushNotificationRequest;
    readonly sendLiveActivityRequest: (input: {
      readonly credentials: ApnsCredentials;
      readonly request: ApnsLiveActivityRequest;
      readonly issuedAtUnixSeconds: number;
    }) => Effect.Effect<ApnsDeliveryResult, ApnsError>;
    readonly sendPushNotificationRequest: (input: {
      readonly credentials: ApnsCredentials;
      readonly request: ApnsPushNotificationRequest;
      readonly issuedAtUnixSeconds: number;
    }) => Effect.Effect<ApnsDeliveryResult, ApnsError>;
  }
>()("t3code-relay/agentActivity/ApnsClient") {}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const providerTokens = yield* ApnsProviderTokens.ApnsProviderTokens;

  const sendLiveActivityRequest: ApnsClient["Service"]["sendLiveActivityRequest"] = Effect.fn(
    "relay.apns.send_live_activity_request",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan({ "relay.apns.event": input.request.event });
    yield* validateApnsPayload({
      requestKind: "live-activity",
      event: input.request.event,
      credentials: input.credentials,
      token: input.request.token,
      payload: input.request.payload,
    });
    const jwt = yield* providerTokens.getJwt({
      ...input.credentials,
      issuedAtUnixSeconds: input.issuedAtUnixSeconds,
    });
    const host =
      input.credentials.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const requestContext = {
      requestKind: "live-activity",
      event: input.request.event,
      environment: input.credentials.environment,
      bundleId: input.credentials.bundleId,
      tokenSuffix: input.request.token.slice(-8),
    } as const;
    const { response, responseText } = yield* withApnsRequestDeadline(
      Effect.gen(function* () {
        const response = yield* HttpClientRequest.post(
          `${host}/3/device/${input.request.token}`,
        ).pipe(
          HttpClientRequest.setHeaders({
            authorization: `bearer ${jwt}`,
            "apns-priority": input.request.priority,
            "apns-push-type": "liveactivity",
            "apns-topic": `${input.credentials.bundleId}.push-type.liveactivity`,
          }),
          HttpClientRequest.bodyJson(input.request.payload),
          Effect.flatMap(httpClient.execute),
          Effect.mapError(
            (cause) =>
              new ApnsHttpRequestError({
                ...requestContext,
                stage: "send",
                status: null,
                cause,
              }),
          ),
        );
        const responseText = yield* readApnsResponseText(response.stream).pipe(
          Effect.mapError(
            (cause) =>
              new ApnsHttpRequestError({
                ...requestContext,
                stage: "read-response",
                status: response.status,
                cause,
              }),
          ),
        );
        return { response, responseText };
      }),
      requestContext,
    );
    const reason = apnsReasonFromBody(responseText);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      ...(reason === undefined ? {} : { reason }),
      apnsId: Option.getOrNull(Headers.get(response.headers, "apns-id")),
    };
  });

  const sendPushNotificationRequest: ApnsClient["Service"]["sendPushNotificationRequest"] =
    Effect.fn("relay.apns.send_push_notification_request")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.apns.event": "push_notification" });
      yield* validateApnsPayload({
        requestKind: "push-notification",
        event: null,
        credentials: input.credentials,
        token: input.request.token,
        payload: input.request.payload,
      });
      const jwt = yield* providerTokens.getJwt({
        ...input.credentials,
        issuedAtUnixSeconds: input.issuedAtUnixSeconds,
      });
      const host =
        input.credentials.environment === "production"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com";
      const requestContext = {
        requestKind: "push-notification",
        event: null,
        environment: input.credentials.environment,
        bundleId: input.credentials.bundleId,
        tokenSuffix: input.request.token.slice(-8),
      } as const;
      const { response, responseText } = yield* withApnsRequestDeadline(
        Effect.gen(function* () {
          const response = yield* HttpClientRequest.post(
            `${host}/3/device/${input.request.token}`,
          ).pipe(
            HttpClientRequest.setHeaders({
              authorization: `bearer ${jwt}`,
              "apns-priority": input.request.priority,
              "apns-push-type": "alert",
              "apns-topic": input.credentials.bundleId,
            }),
            HttpClientRequest.bodyJson(input.request.payload),
            Effect.flatMap(httpClient.execute),
            Effect.mapError(
              (cause) =>
                new ApnsHttpRequestError({
                  ...requestContext,
                  stage: "send",
                  status: null,
                  cause,
                }),
            ),
          );
          const responseText = yield* readApnsResponseText(response.stream).pipe(
            Effect.mapError(
              (cause) =>
                new ApnsHttpRequestError({
                  ...requestContext,
                  stage: "read-response",
                  status: response.status,
                  cause,
                }),
            ),
          );
          return { response, responseText };
        }),
        requestContext,
      );
      const reason = apnsReasonFromBody(responseText);
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        ...(reason === undefined ? {} : { reason }),
        apnsId: Option.getOrNull(Headers.get(response.headers, "apns-id")),
      };
    });

  return ApnsClient.of({
    makeLiveActivityRequest,
    makePushNotificationRequest,
    sendLiveActivityRequest,
    sendPushNotificationRequest,
  });
});

export const layer = Layer.effect(ApnsClient, make);
