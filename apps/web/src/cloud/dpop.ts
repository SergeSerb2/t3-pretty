import {
  computeDpopAccessTokenHash,
  computeDpopJwkThumbprint,
  DpopPublicJwk,
  normalizeDpopPublicJwk,
  padP256Coordinate,
} from "@t3tools/shared/dpop";
import {
  DPOP_ACCESS_TOKEN_MAX_LENGTH,
  DPOP_JWK_COORDINATE_MAX_LENGTH,
  DPOP_METHOD_MAX_LENGTH,
  normalizeDpopHtu,
} from "@t3tools/shared/dpopCommon";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { importJWK, SignJWT, type JWK } from "jose";

const StoredDpopPrivateJwk = Schema.Struct({
  ...DpopPublicJwk.fields,
  d: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(DPOP_JWK_COORDINATE_MAX_LENGTH)),
});
type StoredDpopPrivateJwk = typeof StoredDpopPrivateJwk.Type;
const StoredDpopKeyV2 = Schema.Struct({
  version: Schema.Literal(2),
  privateJwk: StoredDpopPrivateJwk,
  publicJwk: DpopPublicJwk,
});
const decodeStoredDpopKeyV2 = Schema.decodeUnknownOption(StoredDpopKeyV2);
const decodeDpopPublicJwk = Schema.decodeUnknownEffect(DpopPublicJwk);

export interface BrowserDpopKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: DpopPublicJwk;
  readonly thumbprint: string;
  readonly privateJwk: StoredDpopPrivateJwk;
}

export class BrowserDpopError extends Data.TaggedError("BrowserDpopError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const DPOP_DATABASE_NAME = "t3code:cloud-auth";
const DPOP_DATABASE_VERSION = 1;
const DPOP_KEY_STORE_NAME = "keys";
const DPOP_KEY_ID = "relay-dpop-proof-key";

function normalizeDpopPrivateJwk(
  jwk: typeof StoredDpopPrivateJwk.Type,
  publicJwk: DpopPublicJwk,
): typeof StoredDpopPrivateJwk.Type {
  const d = Result.getOrThrow(Encoding.decodeBase64Url(jwk.d));
  return {
    ...publicJwk,
    d: Encoding.encodeBase64Url(padP256Coordinate(d)),
  };
}

export const browserCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => {
        const input = new Uint8Array(data.length);
        input.set(data);
        return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, input.buffer));
      }),
  }),
);

function dpopError(message: string, cause?: unknown) {
  return new BrowserDpopError({ message, ...(cause === undefined ? {} : { cause }) });
}

function openDpopDatabase(): Effect.Effect<IDBDatabase, BrowserDpopError> {
  return Effect.callback<IDBDatabase, BrowserDpopError>((resume) => {
    let settled = false;
    const settle = (effect: Effect.Effect<IDBDatabase, BrowserDpopError>) => {
      if (settled) return false;
      settled = true;
      resume(effect);
      return true;
    };
    try {
      const request = indexedDB.open(DPOP_DATABASE_NAME, DPOP_DATABASE_VERSION);
      request.addEventListener("error", () => {
        settle(
          Effect.fail(dpopError("Could not open DPoP key storage.", request.error ?? undefined)),
        );
      });
      request.addEventListener("blocked", () => {
        settle(
          Effect.fail(
            dpopError(
              "Could not open DPoP key storage because another tab is blocking its upgrade.",
            ),
          ),
        );
      });
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(DPOP_KEY_STORE_NAME)) {
          request.result.createObjectStore(DPOP_KEY_STORE_NAME);
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        if (!settle(Effect.succeed(database))) {
          database.close();
          return;
        }
        database.addEventListener("versionchange", () => database.close(), { once: true });
      });
    } catch (cause) {
      settle(Effect.fail(dpopError("Could not open DPoP key storage.", cause)));
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      // IDBOpenDBRequest cannot be aborted. Its success handler sees this
      // settled flag and closes the database if it opens after interruption.
    });
  });
}

export function readStoredBrowserDpopKey(): Effect.Effect<BrowserDpopKey | null, BrowserDpopError> {
  if (typeof indexedDB === "undefined") {
    return Effect.succeed(null);
  }
  return Effect.acquireUseRelease(
    openDpopDatabase(),
    (database) =>
      Effect.callback<BrowserDpopKey | null, BrowserDpopError>((resume) => {
        let settled = false;
        let transaction: IDBTransaction | null = null;
        const settle = (effect: Effect.Effect<BrowserDpopKey | null, BrowserDpopError>) => {
          if (settled) return;
          settled = true;
          resume(effect);
        };
        try {
          const activeTransaction = database.transaction(DPOP_KEY_STORE_NAME, "readonly");
          transaction = activeTransaction;
          const request = activeTransaction.objectStore(DPOP_KEY_STORE_NAME).get(DPOP_KEY_ID);
          let result: unknown;
          let requestSucceeded = false;
          request.addEventListener("success", () => {
            result = request.result;
            requestSucceeded = true;
          });
          request.addEventListener("error", () => {
            settle(Effect.fail(dpopError("Could not read DPoP key.", request.error ?? undefined)));
          });
          activeTransaction.addEventListener("error", () => {
            settle(
              Effect.fail(
                dpopError("Could not read DPoP key.", activeTransaction.error ?? undefined),
              ),
            );
          });
          activeTransaction.addEventListener("abort", () => {
            settle(
              Effect.fail(
                dpopError(
                  "Could not read DPoP key because its transaction was aborted.",
                  activeTransaction.error ?? undefined,
                ),
              ),
            );
          });
          activeTransaction.addEventListener("complete", () => {
            settle(
              requestSucceeded
                ? hydrateStoredBrowserDpopKey(result)
                : Effect.fail(dpopError("DPoP key read completed without a result.")),
            );
          });
        } catch (cause) {
          settle(Effect.fail(dpopError("Could not read DPoP key.", cause)));
        }
        return Effect.sync(() => {
          if (settled) return;
          settled = true;
          try {
            transaction?.abort();
          } catch {
            // A transaction can finish between interruption and cleanup.
          }
        });
      }),
    (database) => Effect.sync(() => database.close()),
  );
}

export function writeStoredBrowserDpopKey(
  key: BrowserDpopKey,
): Effect.Effect<void, BrowserDpopError> {
  if (typeof indexedDB === "undefined") {
    return Effect.void;
  }
  return Effect.acquireUseRelease(
    openDpopDatabase(),
    (database) =>
      Effect.callback<void, BrowserDpopError>((resume) => {
        let settled = false;
        let transaction: IDBTransaction | null = null;
        const settle = (effect: Effect.Effect<void, BrowserDpopError>) => {
          if (settled) return;
          settled = true;
          resume(effect);
        };
        try {
          const activeTransaction = database.transaction(DPOP_KEY_STORE_NAME, "readwrite");
          transaction = activeTransaction;
          activeTransaction.addEventListener("error", () => {
            settle(
              Effect.fail(
                dpopError("Could not write DPoP key.", activeTransaction.error ?? undefined),
              ),
            );
          });
          activeTransaction.addEventListener("abort", () => {
            settle(
              Effect.fail(
                dpopError(
                  "Could not write DPoP key because its transaction was aborted.",
                  activeTransaction.error ?? undefined,
                ),
              ),
            );
          });
          activeTransaction.addEventListener("complete", () => settle(Effect.void));
          const request = activeTransaction.objectStore(DPOP_KEY_STORE_NAME).put(
            {
              version: 2,
              privateJwk: key.privateJwk,
              publicJwk: key.publicJwk,
            } satisfies typeof StoredDpopKeyV2.Type,
            DPOP_KEY_ID,
          );
          request.addEventListener("error", () => {
            settle(Effect.fail(dpopError("Could not write DPoP key.", request.error ?? undefined)));
          });
        } catch (cause) {
          settle(Effect.fail(dpopError("Could not write DPoP key.", cause)));
        }
        return Effect.sync(() => {
          if (settled) return;
          settled = true;
          try {
            transaction?.abort();
          } catch {
            // A transaction can finish between interruption and cleanup.
          }
        });
      }),
    (database) => Effect.sync(() => database.close()),
  );
}

function hydrateStoredBrowserDpopKey(
  value: unknown,
): Effect.Effect<BrowserDpopKey | null, BrowserDpopError> {
  const stored = decodeStoredDpopKeyV2(value);
  if (Option.isNone(stored)) {
    return Effect.succeed(null);
  }
  return importBrowserDpopKey(stored.value.privateJwk, stored.value.publicJwk);
}

function importBrowserDpopKey(
  rawPrivateJwk: StoredDpopPrivateJwk,
  rawPublicJwk: DpopPublicJwk,
): Effect.Effect<BrowserDpopKey, BrowserDpopError> {
  return Effect.gen(function* () {
    const publicJwk = yield* Effect.try({
      try: () => normalizeDpopPublicJwk(rawPublicJwk),
      catch: (cause) => dpopError("Stored DPoP public key is invalid.", cause),
    });
    const privateJwk = yield* Effect.try({
      try: () => normalizeDpopPrivateJwk(rawPrivateJwk, publicJwk),
      catch: (cause) => dpopError("Stored DPoP private key is invalid.", cause),
    });
    const privateKey = yield* Effect.tryPromise({
      try: () =>
        importJWK(privateJwk as JWK, "ES256", { extractable: false }) as Promise<CryptoKey>,
      catch: (cause) => dpopError("Could not import DPoP private key.", cause),
    });
    return {
      privateKey,
      publicJwk,
      privateJwk,
      thumbprint: computeDpopJwkThumbprint(publicJwk),
    };
  });
}

export const generateBrowserDpopKey = Effect.gen(function* () {
  const generated = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ]) as Promise<CryptoKeyPair>,
    catch: (cause) => dpopError("Could not generate DPoP proof key.", cause),
  });
  const privateJwk = yield* Effect.tryPromise({
    try: () => crypto.subtle.exportKey("jwk", generated.privateKey),
    catch: (cause) => dpopError("Could not export DPoP private key.", cause),
  });
  const publicJwk = yield* Effect.tryPromise({
    try: () => crypto.subtle.exportKey("jwk", generated.publicKey),
    catch: (cause) => dpopError("Could not export DPoP public key.", cause),
  }).pipe(
    Effect.flatMap((jwk) => decodeDpopPublicJwk(jwk)),
    Effect.mapError((cause) =>
      cause instanceof BrowserDpopError
        ? cause
        : dpopError("Generated DPoP public key is invalid.", cause),
    ),
  );
  if (typeof privateJwk.d !== "string" || privateJwk.d.length === 0) {
    return yield* Effect.fail(dpopError("Generated DPoP private key is missing material."));
  }
  return yield* importBrowserDpopKey({ ...publicJwk, d: privateJwk.d }, publicJwk);
});

export function createBrowserDpopProof(input: {
  readonly method: string;
  readonly url: string;
  readonly accessToken?: string;
  readonly proofKey: BrowserDpopKey;
}): Effect.Effect<
  { readonly proof: string; readonly thumbprint: string },
  BrowserDpopError,
  Crypto.Crypto
> {
  return Effect.gen(function* () {
    if (input.method.length === 0 || input.method.length > DPOP_METHOD_MAX_LENGTH) {
      return yield* Effect.fail(dpopError("DPoP proof method is invalid."));
    }
    const normalizedUrl = normalizeDpopHtu(input.url);
    if (normalizedUrl === null) {
      return yield* Effect.fail(dpopError("Could not normalize DPoP proof URL."));
    }
    if (input.accessToken && input.accessToken.length > DPOP_ACCESS_TOKEN_MAX_LENGTH) {
      return yield* Effect.fail(dpopError("DPoP access token is invalid."));
    }
    const jti = yield* Crypto.Crypto.pipe(
      Effect.flatMap((crypto) => crypto.randomUUIDv4),
      Effect.mapError((cause) => dpopError("Could not generate DPoP proof identifier.", cause)),
    );
    const proof = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({
          htm: input.method.toUpperCase(),
          htu: normalizedUrl,
          jti,
          ...(input.accessToken ? { ath: computeDpopAccessTokenHash(input.accessToken) } : {}),
        })
          .setProtectedHeader({
            typ: "dpop+jwt",
            alg: "ES256",
            jwk: input.proofKey.publicJwk,
          })
          .setIssuedAt()
          .sign(input.proofKey.privateKey),
      catch: (cause) => dpopError("Could not sign DPoP proof.", cause),
    });
    return { proof, thumbprint: input.proofKey.thumbprint };
  });
}
