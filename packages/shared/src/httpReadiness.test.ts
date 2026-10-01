import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { waitForHttpReady } from "./httpReadiness.ts";

it.effect("accepts a successful readiness response with no body", () => {
  let probes = 0;
  return waitForHttpReady({
    baseUrl: "http://localhost:3773",
    makeError: ({ cause }) => new Error("Readiness failed", { cause }),
  }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        probes += 1;
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })),
        );
      }),
    ),
    Effect.tap(() => Effect.sync(() => assert.equal(probes, 1))),
  );
});
