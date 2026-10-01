import { RelayApi } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import type * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../cloud/config.ts";

export interface RelayEnvironmentConfig {
  readonly url: string;
  readonly issuer: string;
  readonly environmentCredential: string;
}

/**
 * The relay link this environment holds, or null until a Connect link has
 * installed its URL and environment credential.
 */
export const readRelayEnvironmentConfig = (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
) => {
  const readSecretString = (name: string) =>
    secrets
      .get(name)
      .pipe(
        Effect.map((bytes) =>
          Option.isSome(bytes) ? new TextDecoder().decode(bytes.value) : null,
        ),
      );
  return Effect.gen(function* () {
    const [url, issuer, environmentCredential] = yield* Effect.all([
      readSecretString(RELAY_URL_SECRET),
      readSecretString(RELAY_ISSUER_SECRET),
      readSecretString(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
    ]);
    return url && environmentCredential
      ? ({ url, issuer: issuer ?? url, environmentCredential } satisfies RelayEnvironmentConfig)
      : null;
  });
};

/** A relay API client authenticated as this environment. */
export const makeRelayEnvironmentClient = (
  config: Pick<RelayEnvironmentConfig, "url" | "environmentCredential">,
) =>
  HttpApiClient.make(RelayApi, {
    baseUrl: config.url,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader("authorization", `Bearer ${config.environmentCredential}`),
    ),
  }).pipe(Effect.provide(FetchHttpClient.layer));
