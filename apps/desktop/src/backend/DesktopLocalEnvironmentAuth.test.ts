import { assert, describe, it } from "@effect/vitest";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./DesktopLocalEnvironmentAuth.ts";

const config = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: {},
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "desktop-bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

const refused = (request: HttpClientRequest.HttpClientRequest) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: "connect ECONNREFUSED 127.0.0.1:3773",
      cause: new Error("connect ECONNREFUSED 127.0.0.1:3773"),
    }),
  });

const tokenResponse = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(
      JSON.stringify({
        access_token: "desktop-bearer-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "orchestration:read",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

class BackendReadyLatchError extends Schema.TaggedErrorClass<BackendReadyLatchError>()(
  "BackendReadyLatchError",
  { message: Schema.String },
) {}

const makePoolLayer = (options?: {
  readonly waitForReady?: Effect.Effect<boolean, unknown>;
}): Layer.Layer<DesktopBackendPool.DesktopBackendPool> =>
  Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
    list: Effect.succeed([
      {
        id: PRIMARY_LOCAL_ENVIRONMENT_ID,
        label: Effect.succeed("Windows"),
        currentConfig: Effect.succeed(Option.some(config)),
        waitForReady: () => options?.waitForReady ?? Effect.succeed(true),
      },
    ]),
  } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);

describe("DesktopLocalEnvironmentAuth", () => {
  it("keeps the ready-plus-retry budget inside the renderer IPC timeout", () => {
    const rendererIpcTimeoutMs = 40_000;
    assert.isAtMost(
      Duration.toMillis(DesktopLocalEnvironmentAuth.LOCAL_ENVIRONMENT_AUTH_READY_TIMEOUT) +
        Duration.toMillis(DesktopLocalEnvironmentAuth.LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_TIMEOUT),
      rendererIpcTimeoutMs,
    );
  });

  it.effect("exchanges the desktop bootstrap credential only once", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(Effect.as(tokenResponse(request))),
        ),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(makePoolLayer(), httpClientLayer)),
      );

      const [first, second] = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* Effect.all([auth.getBearerToken, auth.getBearerToken]);
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(first, "desktop-bearer-token");
      assert.strictEqual(second, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("waits for backend ready before exchanging the bootstrap credential", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const ready = yield* Deferred.make<boolean>();
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(Effect.as(tokenResponse(request))),
        ),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(
          Layer.mergeAll(makePoolLayer({ waitForReady: Deferred.await(ready) }), httpClientLayer),
        ),
      );

      const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth.pipe(
        Effect.provide(testLayer),
      );
      const fiber = yield* auth.getBearerToken.pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.yieldNow;

      assert.strictEqual(yield* Ref.get(requestCount), 0);

      yield* Deferred.succeed(ready, true);
      assert.strictEqual(yield* Fiber.join(fiber), "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("maps a ready-latch failure to a serializable session bootstrap error", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(Effect.as(tokenResponse(request))),
        ),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            makePoolLayer({
              waitForReady: new BackendReadyLatchError({ message: "ready latch failed" }),
            }),
            httpClientLayer,
          ),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* auth.getBearerToken;
      }).pipe(Effect.provide(testLayer), Effect.flip);

      assert.strictEqual(error._tag, "DesktopLocalEnvironmentAuthSessionBootstrapError");
      assert.strictEqual(typeof error.cause, "string");
      assert.strictEqual(error.cause, "ready latch failed");
      assert.strictEqual(yield* Ref.get(requestCount), 0);
    }),
  );

  it.effect("retries a pre-ready transport failure until the token exchange succeeds", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const count = yield* Ref.updateAndGet(requestCount, (value) => value + 1);
            if (count === 1) {
              return yield* refused(request);
            }
            return tokenResponse(request);
          }),
        ),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(makePoolLayer(), httpClientLayer)),
      );

      const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth.pipe(
        Effect.provide(testLayer),
      );
      const fiber = yield* auth.getBearerToken.pipe(Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust(DesktopLocalEnvironmentAuth.LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_SPACING);

      assert.strictEqual(yield* Fiber.join(fiber), "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 2);
    }),
  );

  it.effect("does not retry an invalid bootstrap credential", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify({ error: "invalid_grant" }), {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }),
              ),
            ),
          ),
        ),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(makePoolLayer(), httpClientLayer)),
      );

      const error = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* auth.getBearerToken;
      }).pipe(Effect.provide(testLayer), Effect.flip);

      assert.strictEqual(error._tag, "DesktopLocalEnvironmentAuthSessionBootstrapError");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("fails open with a serializable cause after the exchange retry window", () =>
    Effect.gen(function* () {
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => Effect.fail(refused(request))),
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(makePoolLayer(), httpClientLayer)),
      );

      const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth.pipe(
        Effect.provide(testLayer),
      );
      const fiber = yield* auth.getBearerToken.pipe(
        Effect.flip,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* TestClock.adjust(DesktopLocalEnvironmentAuth.LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_TIMEOUT);
      yield* TestClock.adjust(Duration.millis(1));

      const error = yield* Fiber.join(fiber);
      assert.strictEqual(error._tag, "DesktopLocalEnvironmentAuthSessionBootstrapError");
      assert.strictEqual(typeof error.cause, "string");
      assert.strictEqual(error.cause, "Timed out waiting for the local backend bearer session.");
    }),
  );
});
