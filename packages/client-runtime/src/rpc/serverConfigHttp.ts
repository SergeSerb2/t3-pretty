import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import type { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  buildEnvironmentAuthHeaders,
  withEnvironmentCredentials,
} from "../state/environmentHttpAuth.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "./http.ts";

const SERVER_CONFIG_TIMEOUT_MS = 6_000;

export const fetchEnvironmentServerConfig = Effect.fn(
  "clientRuntime.rpc.fetchEnvironmentServerConfig",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly timeoutMs?: number;
}) {
  const requestUrl = environmentEndpointUrl(input.prepared.httpBaseUrl, "/api/server/config");
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "GET",
    requestUrl,
    input.signer,
  );
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? SERVER_CONFIG_TIMEOUT_MS,
    withEnvironmentCredentials(input.prepared.httpAuthorization, client.server.config({ headers })),
  );
});
