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

const LATEST_MIGRATION = "20261005232034_managed_endpoint_tunnel_released_at";

// Fork-only (or fork-reconciled) objects. Upstream nightlies regenerate
// successor snapshots from a schema that does not include these, and Alchemy
// then emits CREATE TABLE/INDEX / ADD COLUMN against prod. The Alchemy head
// snapshot must keep every name in this list.
const PRESERVED_ENTITIES = [
  "relay_mobile_devices.android_api_level",
  "relay_delivery_attempts.idx_relay_delivery_attempts_created_at",
  "relay_environment_credentials.idx_relay_environment_credentials_revoked_at",
  "relay_home_suggestion_digests",
  "relay_home_suggestions",
  "relay_environment_links.hold_webhooks_while_offline",
  "relay_managed_endpoint_allocations.recovery_enabled_at",
  "relay_managed_endpoint_allocations.recovery_environment_public_key",
  "relay_managed_endpoint_allocations.origin",
  "relay_managed_endpoint_allocations.generation",
  "relay_managed_endpoint_allocations.tunnel_released_at",
] as const;

const entityName = (item: { name?: string; table?: string }) =>
  item.table === undefined ? item.name : `${item.table}.${item.name}`;

const snapshotNames = (ddl: ReadonlyArray<{ name?: string; table?: string }>) =>
  new Set(ddl.map(entityName));

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

const alchemyHeads = <T extends { snapshot: { id: string; prevIds: ReadonlyArray<string> } }>(
  entries: ReadonlyArray<T>,
) => {
  const referenced = new Set(entries.flatMap(({ snapshot }) => snapshot.prevIds));
  return entries.filter(({ snapshot }) => !referenced.has(snapshot.id));
};

describe("relay postgres migration snapshots", () => {
  it.effect("forms a single prevIds chain so Alchemy does not regenerate applied SQL", () =>
    withNodeServices(
      Effect.gen(function* () {
        const entries = yield* loadSnapshots;
        const byId = new Map(entries.map(({ name, snapshot }) => [snapshot.id, name]));
        const heads = alchemyHeads(entries);

        expect(heads.map(({ name }) => name)).toEqual([LATEST_MIGRATION]);

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

  it.effect("keeps Pretty-only tables, columns, and indexes on every successor snapshot", () =>
    withNodeServices(
      Effect.gen(function* () {
        const entries = yield* loadSnapshots;
        const byId = new Map(entries.map((entry) => [entry.snapshot.id, entry]));
        const heads = alchemyHeads(entries);
        expect(heads.map(({ name }) => name)).toEqual([LATEST_MIGRATION]);

        const latest = heads[0];
        expect(latest).toBeDefined();
        if (latest === undefined) return;

        const names = snapshotNames(latest.snapshot.ddl);
        for (const entity of PRESERVED_ENTITIES) {
          expect(names.has(entity)).toBe(true);
        }

        // The head snapshot must keep every object its parent recorded.
        // Upstream nightlies regenerate the successor from their schema and
        // drop Pretty-only tables/indexes; Alchemy then re-emits CREATE.
        for (const prevId of latest.snapshot.prevIds) {
          if (prevId === DRIZZLE_ORIGIN_UUID) continue;
          const parent = byId.get(prevId);
          expect(parent).toBeDefined();
          if (parent === undefined) continue;
          const parentNames = snapshotNames(parent.snapshot.ddl);
          for (const entity of parentNames) {
            expect(names.has(entity)).toBe(true);
          }
        }
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
        const latest = alchemyHeads(yield* loadSnapshots)[0];
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

  it.effect("keeps the latest committed migration SQL idempotent for prod reruns", () =>
    withNodeServices(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const latest = alchemyHeads(yield* loadSnapshots)[0];
        expect(latest).toBeDefined();
        if (latest === undefined) return;

        const root = yield* path.fromFileUrl(new URL("../../migrations/postgres", import.meta.url));
        const sql = yield* fs.readFileString(path.join(root, latest.name, "migration.sql"));
        for (const statement of sql.split(/--> statement-breakpoint|\n/)) {
          const trimmed = statement.trim();
          if (trimmed.length === 0) continue;
          if (/^CREATE TABLE\b/i.test(trimmed)) {
            expect(trimmed).toMatch(/^CREATE TABLE IF NOT EXISTS\b/i);
          }
          if (/^ALTER TABLE\b.*\bADD COLUMN\b/i.test(trimmed)) {
            expect(trimmed).toMatch(/\bADD COLUMN IF NOT EXISTS\b/i);
          }
          if (/^CREATE(?:\s+UNIQUE)?\s+INDEX\b/i.test(trimmed)) {
            expect(trimmed).toMatch(/\bIF NOT EXISTS\b/i);
          }
        }
      }),
    ),
  );
});
