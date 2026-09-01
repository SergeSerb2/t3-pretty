import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpApiError from "effect/unstable/httpapi/HttpApiError";
import { sha256 } from "@noble/hashes/sha2";
import { lt } from "drizzle-orm";

import { DpopVerificationFailureCode, verifyDpopProof } from "@t3tools/shared/dpop";
import * as RelayDb from "../db.ts";
import { relayDpopProofs } from "../persistence/schema.ts";

const RELAY_DPOP_THUMBPRINT_MAX_LENGTH = 128;
const RELAY_DPOP_JTI_MAX_LENGTH = 255;

function persistedReplayKey(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `sha256:${Encoding.encodeBase64Url(sha256(new TextEncoder().encode(value)))}`;
}

export class DpopProofReplayPersistenceError extends Schema.TaggedErrorClass<DpopProofReplayPersistenceError>()(
  "DpopProofReplayPersistenceError",
  {
    operation: Schema.Literals(["consume", "prune-expired"]),
    thumbprint: Schema.optionalKey(Schema.String),
    jti: Schema.optionalKey(Schema.String),
    iat: Schema.optionalKey(Schema.Number),
    expiresBefore: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to persist DPoP proof replay state during '${this.operation}'`;
  }
}

export const DpopProofFailureCode = Schema.Union([
  DpopVerificationFailureCode,
  Schema.Literal("replayed"),
]);
export type DpopProofFailureCode = typeof DpopProofFailureCode.Type;

export class DpopProofRejected extends Schema.TaggedErrorClass<DpopProofRejected>()(
  "DpopProofRejected",
  {
    code: DpopProofFailureCode,
  },
) {
  override get message(): string {
    return `DPoP proof rejected: ${this.code}`;
  }
}

export class DpopProofReplay extends Context.Service<
  DpopProofReplay,
  {
    /** Verify a sender-bound proof without recording its jti. Only safe for read-only cache hits. */
    readonly verify: (input: {
      readonly proof: string | undefined;
      readonly method: string;
      readonly url: string;
      readonly expectedThumbprint?: string;
      readonly expectedAccessToken?: string;
      readonly now: DateTime.DateTime;
    }) => Effect.Effect<string, HttpApiError.Unauthorized>;
    readonly verifyAndConsume: (input: {
      readonly proof: string | undefined;
      readonly method: string;
      readonly url: string;
      readonly expectedThumbprint?: string;
      readonly expectedAccessToken?: string;
      readonly now: DateTime.DateTime;
    }) => Effect.Effect<string, DpopProofRejected | DpopProofReplayPersistenceError>;
    readonly consume: (input: {
      readonly thumbprint: string;
      readonly jti: string;
      readonly iat: number;
      readonly expiresAt: DateTime.DateTime;
    }) => Effect.Effect<boolean, DpopProofReplayPersistenceError>;
    readonly pruneExpired: Effect.Effect<void, DpopProofReplayPersistenceError>;
  }
>()("t3code-relay/auth/DpopProofs/DpopProofReplay") {}

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  const consume: DpopProofReplay["Service"]["consume"] = Effect.fn("relay.dpop_proofs.consume")(
    function* (input) {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const thumbprint = persistedReplayKey(input.thumbprint, RELAY_DPOP_THUMBPRINT_MAX_LENGTH);
      const jti = persistedReplayKey(input.jti, RELAY_DPOP_JTI_MAX_LENGTH);
      const inserted = yield* db
        .insert(relayDpopProofs)
        .values({
          thumbprint,
          jti,
          iat: input.iat,
          expiresAt: DateTime.formatIso(input.expiresAt),
          createdAt,
        })
        .onConflictDoNothing()
        .returning({ jti: relayDpopProofs.jti })
        .pipe(
          Effect.mapError(
            (cause) =>
              new DpopProofReplayPersistenceError({
                operation: "consume",
                thumbprint,
                jti,
                iat: input.iat,
                cause,
              }),
          ),
        );
      return inserted.length > 0;
    },
  );

  const verify = Effect.fn("relay.dpop_proofs.verify")(function* (
    input: Parameters<DpopProofReplay["Service"]["verify"]>[0],
  ) {
    yield* Effect.annotateCurrentSpan({
      "relay.dpop.method": input.method,
      "relay.dpop.expected_thumbprint_present": input.expectedThumbprint !== undefined,
      "relay.dpop.expected_access_token_present": input.expectedAccessToken !== undefined,
    });
    const result = verifyDpopProof({
      proof: input.proof,
      method: input.method,
      url: input.url,
      nowEpochSeconds: Math.floor(input.now.epochMilliseconds / 1_000),
      ...(input.expectedThumbprint ? { expectedThumbprint: input.expectedThumbprint } : {}),
      ...(input.expectedAccessToken ? { expectedAccessToken: input.expectedAccessToken } : {}),
    });
    if (!result.ok) {
      yield* Effect.logWarning("relay dpop proof rejected", {
        code: result.code,
        reason: result.reason,
        method: input.method,
        url: input.url,
        expectedThumbprintPresent: input.expectedThumbprint !== undefined,
        expectedAccessTokenPresent: input.expectedAccessToken !== undefined,
      });
      return yield* new DpopProofRejected({
        code: result.code,
      });
    }
    yield* Effect.annotateCurrentSpan({
      "relay.dpop.thumbprint": result.thumbprint,
      "relay.dpop.iat": result.iat,
    });
    return result;
  });

  const verifyWithoutConsume: DpopProofReplay["Service"]["verify"] = (input) =>
    verify(input).pipe(Effect.map((result) => result.thumbprint));

  const verifyAndConsume: DpopProofReplay["Service"]["verifyAndConsume"] = Effect.fn(
    "relay.dpop_proofs.verify_and_consume",
  )(function* (input) {
    const verified = yield* verify(input);
    const consumed = yield* consume({
      thumbprint: verified.thumbprint,
      jti: verified.jti,
      iat: verified.iat,
      expiresAt: DateTime.add(input.now, { minutes: 5 }),
    });
    if (!consumed) {
      yield* Effect.logWarning("relay dpop proof replay rejected", {
        thumbprint: verified.thumbprint,
        jti: verified.jti,
        iat: verified.iat,
      });
      return yield* new DpopProofRejected({
        code: "replayed",
      });
    }
    return verified.thumbprint;
  });

  const pruneExpired: DpopProofReplay["Service"]["pruneExpired"] = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.annotateCurrentSpan({ "relay.dpop_prune.before": now });
    yield* db
      .delete(relayDpopProofs)
      .where(lt(relayDpopProofs.expiresAt, now))
      .pipe(
        Effect.mapError(
          (cause) =>
            new DpopProofReplayPersistenceError({
              operation: "prune-expired",
              expiresBefore: now,
              cause,
            }),
        ),
      );
  }).pipe(Effect.withSpan("relay.dpop_proofs.prune_expired"));

  return DpopProofReplay.of({
    verify: verifyWithoutConsume,
    verifyAndConsume,
    consume,
    pruneExpired,
  });
});

export const layer = Layer.effect(DpopProofReplay, make);
