import { ReadAloudUpstreamError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/http";

import {
  executeEnvironmentHttpRequest,
  executeEnvironmentHttpRequestWithAdditionalError,
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthTimeoutError,
  layerRemoteHttpClient,
} from "./http.ts";

describe("executeEnvironmentHttpRequest", () => {
  it.effect("times out and aborts a stalled response body after headers have arrived", () =>
    Effect.gen(function* () {
      const bodyStarted = Promise.withResolvers<void>();
      let requestSignal: AbortSignal | null = null;
      const fetchFn = ((_url, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null)
          throw new Error("Expected a fetch abort signal.");
        requestSignal = signal;
        const response = new Response("", { headers: { "content-type": "application/json" } });
        response.arrayBuffer = () => {
          bodyStarted.resolve();
          return new Promise<ArrayBuffer>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("response aborted")), {
              once: true,
            });
          });
        };
        return Promise.resolve(response);
      }) satisfies typeof fetch;
      const requestUrl = "https://environment.test/api/config";
      const request = HttpClient.HttpClient.pipe(
        Effect.flatMap((client) => client.get(requestUrl)),
        Effect.flatMap((response) => response.json),
      );
      const result = yield* executeEnvironmentHttpRequest(requestUrl, 25, request).pipe(
        Effect.provide(layerRemoteHttpClient(fetchFn)),
        Effect.flip,
        Effect.forkChild,
      );
      yield* Effect.promise(() => bodyStarted.promise);
      yield* TestClock.adjust(25);

      expect(yield* Fiber.join(result)).toBeInstanceOf(RemoteEnvironmentAuthTimeoutError);
      expect(requestSignal).toMatchObject({ aborted: true });
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("contains hostile failure coercion in the typed fetch error", () =>
    Effect.gen(function* () {
      const hostile = {
        [Symbol.toPrimitive]() {
          throw new Error("coercion must not escape");
        },
      };
      Object.defineProperty(hostile, "message", {
        get: () => {
          throw new Error("message getter must not escape");
        },
      });

      const error = yield* executeEnvironmentHttpRequest(
        "https://environment.test/api/config",
        1_000,
        Effect.fail(hostile),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RemoteEnvironmentAuthFetchError);
      if (!(error instanceof RemoteEnvironmentAuthFetchError)) return;
      expect(error.cause).toBe(hostile);
      expect(error.message).toBe(
        "Failed to fetch remote environment endpoint https://environment.test/api/config (object).",
      );
    }),
  );

  it.effect("bounds retained failure detail", () =>
    Effect.gen(function* () {
      const requestUrl = "https://environment.test/api/config";
      const error = yield* executeEnvironmentHttpRequest(
        requestUrl,
        1_000,
        Effect.fail({ name: "FetchFailure", message: "x".repeat(32_000) }),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(RemoteEnvironmentAuthFetchError);
      if (!(error instanceof RemoteEnvironmentAuthFetchError)) return;
      const fixedTextLength = `Failed to fetch remote environment endpoint ${requestUrl} ().`
        .length;
      expect(error.message.length).toBeLessThanOrEqual(fixedTextLength + 4_096);
    }),
  );

  it.effect("preserves endpoint-specific errors without treating them as connection failures", () =>
    Effect.gen(function* () {
      const failure = new ReadAloudUpstreamError();
      const error = yield* executeEnvironmentHttpRequestWithAdditionalError(
        "https://environment.test/api/read-aloud/synthesize",
        1_000,
        Effect.fail(failure),
        Schema.is(ReadAloudUpstreamError),
      ).pipe(Effect.flip);

      expect(error).toBe(failure);
    }),
  );
});
