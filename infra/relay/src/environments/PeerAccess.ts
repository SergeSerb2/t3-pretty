import {
  EnvironmentId,
  REMOTE_CONTEXT_PROOF_TYP,
  type RemoteContextAuthorization,
} from "@t3tools/contracts";
import type { RelayEnvironmentPrincipal } from "@t3tools/contracts/relay";
import { normalizeRelayIssuer, signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as Configuration from "../Config.ts";
import * as Links from "./EnvironmentLinks.ts";
import * as Connector from "./EnvironmentConnector.ts";

type Principal = RelayEnvironmentPrincipal["Service"];
export class PeerAccessDenied extends Schema.TaggedError<PeerAccessDenied>()(
  "PeerAccessDenied",
  {},
) {
  override get message(): string {
    return "The environments do not share an authorized Connect account and managed endpoint.";
  }
}
export class PeerAccessUnavailable extends Schema.TaggedError<PeerAccessUnavailable>()(
  "PeerAccessUnavailable",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Connect could not authorize the peer request.";
  }
}

export class PeerAccess extends Context.Service<
  PeerAccess,
  {
    readonly list: (
      principal: Principal,
    ) => Effect.Effect<
      { environments: ReadonlyArray<{ environmentId: EnvironmentId; label: string }> },
      PeerAccessDenied | PeerAccessUnavailable
    >;
    readonly authorize: (
      principal: Principal,
      input: RemoteContextAuthorization,
    ) => Effect.Effect<
      { httpBaseUrl: string; proof: string },
      PeerAccessDenied | PeerAccessUnavailable
    >;
  }
>()("t3code-relay/environments/PeerAccess") {}

const make = Effect.gen(function* () {
  const links = yield* Links.EnvironmentLinks;
  const connector = yield* Connector.EnvironmentConnector;
  const config = yield* Configuration.RelayConfiguration;
  const crypto = yield* Crypto.Crypto;
  const sourceLinks = (principal: Principal) =>
    links.findActiveManagedForEnvironment(principal).pipe(
      Effect.mapError((cause) => new PeerAccessUnavailable({ cause })),
      Effect.filterOrFail(
        (rows) => rows.length > 0,
        () => new PeerAccessDenied({}),
      ),
    );

  return PeerAccess.of({
    list: Effect.fn("PeerAccess.list")(function* (principal) {
      const peers = new Map<string, { environmentId: EnvironmentId; label: string }>();
      for (const source of yield* sourceLinks(principal)) {
        for (const peer of yield* links
          .listForUser({ userId: source.userId })
          .pipe(Effect.mapError((cause) => new PeerAccessUnavailable({ cause })))) {
          if (
            peer.environmentId !== principal.environmentId &&
            peer.endpoint.providerKind === "cloudflare_tunnel"
          ) {
            peers.set(peer.environmentId, {
              environmentId: EnvironmentId.make(peer.environmentId),
              label: peer.label,
            });
          }
        }
      }
      return { environments: [...peers.values()].slice(0, 1024) };
    }),
    authorize: Effect.fn("PeerAccess.authorize")(function* (principal, input) {
      if (input.environmentId === principal.environmentId) return yield* new PeerAccessDenied({});
      let unavailableFailure: PeerAccessUnavailable | undefined;
      const skipUnavailable = (cause: Connector.EnvironmentConnectorError) =>
        Effect.sync(() => {
          unavailableFailure = new PeerAccessUnavailable({ cause });
          return null;
        });
      for (const source of yield* sourceLinks(principal)) {
        const key = { userId: source.userId, environmentId: input.environmentId };
        // A database link can outlive the destination's active cloud account.
        // Its signed health response confirms that this account is still accepted.
        const status = yield* connector.status(key).pipe(
          Effect.catchTags({
            EnvironmentConnectNotAuthorized: () => Effect.succeed(null),
            EnvironmentMintRequestFailed: skipUnavailable,
            EnvironmentMintRequestTimedOut: skipUnavailable,
            EnvironmentMintResponseInvalid: skipUnavailable,
          }),
          Effect.mapError((cause) => new PeerAccessUnavailable({ cause })),
        );
        if (status === null) continue;
        if (status.status !== "online") {
          unavailableFailure = new PeerAccessUnavailable({ cause: status });
          continue;
        }
        const now = Math.floor((yield* DateTime.now).epochMilliseconds / 1000);
        const proof = yield* signRelayJwt({
          privateKey: Redacted.value(config.cloudMintPrivateKey),
          typ: REMOTE_CONTEXT_PROOF_TYP,
          payload: {
            ...input,
            sourceEnvironmentId: principal.environmentId,
            iss: normalizeRelayIssuer(config.relayIssuer),
            aud: `t3-env:${input.environmentId}`,
            sub: source.userId,
            jti: yield* crypto
              .randomUUIDv4()
              .pipe(Effect.mapError((cause) => new PeerAccessUnavailable({ cause }))),
            iat: now,
            exp: now + 120,
          },
        }).pipe(Effect.mapError((cause) => new PeerAccessUnavailable({ cause })));
        return { httpBaseUrl: status.endpoint.httpBaseUrl, proof };
      }
      if (unavailableFailure) return yield* unavailableFailure;
      return yield* new PeerAccessDenied({});
    }),
  });
});

export const layer = Layer.effect(PeerAccess, make);
