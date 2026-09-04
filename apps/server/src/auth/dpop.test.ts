import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "./ServerSecretStore.ts";
import {
  DPOP_REPLAY_RETENTION,
  mapDpopFailureReason,
  mapDpopReplayStoreError,
  scheduleDpopReplayStateRemoval,
} from "./dpop.ts";

const storeFailure = (tag: "AlreadyExists" | "PermissionDenied") =>
  new ServerSecretStore.SecretStorePersistError({
    resource: "DPoP proof",
    cause: PlatformError.systemError({
      _tag: tag,
      module: "FileSystem",
      method: "open",
      pathOrDescriptor: "dpop-proof.bin",
    }),
  });

const makeRemovalTrackingStore = (removed: Array<string>) =>
  ServerSecretStore.ServerSecretStore.of({
    get: () => Effect.succeed(Option.none()),
    set: () => Effect.void,
    create: () => Effect.void,
    getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
    remove: (name) =>
      Effect.sync(() => {
        removed.push(name);
      }),
  });

describe("mapDpopReplayStoreError", () => {
  it("reports replay conflicts as invalid credentials", () => {
    const cause = storeFailure("AlreadyExists");
    const error = mapDpopReplayStoreError(cause);

    expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    if (error._tag === "ServerAuthInvalidCredentialError") {
      expect(error.cause).toBe(cause);
      expect(error.dpopFailureReason).toBe("replay");
    }
  });

  it("reports replay-store availability failures as internal errors", () => {
    const error = mapDpopReplayStoreError(storeFailure("PermissionDenied"));

    expect(error._tag).toBe("ServerAuthDpopReplayStateRecordError");
    if (error._tag === "ServerAuthDpopReplayStateRecordError") {
      expect(error.message).toBe("Failed to record DPoP proof replay state.");
    }
  });
});

describe("DPoP replay retention", () => {
  it.effect("prunes accepted proof state only after the complete proof window", () =>
    Effect.gen(function* () {
      const removed: Array<string> = [];
      yield* scheduleDpopReplayStateRemoval(
        makeRemovalTrackingStore(removed),
        "dpop-proof-safe-key",
      );

      expect(Duration.toMillis(DPOP_REPLAY_RETENTION)).toBe(305_000);
      yield* TestClock.adjust("304 seconds");
      expect(removed).toEqual([]);

      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
      expect(removed).toEqual(["dpop-proof-safe-key"]);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

describe("mapDpopFailureReason", () => {
  it("maps verifier failures to safe client-facing categories", () => {
    const mappings = [
      ["time_window", "time_window"],
      ["key_mismatch", "key_mismatch"],
      ["method_mismatch", "request_mismatch"],
      ["url_mismatch", "request_mismatch"],
      ["access_token_hash_mismatch", "token_mismatch"],
      ["missing_proof", "invalid_proof"],
      ["malformed_proof", "invalid_proof"],
      ["invalid_signature", "invalid_proof"],
      ["invalid_proof", "invalid_proof"],
    ] as const;

    for (const [code, expected] of mappings) {
      expect(mapDpopFailureReason(code)).toBe(expected);
    }
  });
});
