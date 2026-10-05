import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { AgentObservation } from "./AgentObservation.ts";

export class AgentMonitoringJournalError extends Schema.TaggedError<AgentMonitoringJournalError>()(
  "AgentMonitoringJournalError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Failed to access the agent monitoring journal.";
  }
}

export interface AgentMonitoringReport {
  readonly capturedSequence: number;
  readonly recordCount: number;
  readonly pendingCount: number;
  readonly droppedPendingCount: number;
  readonly activeAgentCount: number;
  readonly lastObservedAt: number | null;
  readonly lastExportAt: number | null;
  readonly failureGroups: ReadonlyArray<{
    kind: string;
    provider: string;
    tool: string;
    category: string;
    code: string;
    count: number;
  }>;
  readonly outcomes: ReadonlyArray<{
    kind: string;
    operation: string;
    provider: string;
    tool: string;
    status: string;
    count: number;
    averageDurationMs: number | null;
    maxDurationMs: number | null;
  }>;
}

export class AgentMonitoringJournal extends Context.Service<
  AgentMonitoringJournal,
  {
    readonly enroll: (
      sequence: number,
      skipUncaptured?: boolean,
    ) => Effect.Effect<void, AgentMonitoringJournalError>;
    readonly cursor: Effect.Effect<number, AgentMonitoringJournalError>;
    readonly pause: Effect.Effect<void, AgentMonitoringJournalError>;
    readonly capture: (
      batch: ReadonlyArray<{ sequence: number; observation?: AgentObservation | undefined }>,
    ) => Effect.Effect<void, AgentMonitoringJournalError>;
    readonly pending: Effect.Effect<ReadonlyArray<AgentObservation>, AgentMonitoringJournalError>;
    readonly acknowledge: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<void, AgentMonitoringJournalError>;
    readonly report: Effect.Effect<AgentMonitoringReport, AgentMonitoringJournalError>;
    readonly statistics: Effect.Effect<
      Pick<
        AgentMonitoringReport,
        | "capturedSequence"
        | "recordCount"
        | "pendingCount"
        | "droppedPendingCount"
        | "lastObservedAt"
        | "lastExportAt"
      >,
      AgentMonitoringJournalError
    >;
  }
>()("t3/observability/AgentMonitoringJournal") {}

const decodeObservation = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentObservation));
const encodeObservation = Schema.encodeEffect(Schema.fromJsonString(AgentObservation));

const make = (options: { readonly readonly: boolean; readonly maxRecords: number }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const guard = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
      effect.pipe(
        Effect.mapError((cause) => new AgentMonitoringJournalError({ operation, cause })),
      );
    if (!options.readonly) {
      yield* guard(
        Effect.gen(function* () {
          yield* sql`PRAGMA journal_mode = WAL`;
          yield* sql`PRAGMA busy_timeout = 1000`;
          yield* sql`PRAGMA journal_size_limit = 1048576`;
          // Bound file growth when old records are evicted; reuse free pages on subsequent writes.
          yield* sql`CREATE TABLE IF NOT EXISTS agent_monitoring_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`;
          yield* sql`CREATE TABLE IF NOT EXISTS agent_observations (
        id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        kind TEXT NOT NULL, operation TEXT NOT NULL, provider TEXT NOT NULL, tool TEXT NOT NULL,
        status TEXT NOT NULL, observed_at INTEGER NOT NULL, duration_ms REAL,
        body TEXT NOT NULL, exported INTEGER NOT NULL DEFAULT 0
      )`;
          yield* sql`CREATE INDEX IF NOT EXISTS agent_observations_pending ON agent_observations(exported, sequence)`;
          yield* sql`CREATE INDEX IF NOT EXISTS agent_observations_entity ON agent_observations(entity_id, sequence)`;
          yield* sql`INSERT OR IGNORE INTO agent_monitoring_state (key, value) VALUES ('dropped_pending', 0)`;
        }),
        "initialize",
      );
    }

    const enroll = (sequence: number, skipUncaptured = false) =>
      guard(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT OR IGNORE INTO agent_monitoring_state (key, value) VALUES ('cursor', ${sequence})`;
            const [paused] = yield* sql<{
              value: number;
            }>`SELECT value FROM agent_monitoring_state WHERE key = 'paused'`;
            if (skipUncaptured || paused?.value === 1)
              yield* sql`UPDATE agent_monitoring_state SET value = MAX(value, ${sequence}) WHERE key = 'cursor'`;
            yield* sql`INSERT OR REPLACE INTO agent_monitoring_state (key, value) VALUES ('paused', 0)`;
          }),
        ),
        "enroll",
      );
    const capture: AgentMonitoringJournal["Service"]["capture"] = (batch) =>
      guard(
        sql.withTransaction(
          Effect.gen(function* () {
            for (const { observation } of batch) {
              if (!observation) continue;
              const [previous] = yield* sql<{
                status: string;
                body: string;
              }>`SELECT status, body FROM agent_observations
          WHERE entity_id = ${observation.entityId} ORDER BY sequence DESC LIMIT 1`;
              // Collapse streamed progress updates. A resumed running state after waiting is a new transition.
              if (
                previous?.status === observation.status &&
                (yield* decodeObservation(previous.body)).spanId === observation.spanId
              )
                continue;
              const body = yield* encodeObservation(observation);
              const duration = observation.attributes["t3.duration_ms"];
              yield* sql`INSERT OR IGNORE INTO agent_observations (
          id, entity_id, sequence, kind, operation, provider, tool, status, observed_at, duration_ms, body
        ) VALUES (
          ${observation.id}, ${observation.entityId}, ${observation.sequence}, ${observation.kind}, ${observation.operation},
          ${String(observation.attributes["t3.provider"] ?? "unknown")}, ${String(observation.attributes["gen_ai.tool.name"] ?? "")},
          ${observation.status}, ${observation.observedAt}, ${typeof duration === "number" ? duration : null}, ${body}
        )`;
            }
            const sequence = batch.at(-1)?.sequence;
            if (sequence !== undefined)
              yield* sql`UPDATE agent_monitoring_state SET value = MAX(value, ${sequence}) WHERE key = 'cursor'`;
            const [count] = yield* sql<{
              count: number;
            }>`SELECT COUNT(*) AS count FROM agent_observations`;
            const excess = Math.max(0, (count?.count ?? 0) - options.maxRecords);
            if (excess > 0) {
              const [dropped] = yield* sql<{
                count: number;
              }>`SELECT COUNT(*) AS count FROM agent_observations
          WHERE exported = 0 AND id IN (SELECT id FROM agent_observations ORDER BY sequence LIMIT ${excess})`;
              yield* sql`UPDATE agent_monitoring_state SET value = value + ${dropped?.count ?? 0} WHERE key = 'dropped_pending'`;
              yield* sql`DELETE FROM agent_observations WHERE id IN (SELECT id FROM agent_observations ORDER BY sequence LIMIT ${excess})`;
            }
          }),
        ),
        "capture",
      );
    const pending = guard(
      Effect.gen(function* () {
        const rows = yield* sql<{
          body: string;
        }>`SELECT body FROM agent_observations WHERE exported = 0 ORDER BY sequence LIMIT 100`;
        return yield* Effect.forEach(rows, (row) => decodeObservation(row.body));
      }),
      "read pending",
    );
    const acknowledge = (ids: ReadonlyArray<string>) =>
      ids.length === 0
        ? Effect.void
        : guard(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`UPDATE agent_observations SET exported = 1 WHERE ${sql.in("id", ids)}`;
                const now = yield* Clock.currentTimeMillis;
                yield* sql`INSERT OR REPLACE INTO agent_monitoring_state (key, value) VALUES ('last_export_at', ${now})`;
              }),
            ),
            "acknowledge",
          );
    const statistics = guard(
      Effect.gen(function* () {
        const state = yield* sql<{
          key: string;
          value: number;
        }>`SELECT key, value FROM agent_monitoring_state`;
        const [totals] = yield* sql<{ count: number; pending: number; last: number | null }>`SELECT
      COUNT(*) AS count, COALESCE(SUM(exported = 0), 0) AS pending, MAX(observed_at) AS last FROM agent_observations`;
        return {
          capturedSequence: state.find((row) => row.key === "cursor")?.value ?? 0,
          recordCount: totals?.count ?? 0,
          pendingCount: totals?.pending ?? 0,
          droppedPendingCount: state.find((row) => row.key === "dropped_pending")?.value ?? 0,
          lastObservedAt: totals?.last ?? null,
          lastExportAt: state.find((row) => row.key === "last_export_at")?.value ?? null,
        };
      }),
      "statistics",
    );
    const report = guard(
      Effect.gen(function* () {
        const totals = yield* statistics;
        const [active] = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM (
      SELECT status, ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY sequence DESC) AS position
      FROM agent_observations WHERE kind IN ('run', 'subagent')
    ) WHERE position = 1 AND status IN ('preparing', 'queued', 'starting', 'running', 'pending', 'waiting')`;
        const outcomes = yield* sql<
          AgentMonitoringReport["outcomes"][number]
        >`SELECT kind, operation, provider, tool, status,
      COUNT(*) AS count, AVG(duration_ms) AS "averageDurationMs", MAX(duration_ms) AS "maxDurationMs"
      FROM agent_observations GROUP BY kind, operation, provider, tool, status ORDER BY count DESC LIMIT 100`;
        const failureGroups = yield* sql<
          AgentMonitoringReport["failureGroups"][number]
        >`SELECT kind, provider,
      CASE WHEN tool = '' THEN operation ELSE tool END AS tool,
      COALESCE(json_extract(body, '$.attributes."t3.error_class"'), 'operation_failed') AS category,
      COALESCE(json_extract(body, '$.attributes."t3.error_code"'), 'unknown') AS code, COUNT(*) AS count
      FROM agent_observations WHERE status = 'failed' AND kind IN ('error', 'tool', 'subagent')
      GROUP BY kind, provider, tool, category, code ORDER BY count DESC LIMIT 100`;
        return {
          ...totals,
          activeAgentCount: active?.count ?? 0,
          failureGroups,
          outcomes,
        };
      }),
      "report",
    );
    const cursor = guard(
      sql<{ value: number }>`SELECT value FROM agent_monitoring_state WHERE key = 'cursor'`.pipe(
        Effect.map((rows) => rows[0]?.value ?? 0),
      ),
      "cursor",
    );
    return AgentMonitoringJournal.of({
      enroll,
      cursor,
      pause: guard(
        sql`INSERT OR REPLACE INTO agent_monitoring_state (key, value) VALUES ('paused', 1)`.pipe(
          Effect.asVoid,
        ),
        "pause",
      ),
      capture,
      pending,
      acknowledge,
      report,
      statistics,
    });
  });

/** The server writes the journal; the CLI opens the same journal read-only. */
export const layerAt = (
  filename: string,
  options?: { readonly readonly?: boolean; readonly maxRecords?: number },
) =>
  Layer.effect(
    AgentMonitoringJournal,
    make({ readonly: options?.readonly ?? false, maxRecords: options?.maxRecords ?? 20_000 }),
  ).pipe(Layer.provide(NodeSqliteClient.layer({ filename, readonly: options?.readonly })));
