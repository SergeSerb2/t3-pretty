import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import OrchestrationV2 from "./Migrations/055_OrchestrationV2.ts";

describe("T3 Pretty migration history", () => {
  it.effect("upgrades the shipped fork ledger without changing existing migration IDs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 69 });
      const retained = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      yield* runMigrations();
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id <= 69 ORDER BY migration_id`,
        retained,
      );
      const history = yield* sql<{
        migration_id: number;
        name: string;
      }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
      assert.deepStrictEqual(
        history.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([53, 54])(
    "rejects conflicting upstream preview %s without modifying its ledger or import progress",
    (previewId) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 52 });
        yield* Migrator.make({})({
          loader: Migrator.fromRecord({ [`${previewId}_OrchestrationV2`]: OrchestrationV2 }),
        });
        yield* sql`INSERT INTO orchestration_v2_legacy_imports (thread_id, source_updated_at, shell_imported_at, transcript_imported_at, imported_message_count) VALUES ('preview-thread', '2026-09-15', '2026-09-15', '2026-09-16', 42)`;
        const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        const progress = yield* sql`SELECT * FROM orchestration_v2_legacy_imports`;
        assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          history,
        );
        assert.deepStrictEqual(yield* sql`SELECT * FROM orchestration_v2_legacy_imports`, progress);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("rolls back schema and ledger together on failure and can retry", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 69 });
      const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      // A conflicting view lets creation proceed, then fails index creation.
      // Unlike a constraint error, this is not mistaken for another migrator's lock.
      yield* sql`CREATE VIEW scheduled_task_webhook_relay_deliveries AS
        SELECT 'delivery' AS relay_delivery_id, 'task' AS task_id, 'now' AS seen_at`;
      assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        history,
      );
      assert.deepStrictEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('scheduled_task_webhook_deliveries', 'scheduled_task_webhook_relay_deliveries')`,
        [],
      );
      yield* sql`DROP VIEW scheduled_task_webhook_relay_deliveries`;
      const mcpAppModelContextMigrations = migrationManifest.filter(
        ([, name]) => name === "McpAppModelContext",
      );
      assert.strictEqual(mcpAppModelContextMigrations.length, 1);
      assert.deepStrictEqual(yield* runMigrations(), [
        [70, "ScheduledTaskWebhooks"],
        [71, "WebhookRelayDeliveries"],
        [72, "WebhookDispatchOutbox"],
        ...mcpAppModelContextMigrations,
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses unexpected later migrations without modifying their history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({ "53_OrchestrationV2": OrchestrationV2 }),
      });
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (54, 'UnknownFork')`;
      const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        history,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
