import { verifyDpopProof } from "@t3tools/shared/dpop";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import {
  ServerAuthDpopReplayKeyCalculationError,
  ServerAuthDpopReplayStateRecordError,
  ServerAuthInvalidCredentialError,
  type ServerAuthInternalError,
} from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

export const DPOP_REPLAY_RETENTION = Duration.seconds(305);

export const scheduleDpopReplayStateRemoval = Effect.fn("auth.dpop.scheduleReplayStateRemoval")(
  function* (secretStore: ServerSecretStore.ServerSecretStore["Service"], secretName: string) {
    yield* secretStore.remove(secretName).pipe(
      Effect.delay(DPOP_REPLAY_RETENTION),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to prune expired DPoP proof replay state.", {
          cause,
        }),
      ),
      Effect.forkDetach({ startImmediately: true }),
    );
  },
);

export const mapDpopReplayStoreError = (
  error: ServerSecretStore.SecretStoreError,
): ServerAuthInvalidCredentialError | ServerAuthInternalError =>
  ServerSecretStore.isSecretAlreadyExistsError(error)
    ? new ServerAuthInvalidCredentialError({
        diagnostic: "DPoP proof replayed.",
        cause: error,
      })
    : new ServerAuthDpopReplayStateRecordError({
        cause: error,
      });

export const verifyRequestDpopProof = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly expectedThumbprint?: string;
  readonly expectedAccessToken?: string;
}) =>
  Effect.gen(function* () {
    const proof = input.request.headers.dpop;
    const url = HttpServerRequest.toURL(input.request);
    if (Option.isNone(url)) {
      return yield* new ServerAuthInvalidCredentialError({
        diagnostic: "Invalid DPoP request URL.",
      });
    }
    const now = yield* DateTime.now;
    const result = verifyDpopProof({
      proof,
      method: input.request.method,
      url: url.value.href,
      nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
      ...(input.expectedThumbprint ? { expectedThumbprint: input.expectedThumbprint } : {}),
      ...(input.expectedAccessToken ? { expectedAccessToken: input.expectedAccessToken } : {}),
    });
    if (!result.ok) {
      return yield* new ServerAuthInvalidCredentialError({
        diagnostic: result.reason,
      });
    }
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const replayKey = yield* Crypto.Crypto.pipe(
      Effect.flatMap((crypto) =>
        crypto.digest("SHA-256", new TextEncoder().encode(`${result.thumbprint}:${result.jti}`)),
      ),
      Effect.map(Encoding.encodeBase64Url),
      Effect.mapError(
        (cause) =>
          new ServerAuthDpopReplayKeyCalculationError({
            cause,
          }),
      ),
    );
    const secretName = `dpop-proof-${replayKey}`;
    // Recording and scheduling expiry are one uninterruptible commit. Once a
    // valid proof's jti has been seen it remains single-use for the complete
    // acceptance window, even when the protected operation later fails.
    yield* Effect.uninterruptible(
      secretStore
        .create(
          secretName,
          new TextEncoder().encode(
            [
              `thumbprint=${result.thumbprint}`,
              `jti=${result.jti}`,
              `iat=${result.iat}`,
              `consumedAt=${DateTime.formatIso(now)}`,
            ].join("\n"),
          ),
        )
        .pipe(
          Effect.catchIf(ServerSecretStore.isSecretStoreError, (error) =>
            Effect.fail(mapDpopReplayStoreError(error)),
          ),
          Effect.tap(() => scheduleDpopReplayStateRemoval(secretStore, secretName)),
        ),
    );
    return result.thumbprint;
  });
