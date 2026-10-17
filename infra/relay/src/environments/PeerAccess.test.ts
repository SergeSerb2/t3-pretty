// @effect-diagnostics nodeBuiltinImport:off -- The fixture needs an Ed25519 key pair.
import * as NodeCrypto from "node:crypto";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  REMOTE_CONTEXT_PROOF_TYP,
  RemoteContextProof,
  ThreadId,
} from "@t3tools/contracts";
import {
  RelayCloudEnvironmentHealthRequest,
  RelayCloudEnvironmentHealthProofPayload,
  type RelayEnvironmentHealthResponseProofPayload,
} from "@t3tools/contracts/relay";
import {
  RELAY_HEALTH_REQUEST_TYP,
  RELAY_HEALTH_RESPONSE_TYP,
  signRelayJwt,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpClientError from "effect/http/HttpClientError";

import * as Configuration from "../Config.ts";
import * as Links from "./EnvironmentLinks.ts";
import * as Allocations from "./ManagedEndpointAllocations.ts";
import * as PeerAccess from "./PeerAccess.ts";
import * as Connector from "./EnvironmentConnector.ts";

const keys = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const principal = { environmentId: "source", environmentPublicKey: "source-key" };
const decodeHealthRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RelayCloudEnvironmentHealthRequest),
);
const link = (environmentId: string): Links.RelayLinkedEnvironmentRecord => ({
  environmentId: EnvironmentId.make(environmentId),
  label: environmentId,
  endpoint: {
    httpBaseUrl: "https://destination.example.test/",
    wsBaseUrl: "wss://destination.example.test/ws",
    providerKind: "cloudflare_tunnel",
  },
  environmentPublicKey: keys.publicKey,
  linkedAt: "2026-01-01T00:00:00.000Z",
});
const input = {
  environmentId: EnvironmentId.make("destination"),
  sourceThreadId: ThreadId.make("source-thread"),
  digest: "1".repeat(64),
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

function fixture(
  options: {
    missingSource?: boolean;
    missingDestination?: boolean;
    mismatchedAllocation?: boolean;
    staleFirstAccount?: boolean;
    missingFirstAllocation?: boolean;
    allocationLookupFails?: boolean;
    previousAccount?: boolean;
    offline?: boolean;
    firstHealthFailure?: "invalid-response" | "server-error" | "transport";
    invalidHealthResponse?: boolean;
  } = {},
) {
  const seen: unknown[] = [];
  const healthSubjects: string[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(Links.EnvironmentLinks)({
      findActiveManagedForEnvironment: (request) =>
        Effect.sync(() => {
          seen.push(request);
          return options.missingSource
            ? []
            : [
                ...(options.staleFirstAccount ||
                options.missingFirstAllocation ||
                options.previousAccount
                  ? [
                      {
                        ...link("source"),
                        userId: "stale-owner",
                        holdWebhooksWhileOffline: false,
                      },
                    ]
                  : []),
                { ...link("source"), userId: "owner", holdWebhooksWhileOffline: false },
              ];
        }),
      listForUser: ({ userId }) =>
        Effect.sync(() => {
          expect(userId).toBe("owner");
          return [link("source"), link("destination"), link("destination")];
        }),
      getForUser: (request) =>
        Effect.sync(() => {
          seen.push(request);
          return options.missingDestination ? null : link(request.environmentId);
        }),
    }),
    Layer.mock(Allocations.ManagedEndpointAllocations)({
      get: ({ userId }) =>
        options.allocationLookupFails
          ? Effect.fail(
              new Allocations.ManagedEndpointAllocationPersistenceError({
                operation: "get",
                stage: "database-request",
                userId,
                environmentId: "destination",
                cause: new Error("Database unavailable"),
              }),
            )
          : Effect.succeed(
              options.missingFirstAllocation && userId === "stale-owner"
                ? null
                : {
                    userId,
                    environmentId: "destination",
                    hostname:
                      options.mismatchedAllocation ||
                      (options.staleFirstAccount && userId === "stale-owner")
                        ? "wrong.example.test"
                        : "destination.example.test",
                    tunnelId: "tunnel",
                    tunnelName: "tunnel-name",
                    dnsRecordId: "dns",
                    readyAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
                    generation: 1,
                    tunnelReleasedAt: null,
                  },
            ),
    }),
    Layer.mock(Configuration.RelayConfiguration)({
      relayIssuer: "https://relay.test",
      cloudMintPrivateKey: Redacted.make(keys.privateKey),
      cloudMintPublicKey: keys.publicKey,
      managedEndpointBaseDomain: "example.test",
      managedEndpointNamespace: undefined,
      apns: {
        environment: "sandbox",
        teamId: "team",
        keyId: "key",
        privateKey: Redacted.make("key"),
        bundleId: "test",
      },
      apnsDeliveryJobSigningSecret: Redacted.make("secret"),
      clerkSecretKey: Redacted.make("secret"),
      clerkPublishableKey: "pk_test",
      clerkJwtAudience: "relay",
    }),
    NodeCryptoLayer.layer,
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.gen(function* () {
          if (request.body._tag !== "Uint8Array") throw new Error("Expected a health request body");
          const { proof } = yield* decodeHealthRequest(
            new TextDecoder().decode(request.body.body),
          ).pipe(Effect.orDie);
          const claims = yield* verifyRelayJwt({
            token: proof,
            publicKey: keys.publicKey,
            typ: RELAY_HEALTH_REQUEST_TYP,
            issuer: "https://relay.test",
            audience: "t3-env:destination",
            nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(RelayCloudEnvironmentHealthProofPayload)),
            Effect.orDie,
          );
          healthSubjects.push(claims.sub);
          const failure = claims.sub === "stale-owner" ? options.firstHealthFailure : undefined;
          if (failure === "transport")
            return yield* new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: new Error("Connection failed"),
              }),
            });
          if (failure === "server-error")
            return HttpClientResponse.fromWeb(request, new Response("", { status: 503 }));
          if ((claims.sub !== "owner" && failure !== "invalid-response") || options.offline) {
            return HttpClientResponse.fromWeb(request, new Response("", { status: 403 }));
          }
          const payload = {
            iss: "t3-env:destination",
            aud: "https://relay.test",
            sub: "destination",
            jti: "health-response",
            iat: claims.iat,
            exp: claims.exp,
            environmentId: EnvironmentId.make("destination"),
            requestNonce:
              failure === "invalid-response" || options.invalidHealthResponse
                ? "wrong-nonce"
                : claims.nonce,
            status: "online",
            descriptor: {
              environmentId: EnvironmentId.make("destination"),
              label: "Destination",
              platform: { os: "darwin", arch: "arm64" },
              serverVersion: "test",
              capabilities: { repositoryIdentity: true },
            },
            checkedAt: DateTime.formatIso(DateTime.makeUnsafe(claims.iat * 1000)),
          } satisfies RelayEnvironmentHealthResponseProofPayload;
          const responseProof = yield* signRelayJwt({
            privateKey: keys.privateKey,
            typ: RELAY_HEALTH_RESPONSE_TYP,
            payload,
          }).pipe(Effect.orDie);
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              environmentId: payload.environmentId,
              status: payload.status,
              descriptor: payload.descriptor,
              checkedAt: payload.checkedAt,
              proof: responseProof,
            }),
          );
        }),
      ),
    ),
  );
  const layer = PeerAccess.layer.pipe(
    Layer.provide(Connector.layer.pipe(Layer.provideMerge(dependencies))),
  );
  return { layer, seen, healthSubjects };
}

it.effect(
  "lists only peers of accounts linked to the authenticated source key and deduplicates them",
  () => {
    const h = fixture();
    return Effect.gen(function* () {
      const service = yield* PeerAccess.PeerAccess;
      expect(yield* service.list(principal)).toEqual({
        environments: [{ environmentId: "destination", label: "destination" }],
      });
      expect(h.seen[0]).toEqual(principal);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("skips a missing first allocation and authorizes the next account", () => {
  const h = fixture({ missingFirstAllocation: true });
  return Effect.gen(function* () {
    const ticket = yield* (yield* PeerAccess.PeerAccess).authorize(principal, input);
    expect(ticket.httpBaseUrl).toBe("https://destination.example.test/");
    expect(h.seen).toEqual([
      principal,
      { userId: "stale-owner", environmentId: "destination" },
      { userId: "owner", environmentId: "destination" },
    ]);
  }).pipe(Effect.provide(h.layer));
});

it.effect("reports an allocation database failure as unavailable", () =>
  Effect.gen(function* () {
    const error = yield* (yield* PeerAccess.PeerAccess)
      .authorize(principal, input)
      .pipe(Effect.flip);
    expect(error).toMatchObject({
      _tag: "PeerAccessUnavailable",
      cause: { _tag: "ManagedEndpointAllocationPersistenceError", stage: "database-request" },
    });
  }).pipe(Effect.provide(fixture({ allocationLookupFails: true }).layer)),
);

it.effect(
  "skips a valid old allocation when the destination no longer accepts that account",
  () => {
    const h = fixture({ previousAccount: true });
    return Effect.gen(function* () {
      const ticket = yield* (yield* PeerAccess.PeerAccess).authorize(principal, input);
      const proof = yield* verifyRelayJwt({
        token: ticket.proof,
        publicKey: keys.publicKey,
        typ: REMOTE_CONTEXT_PROOF_TYP,
        issuer: "https://relay.test",
        audience: "t3-env:destination",
        nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RemoteContextProof)));
      expect(h.healthSubjects).toEqual(["stale-owner", "owner"]);
      expect(proof.sub).toBe("owner");
      expect(ticket.httpBaseUrl).toBe("https://destination.example.test/");
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect(
  "reports unavailable when no candidate destination passes its signed health check",
  () => {
    const h = fixture({ offline: true });
    return Effect.gen(function* () {
      const error = yield* (yield* PeerAccess.PeerAccess)
        .authorize(principal, input)
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PeerAccessUnavailable", cause: { status: "offline" } });
      expect(h.healthSubjects).toEqual(["owner"]);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect.each(["invalid-response", "server-error", "transport"] as const)(
  "tries the next account after an earlier health check fails with %s",
  (firstHealthFailure) => {
    const h = fixture({ previousAccount: true, firstHealthFailure });
    return Effect.gen(function* () {
      const ticket = yield* (yield* PeerAccess.PeerAccess).authorize(principal, input);
      const proof = yield* verifyRelayJwt({
        token: ticket.proof,
        publicKey: keys.publicKey,
        typ: REMOTE_CONTEXT_PROOF_TYP,
        issuer: "https://relay.test",
        audience: "t3-env:destination",
        nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RemoteContextProof)));
      expect(proof.sub).toBe("owner");
      expect(h.healthSubjects).toEqual(["stale-owner", "owner"]);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("preserves the connector error when no later account succeeds", () => {
  const h = fixture({ invalidHealthResponse: true });
  return Effect.gen(function* () {
    const error = yield* (yield* PeerAccess.PeerAccess)
      .authorize(principal, input)
      .pipe(Effect.flip);
    expect(error).toMatchObject({
      _tag: "PeerAccessUnavailable",
      cause: { _tag: "EnvironmentMintResponseInvalid" },
    });
    expect(h.healthSubjects).toEqual(["owner"]);
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "issues a two-minute proof bound to the exact source, destination, account, modes, and payload digest",
  () => {
    const h = fixture();
    return Effect.gen(function* () {
      const service = yield* PeerAccess.PeerAccess;
      const ticket = yield* service.authorize(principal, input);
      const proof = yield* verifyRelayJwt({
        token: ticket.proof,
        publicKey: keys.publicKey,
        typ: REMOTE_CONTEXT_PROOF_TYP,
        issuer: "https://relay.test",
        audience: "t3-env:destination",
        nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RemoteContextProof)));
      expect(proof).toMatchObject({ ...input, sourceEnvironmentId: "source", sub: "owner" });
      expect(proof.exp - proof.iat).toBe(120);
      expect(h.seen).toContainEqual({ userId: "owner", environmentId: "destination" });
      expect(ticket.httpBaseUrl).toBe("https://destination.example.test/");
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect.each([
  { missingSource: true },
  { missingDestination: true },
  { mismatchedAllocation: true },
])(
  "refuses an unlinked source, a destination outside its account, or a mismatched managed endpoint: %j",
  (options) =>
    Effect.gen(function* () {
      const service = yield* PeerAccess.PeerAccess;
      expect((yield* service.authorize(principal, input).pipe(Effect.flip))._tag).toBe(
        "PeerAccessDenied",
      );
    }).pipe(Effect.provide(fixture(options).layer)),
);

it.effect(
  "skips an invalid earlier account allocation and authorizes a later valid account",
  () => {
    const h = fixture({ staleFirstAccount: true });
    return Effect.gen(function* () {
      const ticket = yield* (yield* PeerAccess.PeerAccess).authorize(principal, input);
      const proof = yield* verifyRelayJwt({
        token: ticket.proof,
        publicKey: keys.publicKey,
        typ: REMOTE_CONTEXT_PROOF_TYP,
        issuer: "https://relay.test",
        audience: "t3-env:destination",
        nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RemoteContextProof)));
      expect(proof.sub).toBe("owner");
      expect(h.seen).toEqual([
        principal,
        { userId: "stale-owner", environmentId: "destination" },
        { userId: "owner", environmentId: "destination" },
      ]);
    }).pipe(Effect.provide(h.layer));
  },
);
