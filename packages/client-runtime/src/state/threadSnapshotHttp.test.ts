import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { RelayConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { fetchEnvironmentThreadSnapshot } from "./threadSnapshotHttp.ts";

describe("fetchEnvironmentThreadSnapshot", () => {
  it.effect("signs the same contract-encoded path that the HTTP client requests", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-1");
      const target = new RelayConnectionTarget({
        environmentId,
        label: "Remote environment",
      });
      const prepared: PreparedConnection = {
        environmentId,
        label: target.label,
        httpBaseUrl: "https://environment.example.test/base",
        socketUrl: "wss://environment.example.test/ws",
        httpAuthorization: { _tag: "Dpop", accessToken: "access-token" },
        target,
      };
      let proofUrl: string | null = null;
      let requestedUrl: string | null = null;
      const signer = ManagedRelayDpopSigner.of({
        thumbprint: Effect.succeed("thumbprint"),
        createProof: (input) =>
          Effect.sync(() => {
            proofUrl = input.url;
            return "proof";
          }),
      });
      const fetchFn = ((request) => {
        requestedUrl = String(request);
        return Promise.resolve(new Response(null, { status: 503 }));
      }) satisfies typeof fetch;

      yield* fetchEnvironmentThreadSnapshot({
        prepared,
        threadId: ThreadId.make("thread/with space"),
        signer: Option.some(signer),
      }).pipe(Effect.exit, Effect.provide(remoteHttpClientLayer(fetchFn)));

      const expectedUrl =
        "https://environment.example.test/api/orchestration/threads/thread%2Fwith%20space";
      expect(proofUrl).toBe(expectedUrl);
      expect(requestedUrl).toBe(expectedUrl);
    }),
  );
});
