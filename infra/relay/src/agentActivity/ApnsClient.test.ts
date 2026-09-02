import * as NodeCrypto from "node:crypto";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { ApnsCredentials } from "../Config.ts";
import * as ApnsClient from "./ApnsClient.ts";
import * as ApnsProviderTokens from "./ApnsProviderTokens.ts";

const isApnsJwtSigningError = Schema.is(ApnsClient.ApnsJwtSigningError);
const isApnsHttpRequestError = Schema.is(ApnsClient.ApnsHttpRequestError);
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeDeliveredState = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      activeCount: Schema.Number,
      activities: Schema.Array(Schema.Struct({ environmentId: Schema.String })),
    }),
  ),
);

const TestLayer = ApnsClient.layer.pipe(
  Layer.provide(ApnsProviderTokens.layer),
  Layer.provide(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unexpected APNs HTTP request")),
    ),
  ),
);

describe("ApnsClient", () => {
  const now = DateTime.makeUnsafe(0);
  const state: RelayAgentActivityAggregateState = {
    title: "T3 Code",
    subtitle: "Agent work in progress",
    activeCount: 1,
    updatedAt: DateTime.formatIso(now),
    activities: [
      {
        environmentId: EnvironmentId.make("env"),
        threadId: ThreadId.make("thread"),
        projectTitle: "Project",
        threadTitle: "Thread",
        modelTitle: "gpt-5.4",
        phase: "running" as const,
        status: "Working",
        updatedAt: DateTime.formatIso(now),
        deepLink: "/",
      },
    ],
  };

  const payloadBytes = (payload: unknown) =>
    new TextEncoder().encode(encodeUnknownJson(payload)).byteLength;

  it.effect("requests an update push token when remotely starting a Live Activity", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makeLiveActivityRequest({
        event: "start",
        token: "token",
        state,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(request.priority).toBe("10");
      expect(request.payload).toMatchObject({
        aps: {
          event: "start",
          "attributes-type": "LiveActivityAttributes",
          "input-push-token": 1,
          "content-state": {
            name: "AgentActivity",
          },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds a low-priority update payload", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makeLiveActivityRequest({
        event: "update",
        token: "token",
        state,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(request.priority).toBe("5");
      expect(request.payload).toMatchObject({
        aps: {
          event: "update",
          "content-state": {
            name: "AgentActivity",
          },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds a high-priority update payload when the update is urgent", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makeLiveActivityRequest({
        event: "update",
        token: "token",
        state,
        urgent: true,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(request.priority).toBe("10");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds a high-priority alerting update payload when an alert is attached", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makeLiveActivityRequest({
        event: "update",
        token: "token",
        state,
        alert: { title: "Thread", body: "Approval: Project" },
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(request.priority).toBe("10");
      expect(request.payload).toMatchObject({
        aps: {
          event: "update",
          alert: {
            title: "Thread",
            body: "Approval: Project",
            sound: "default",
          },
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds an end payload with a dismissal date", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makeLiveActivityRequest({
        event: "end",
        token: "token",
        state,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(request.priority).toBe("10");
      expect(request.payload).toMatchObject({
        aps: {
          event: "end",
          "dismissal-date": 300,
        },
      });

      // Without final content the card would freeze on its previous state;
      // contentless ends dismiss quickly instead.
      const contentless = apns.makeLiveActivityRequest({
        event: "end",
        token: "token",
        state: null,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });
      expect(contentless.payload).toMatchObject({
        aps: {
          event: "end",
          "dismissal-date": 15,
        },
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("builds a standard APNs alert payload with routing metadata", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env",
          threadId: "thread",
          deepLink: "/threads/env/thread",
        },
      });

      expect(request.priority).toBe("10");
      expect(request.payload).toMatchObject({
        aps: {
          alert: {
            title: "Thread",
            body: "Input: Project",
          },
          sound: "default",
        },
        environmentId: "env",
        threadId: "thread",
        deepLink: "/threads/env/thread",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("compacts Live Activity state to the APNs payload ceiling", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const largeRow = {
        ...state.activities[0]!,
        environmentId: EnvironmentId.make("e".repeat(191)),
        threadId: ThreadId.make("t".repeat(191)),
        projectTitle: "p".repeat(120),
        threadTitle: "t".repeat(120),
        modelTitle: "m".repeat(120),
        status: "s".repeat(40),
        deepLink: "/" + "d".repeat(511),
      };
      const request = apns.makeLiveActivityRequest({
        event: "start",
        token: "token",
        state: {
          ...state,
          activeCount: 5,
          activities: Array.from({ length: 5 }, () => largeRow),
        },
        alert: { title: "a".repeat(120), body: "b".repeat(120) },
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        nowIso: DateTime.formatIso(now),
      });

      expect(payloadBytes(request.payload)).toBeLessThanOrEqual(ApnsClient.APNS_PAYLOAD_MAX_BYTES);
      const payload = request.payload as {
        readonly aps: { readonly "content-state": { readonly props: string } };
      };
      const deliveredState = decodeDeliveredState(payload.aps["content-state"].props);
      expect(deliveredState.activeCount).toBe(5);
      expect(deliveredState.activities[0]?.environmentId).toBe(largeRow.environmentId);
      expect(deliveredState.activities.length).toBeLessThan(5);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps pathological notification metadata below the APNs payload ceiling", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "push-token",
        notification: {
          title: "\u0000".repeat(120),
          body: "\u0000".repeat(120),
          environmentId: "\u0000".repeat(191),
          threadId: "\u0000".repeat(191),
          deepLink: "/" + "\u0000".repeat(511),
        },
      });

      expect(payloadBytes(request.payload)).toBeLessThanOrEqual(ApnsClient.APNS_PAYLOAD_MAX_BYTES);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("preserves JWT signing context and the crypto cause", () =>
    Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env",
          threadId: "thread",
          deepLink: "/threads/env/thread",
        },
      });
      const error = yield* Effect.flip(
        apns.sendPushNotificationRequest({
          credentials: {
            teamId: "team-1",
            keyId: "key-1",
            privateKey: Redacted.make("not-a-private-key"),
            bundleId: "com.t3tools.test",
            environment: "sandbox",
          },
          request,
          issuedAtUnixSeconds: 123,
        }),
      );

      expect(isApnsJwtSigningError(error)).toBe(true);
      if (!isApnsJwtSigningError(error)) {
        return yield* Effect.die("expected APNs JWT signing error");
      }
      expect(error).toMatchObject({
        teamId: "team-1",
        keyId: "key-1",
        // The provider-token service quantizes iat to the reuse window, so
        // the signing context carries the window start rather than the raw
        // request time.
        issuedAtUnixSeconds: 0,
        cause: expect.any(Error),
        message: "Failed to sign APNs JWT for key key-1.",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("preserves APNs request context and the HTTP cause", () => {
    const httpCause = new Error("network unavailable");
    const { privateKey } = NodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const credentials = {
      teamId: "team-1",
      keyId: "key-1",
      privateKey: Redacted.make(privateKey),
      bundleId: "com.t3tools.test",
      environment: "sandbox",
    } satisfies ApnsCredentials;
    const failingHttpClient = HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: httpCause }),
        }),
      ),
    );
    const layer = ApnsClient.layer.pipe(
      Layer.provide(ApnsProviderTokens.layer),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, failingHttpClient)),
    );

    return Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "long-push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env",
          threadId: "thread",
          deepLink: "/threads/env/thread",
        },
      });
      const error = yield* Effect.flip(
        apns.sendPushNotificationRequest({
          credentials,
          request,
          issuedAtUnixSeconds: 123,
        }),
      );

      expect(isApnsHttpRequestError(error)).toBe(true);
      if (!isApnsHttpRequestError(error)) {
        return yield* Effect.die("expected APNs HTTP request error");
      }
      expect(error).toMatchObject({
        requestKind: "push-notification",
        event: null,
        environment: "sandbox",
        bundleId: "com.t3tools.test",
        tokenSuffix: "sh-token",
        stage: "send",
        status: null,
        message: "APNs push-notification request failed during send in sandbox.",
      });
      expect(error.cause).toBeInstanceOf(HttpClientError.HttpClientError);
      expect((error.cause as HttpClientError.HttpClientError).reason).toMatchObject({
        _tag: "TransportError",
        cause: httpCause,
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects oversized APNs response bodies without retaining them", () => {
    const { privateKey } = NodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const credentials = {
      teamId: "team-response-limit",
      keyId: "key-response-limit",
      privateKey: Redacted.make(privateKey),
      bundleId: "com.t3tools.test",
      environment: "sandbox",
    } satisfies ApnsCredentials;
    const oversizedHttpClient = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("x".repeat(ApnsClient.APNS_RESPONSE_MAX_BYTES + 1), { status: 500 }),
        ),
      ),
    );
    const layer = ApnsClient.layer.pipe(
      Layer.provide(ApnsProviderTokens.layer),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, oversizedHttpClient)),
    );

    return Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env",
          threadId: "thread",
          deepLink: "/threads/env/thread",
        },
      });
      const error = yield* apns
        .sendPushNotificationRequest({ credentials, request, issuedAtUnixSeconds: 123 })
        .pipe(Effect.flip);

      expect(isApnsHttpRequestError(error)).toBe(true);
      if (!isApnsHttpRequestError(error)) {
        return yield* Effect.die("expected APNs HTTP request error");
      }
      expect(error).toMatchObject({ stage: "read-response", status: 500 });
      expect(String(error.cause)).toContain("APNs response exceeded 8192 bytes");
    }).pipe(Effect.provide(layer));
  });

  it.effect("applies one deadline across the APNs request and response body", () =>
    Effect.gen(function* () {
      const requestStarted = yield* Deferred.make<void>();
      const hangingHttpClient = HttpClient.make(() =>
        Deferred.succeed(requestStarted, undefined).pipe(
          Effect.andThen(Effect.never as Effect.Effect<HttpClientResponse.HttpClientResponse>),
        ),
      );
      const layer = ApnsClient.layer.pipe(
        Layer.provide(ApnsProviderTokens.layer),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, hangingHttpClient)),
      );
      const { privateKey } = NodeCrypto.generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });

      const error = yield* Effect.gen(function* () {
        const apns = yield* ApnsClient.ApnsClient;
        const request = apns.makePushNotificationRequest({
          token: "deadline-token",
          notification: {
            title: "Thread",
            body: "Input: Project",
            environmentId: "env",
            threadId: "thread",
            deepLink: "/threads/env/thread",
          },
        });
        const fiber = yield* apns
          .sendPushNotificationRequest({
            credentials: {
              teamId: "team-deadline",
              keyId: "key-deadline",
              privateKey: Redacted.make(privateKey),
              bundleId: "com.t3tools.test",
              environment: "sandbox",
            },
            request,
            issuedAtUnixSeconds: 123,
          })
          .pipe(Effect.flip, Effect.forkChild);
        yield* Deferred.await(requestStarted);
        yield* TestClock.adjust(Duration.millis(ApnsClient.APNS_REQUEST_TIMEOUT_MS));
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer));

      expect(isApnsHttpRequestError(error)).toBe(true);
      if (!isApnsHttpRequestError(error)) {
        return yield* Effect.die("expected APNs HTTP request error");
      }
      expect(error).toMatchObject({ stage: "deadline", status: null });
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reuses the signed provider JWT across pushes within the reuse window", () => {
    ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    const { privateKey } = NodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const credentials = {
      teamId: "team-jwt-cache",
      keyId: "key-jwt-cache",
      privateKey: Redacted.make(privateKey),
      bundleId: "com.t3tools.test",
      environment: "sandbox",
    } satisfies ApnsCredentials;
    const authorizations: Array<string> = [];
    const capturingHttpClient = HttpClient.make((request) => {
      authorizations.push(request.headers.authorization ?? "");
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("", { status: 200, headers: { "apns-id": "apns-id-1" } }),
        ),
      );
    });
    const layer = ApnsClient.layer.pipe(
      Layer.provide(ApnsProviderTokens.layer),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, capturingHttpClient)),
    );

    return Effect.gen(function* () {
      const apns = yield* ApnsClient.ApnsClient;
      const request = apns.makePushNotificationRequest({
        token: "push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env",
          threadId: "thread",
          deepLink: "/threads/env/thread",
        },
      });
      const send = (issuedAtUnixSeconds: number) =>
        apns.sendPushNotificationRequest({ credentials, request, issuedAtUnixSeconds });

      const window = ApnsProviderTokens.APNS_JWT_REUSE_SECONDS;
      yield* send(window + 10);
      yield* send(window * 2 - 1);
      yield* send(window * 2);

      expect(authorizations).toHaveLength(3);
      // Within the 45-minute window APNs must see the byte-identical token;
      // refreshing it per push trips TooManyProviderTokenUpdates.
      expect(authorizations[1]).toBe(authorizations[0]);
      expect(authorizations[2]).not.toBe(authorizations[0]);
      ApnsProviderTokens.__resetApnsProviderTokenCacheForTest();
    }).pipe(Effect.provide(layer));
  });
});
