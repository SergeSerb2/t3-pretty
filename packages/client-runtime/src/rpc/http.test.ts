import { DictationUpstreamError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  executeEnvironmentHttpRequest,
  executeEnvironmentHttpRequestWithAdditionalError,
  RemoteEnvironmentAuthFetchError,
} from "./http.ts";

describe("executeEnvironmentHttpRequest", () => {
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
      const failure = new DictationUpstreamError({ reason: "transcription_failed" });
      const error = yield* executeEnvironmentHttpRequestWithAdditionalError(
        "https://environment.test/api/dictation/transcribe",
        1_000,
        Effect.fail(failure),
        Schema.is(DictationUpstreamError),
      ).pipe(Effect.flip);

      expect(error).toBe(failure);
    }),
  );
});
