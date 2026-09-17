import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { releaseHttpClientResponseBody } from "./releaseHttpClientResponseBody.ts";

it.effect("releases a response after consuming at most one chunk", () =>
  Effect.gen(function* () {
    let consumed = 0;
    let finalized = 0;
    const response = {
      stream: Stream.fromIterable([
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
      ]).pipe(
        Stream.tap(() => Effect.sync(() => consumed++)),
        Stream.ensuring(Effect.sync(() => finalized++)),
      ),
    };

    yield* releaseHttpClientResponseBody(response);

    expect(consumed).toBe(1);
    expect(finalized).toBe(1);
  }),
);

it.effect("treats an absent response body as already released", () =>
  releaseHttpClientResponseBody({
    stream: Stream.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request: HttpClientRequest.get("https://example.test/no-body"),
        }),
      }),
    ),
  }),
);
