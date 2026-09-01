import { verifyDpopProof } from "@t3tools/shared/dpop";
import { DPOP_JWK_COORDINATE_MAX_LENGTH, DPOP_URL_MAX_LENGTH } from "@t3tools/shared/dpopCommon";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { decodeJwt } from "jose";
import { afterEach, vi } from "vite-plus/test";

import {
  type BrowserDpopKey,
  browserCryptoLayer,
  createBrowserDpopProof,
  generateBrowserDpopKey,
  readStoredBrowserDpopKey,
  writeStoredBrowserDpopKey,
} from "./dpop";

function createFakeDpopIndexedDb() {
  let requestResult: unknown;
  const valueRequest = new EventTarget() as IDBRequest;
  Object.defineProperties(valueRequest, {
    error: { get: () => null },
    result: { get: () => requestResult },
  });
  const objectStore = {
    get: vi.fn(() => valueRequest),
    put: vi.fn(() => valueRequest),
  } as unknown as IDBObjectStore;
  const transaction = new EventTarget() as IDBTransaction;
  const abort = vi.fn();
  Object.defineProperties(transaction, {
    abort: { value: abort },
    error: { get: () => null },
    objectStore: { value: () => objectStore },
  });
  const database = new EventTarget() as IDBDatabase;
  const close = vi.fn();
  Object.defineProperties(database, {
    close: { value: close },
    transaction: { value: () => transaction },
  });
  const openRequest = new EventTarget() as IDBOpenDBRequest;
  Object.defineProperties(openRequest, {
    error: { get: () => null },
    result: { get: () => database },
  });
  vi.stubGlobal("indexedDB", { open: vi.fn(() => openRequest) });
  return {
    abort,
    close,
    database,
    openRequest,
    transaction,
    valueRequest,
    setRequestResult: (value: unknown) => {
      requestResult = value;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser DPoP proofs", () => {
  it.effect("signs relay resource proofs with an access-token hash", () =>
    Effect.gen(function* () {
      vi.stubGlobal("indexedDB", undefined);
      const proofKey = yield* generateBrowserDpopKey;
      const proof = yield* createBrowserDpopProof({
        method: "POST",
        url: "https://relay.example.test/v1/environments/env-1/connect?ignored=true",
        accessToken: "relay-access-token",
        proofKey,
      }).pipe(Effect.provide(browserCryptoLayer));
      const issuedAt = decodeJwt(proof.proof).iat;
      expect(issuedAt).toBeTypeOf("number");

      expect(
        verifyDpopProof({
          proof: proof.proof,
          method: "POST",
          url: "https://relay.example.test/v1/environments/env-1/connect",
          expectedThumbprint: proof.thumbprint,
          expectedAccessToken: "relay-access-token",
          nowEpochSeconds: issuedAt!,
        }),
      ).toMatchObject({ ok: true });
      expect(proofKey.privateJwk.d.length).toBeGreaterThan(0);
      expect(proofKey.publicJwk.x.length).toBeGreaterThan(0);
    }),
  );

  it.effect("rejects an oversized proof URL before parsing or signing it", () =>
    createBrowserDpopProof({
      method: "POST",
      url: `https://relay.example.test/${"a".repeat(DPOP_URL_MAX_LENGTH)}`,
      proofKey: {} as BrowserDpopKey,
    }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("normalize"))),
      Effect.provide(browserCryptoLayer),
    ),
  );

  it.effect("fails a blocked database open and closes a late handle", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* readStoredBrowserDpopKey().pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;

      fake.openRequest.dispatchEvent(new Event("blocked"));
      expect(yield* Fiber.join(result)).toEqual(
        expect.objectContaining({
          _tag: "BrowserDpopError",
          message: expect.stringContaining("another tab"),
        }),
      );

      fake.openRequest.dispatchEvent(new Event("success"));
      expect(fake.close).toHaveBeenCalledOnce();
    }),
  );

  it.effect("closes a database that opens after its caller is interrupted", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* readStoredBrowserDpopKey().pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* Fiber.interrupt(result);
      fake.openRequest.dispatchEvent(new Event("success"));

      expect(fake.close).toHaveBeenCalledOnce();
    }),
  );

  it.effect("aborts an active key transaction when its caller is interrupted", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* readStoredBrowserDpopKey().pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      fake.openRequest.dispatchEvent(new Event("success"));
      yield* Effect.yieldNow;

      yield* Fiber.interrupt(result);

      expect(fake.abort).toHaveBeenCalledOnce();
      expect(fake.close).toHaveBeenCalledOnce();
    }),
  );

  it.effect("fails an aborted key read instead of resolving an uncommitted result", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* readStoredBrowserDpopKey().pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;
      fake.openRequest.dispatchEvent(new Event("success"));
      yield* Effect.yieldNow;

      fake.setRequestResult(undefined);
      fake.valueRequest.dispatchEvent(new Event("success"));
      fake.transaction.dispatchEvent(new Event("abort"));

      expect(yield* Fiber.join(result)).toEqual(
        expect.objectContaining({
          _tag: "BrowserDpopError",
          message: expect.stringContaining("transaction was aborted"),
        }),
      );
    }),
  );

  it.effect("rejects an oversized persisted private coordinate before importing it", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* readStoredBrowserDpopKey().pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      fake.openRequest.dispatchEvent(new Event("success"));
      yield* Effect.yieldNow;

      fake.setRequestResult({
        version: 2,
        privateJwk: {
          kty: "EC",
          crv: "P-256",
          x: "AA",
          y: "AA",
          d: "A".repeat(DPOP_JWK_COORDINATE_MAX_LENGTH + 1),
        },
        publicJwk: { kty: "EC", crv: "P-256", x: "AA", y: "AA" },
      });
      fake.valueRequest.dispatchEvent(new Event("success"));
      fake.transaction.dispatchEvent(new Event("complete"));

      expect(yield* Fiber.join(result)).toBeNull();
    }),
  );

  it.effect("fails an aborted key write instead of leaving it pending", () =>
    Effect.gen(function* () {
      const fake = createFakeDpopIndexedDb();
      const result = yield* writeStoredBrowserDpopKey({} as BrowserDpopKey).pipe(
        Effect.flip,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      fake.openRequest.dispatchEvent(new Event("success"));
      yield* Effect.yieldNow;

      fake.transaction.dispatchEvent(new Event("abort"));

      expect(yield* Fiber.join(result)).toEqual(
        expect.objectContaining({
          _tag: "BrowserDpopError",
          message: expect.stringContaining("transaction was aborted"),
        }),
      );
    }),
  );
});
