import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_OrchestrationEventRecordedAt", (it) => {
  it.effect("adds and conservatively backfills the server recording timestamp", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          'event-before-recorded-at',
          'thread',
          'thread-before-recorded-at',
          0,
          'thread.created',
          '2099-01-01T00:00:00.000Z',
          'client',
          '{}',
          '{}'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const rows = yield* sql<{ readonly occurredAt: string; readonly recordedAt: string }>`
        SELECT
          occurred_at AS "occurredAt",
          recorded_at AS "recordedAt"
        FROM orchestration_events
        WHERE event_id = 'event-before-recorded-at'
      `;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.occurredAt, "2099-01-01T00:00:00.000Z");
      assert.ok(Number.isFinite(Date.parse(rows[0]?.recordedAt ?? "")));
      assert.notEqual(rows[0]?.recordedAt, rows[0]?.occurredAt);
    }),
  );
});
