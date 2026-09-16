import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const DRIZZLE_ORIGIN_UUID = "00000000-0000-0000-0000-000000000000";

const SnapshotEntity = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  table: Schema.optionalKey(Schema.String),
});

const Snapshot = Schema.Struct({
  id: Schema.String,
  prevIds: Schema.Array(Schema.String),
  ddl: Schema.Array(SnapshotEntity),
});

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSnapshot = Schema.decodeUnknownEffect(Snapshot);

const loadSnapshots = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL("../../migrations/postgres", import.meta.url));
  const names = (yield* fs.readDirectory(root)).filter((name) => /^\d+_/.test(name)).sort();

  return yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const text = yield* fs.readFileString(path.join(root, name, "snapshot.json"));
      const raw = yield* decodeJson(text);
      const snapshot = yield* decodeSnapshot(raw);
      return { name, snapshot, raw };
    }),
  );
});

const withNodeServices = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  effect.pipe(Effect.provide(NodeServices.layer));

describe("relay postgres migration snapshots", () => {
  it.effect("forms a single prevIds chain so Alchemy does not regenerate applied SQL", () =>
    withNodeServices(
      Effect.gen(function* () {
        const entries = yield* loadSnapshots;
        const byId = new Map(entries.map(({ name, snapshot }) => [snapshot.id, name]));
        const referenced = new Set(entries.flatMap(({ snapshot }) => snapshot.prevIds));
        const heads = entries.filter(({ snapshot }) => !referenced.has(snapshot.id));

        expect(heads.map(({ name }) => name)).toEqual(["20260906042516_android_devices"]);

        const parent = new Map<string, string[]>();
        for (const { name, snapshot } of entries) {
          for (const prevId of snapshot.prevIds) {
            if (prevId === DRIZZLE_ORIGIN_UUID) continue;
            const parentName = byId.get(prevId);
            expect(parentName).toBeDefined();
            if (parentName !== undefined) {
              parent.set(parentName, [...(parent.get(parentName) ?? []), name]);
            }
          }
        }

        const forks = [...parent.entries()].filter(([, children]) => children.length > 1);
        expect(forks).toEqual([]);
      }),
    ),
  );

  it.effect(
    "keeps android device columns and the August delivery indexes on the latest snapshot",
    () =>
      withNodeServices(
        Effect.gen(function* () {
          const latest = (yield* loadSnapshots).at(-1);
          expect(latest?.name).toBe("20260906042516_android_devices");

          const names = new Set(
            (latest?.snapshot.ddl ?? []).map((item) =>
              item.table === undefined ? item.name : `${item.table}.${item.name}`,
            ),
          );

          expect(names.has("relay_mobile_devices.android_api_level")).toBe(true);
          expect(names.has("relay_delivery_attempts.idx_relay_delivery_attempts_created_at")).toBe(
            true,
          );
          expect(
            names.has("relay_environment_credentials.idx_relay_environment_credentials_revoked_at"),
          ).toBe(true);
        }),
      ),
  );

  it.effect("emits no SQL when Alchemy diffs the schema against the latest snapshot", () =>
    withNodeServices(
      Effect.gen(function* () {
        const { generateDrizzleJson, generateMigration } = yield* Effect.promise(
          () => import("drizzle-kit/api-postgres"),
        );
        const schema = yield* Effect.promise(() => import("./schema.ts"));
        const latest = (yield* loadSnapshots).at(-1);
        expect(latest).toBeDefined();
        if (latest === undefined) return;

        const current = yield* Effect.promise(() =>
          generateDrizzleJson(schema, latest.snapshot.id),
        );
        const statements = yield* Effect.promise(() =>
          generateMigration(latest.raw as Awaited<ReturnType<typeof generateDrizzleJson>>, current),
        );
        expect(statements).toEqual([]);
      }),
    ),
  );
});
