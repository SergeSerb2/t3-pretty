import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { runMigrations } from "../Migrations.ts";
import { cleanupSupersededToolUpdates } from "../Migrations/047_DeleteSupersededToolUpdatedActivities.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    // WAL stays consistent with NORMAL but only syncs at checkpoint time
    // instead of on every commit — the default FULL fsyncs each transaction,
    // which dominates the orchestration write path during streaming turns.
    yield* sql`PRAGMA synchronous = NORMAL;`;
    // Default 1000 pages (~4 MB) checkpoints mid-turn while readers hold the
    // WAL open, so checkpoints stall and the WAL grows anyway. 4000 pages
    // (~16 MB) means fewer, larger checkpoints between turns.
    yield* sql`PRAGMA wal_autocheckpoint = 4000;`;
    // 64 MiB page cache (negative = KiB). The state DB is a few GB; the default
    // 2 MB cache re-reads hot projection pages on every snapshot query.
    yield* sql`PRAGMA cache_size = -65536;`;
    const ranMigrations = yield* runMigrations();
    // Migration 47 marks the switch to live-only tool progress; the bulk
    // delete of the superseded per-tick rows runs here, best-effort and
    // batched, while this is the only connection (no client has served a
    // request yet), then VACUUM reclaims the pages (measured ~8 s + ~4 s for
    // a 3 GB file that shrank to 1 GB). A failure (e.g. disk full) only
    // means the rows / space stay; the read side already hides them.
    if (ranMigrations.some(([id]) => id === 47)) {
      yield* cleanupSupersededToolUpdates().pipe(
        Effect.tap((deleted) =>
          Effect.log("deleted superseded tool progress rows").pipe(Effect.annotateLogs(deleted)),
        ),
        Effect.andThen(sql`VACUUM`),
        Effect.catch((cause) =>
          Effect.logWarning("superseded tool progress cleanup failed", { cause }),
        ),
      );
    }
    // Refresh planner statistics on clean shutdown; cheap and recommended by
    // SQLite for long-lived connections. Runs before the client's own close.
    yield* Effect.addFinalizer(() => sql`PRAGMA optimize;`.pipe(Effect.ignore));
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup,
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    return makeSqlitePersistenceLive(dbPath);
  }),
);
