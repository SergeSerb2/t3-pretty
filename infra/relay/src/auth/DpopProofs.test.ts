import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as RelayDb from "../db.ts";
import { relayDpopProofs } from "../persistence/schema.ts";
import * as DpopProofs from "./DpopProofs.ts";

describe("DpopProofReplay", () => {
  it.effect("consumes proof ids without pruning expired rows on the request path", () => {
    const calls: Array<string> = [];
    const insertedValues: Array<{
      readonly thumbprint: string;
      readonly jti: string;
      readonly iat: number;
      readonly expiresAt: string;
      readonly createdAt: string;
    }> = [];
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayDpopProofs);
        calls.push("insert");
        return {
          values: (values: (typeof insertedValues)[number]) => {
            insertedValues.push(values);
            calls.push("insert.values");
            return {
              onConflictDoNothing: () => {
                calls.push("insert.onConflictDoNothing");
                return {
                  returning: (selection: unknown) => {
                    expect(selection).toBeDefined();
                    calls.push("insert.returning");
                    return Effect.succeed([{ jti: values.jti }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const replay = yield* DpopProofs.DpopProofReplay;
      const consumed = yield* replay.consume({
        thumbprint: "thumbprint",
        jti: "jti",
        iat: 1_771_000_000,
        expiresAt: Option.getOrThrow(DateTime.make("2026-05-25T12:00:00.000Z")),
      });

      expect(consumed).toBe(true);
      expect(calls).toEqual([
        "insert",
        "insert.values",
        "insert.onConflictDoNothing",
        "insert.returning",
      ]);
      expect(insertedValues).toMatchObject([
        {
          thumbprint: "thumbprint",
          jti: "jti",
          iat: 1_771_000_000,
          expiresAt: "2026-05-25T12:00:00.000Z",
        },
      ]);
    }).pipe(
      Effect.provide(DpopProofs.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
    );
  });

  it.effect("hashes replay identifiers that exceed persistence column widths", () => {
    const insertedValues: Array<{
      readonly thumbprint: string;
      readonly jti: string;
      readonly iat: number;
      readonly expiresAt: string;
      readonly createdAt: string;
    }> = [];
    const consumed = new Set<string>();
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayDpopProofs);
        return {
          values: (values: (typeof insertedValues)[number]) => {
            insertedValues.push(values);
            return {
              onConflictDoNothing: () => ({
                returning: () =>
                  Effect.sync(() => {
                    const key = `${values.thumbprint}:${values.jti}`;
                    if (consumed.has(key)) return [];
                    consumed.add(key);
                    return [{ jti: values.jti }];
                  }),
              }),
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];
    const input = {
      thumbprint: "public-key".repeat(32),
      jti: "j".repeat(256),
      iat: 1_771_000_000,
      expiresAt: Option.getOrThrow(DateTime.make("2026-05-25T12:00:00.000Z")),
    };

    return Effect.gen(function* () {
      const replay = yield* DpopProofs.DpopProofReplay;

      expect(yield* replay.consume(input)).toBe(true);
      expect(yield* replay.consume(input)).toBe(false);
      expect(insertedValues).toHaveLength(2);
      expect(insertedValues[0]?.thumbprint).toMatch(/^sha256:/);
      expect(insertedValues[0]?.thumbprint).not.toBe(input.thumbprint);
      expect(insertedValues[0]?.thumbprint.length).toBeLessThanOrEqual(128);
      expect(insertedValues[0]?.jti).toMatch(/^sha256:/);
      expect(insertedValues[0]?.jti).not.toBe(input.jti);
      expect(insertedValues[0]?.jti.length).toBeLessThanOrEqual(255);
      expect(insertedValues[1]).toEqual(insertedValues[0]);
    }).pipe(
      Effect.provide(DpopProofs.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
    );
  });

  it.effect("prunes expired proof rows from the maintenance path", () => {
    const calls: Array<string> = [];
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayDpopProofs);
        calls.push("delete");
        return {
          where: (condition: unknown) => {
            expect(condition).toBeDefined();
            calls.push("delete.where");
            return Effect.void;
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const replay = yield* DpopProofs.DpopProofReplay;
      yield* replay.pruneExpired;
      expect(calls).toEqual(["delete", "delete.where"]);
    }).pipe(
      Effect.provide(DpopProofs.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
    );
  });

  it.effect("retains the prune cutoff and database failure", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayDpopProofs);
        return {
          where: () => Effect.fail(cause),
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const replay = yield* DpopProofs.DpopProofReplay;
      const error = yield* Effect.flip(replay.pruneExpired);

      expect(error).toMatchObject({
        _tag: "DpopProofReplayPersistenceError",
        operation: "prune-expired",
      });
      expect(Date.parse(error.expiresBefore ?? "")).not.toBeNaN();
      expect(error.cause).toBe(cause);
    }).pipe(
      Effect.provide(DpopProofs.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
    );
  });
});
