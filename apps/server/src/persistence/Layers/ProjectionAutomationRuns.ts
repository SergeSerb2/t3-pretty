import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { AutomationRunTrigger } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  AutomationRunRetentionInput,
  DeleteProjectionAutomationRunsInput,
  GetProjectionAutomationRunInput,
  ListProjectionAutomationRunsPageInput,
  ProjectionAutomationRun,
  ProjectionAutomationRunRepository,
  type ProjectionAutomationRunRepositoryShape,
} from "../Services/ProjectionAutomationRuns.ts";

const ProjectionAutomationRunDbRow = ProjectionAutomationRun.mapFields(
  Struct.assign({
    trigger: Schema.fromJsonString(AutomationRunTrigger),
  }),
);

const SELECT_COLUMNS = `
  run_id AS "id",
  automation_id AS "automationId",
  project_id AS "projectId",
  thread_id AS "threadId",
  status,
  trigger_json AS "trigger",
  requested_at AS "requestedAt",
  started_at AS "startedAt",
  finished_at AS "finishedAt",
  error,
  summary
`;

const makeProjectionAutomationRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql.literal(SELECT_COLUMNS);

  const upsertRow = SqlSchema.void({
    Request: ProjectionAutomationRun,
    execute: (row) =>
      sql`
        INSERT INTO projection_automation_runs (
          run_id,
          automation_id,
          project_id,
          thread_id,
          status,
          trigger_json,
          requested_at,
          started_at,
          finished_at,
          error,
          summary
        )
        VALUES (
          ${row.id},
          ${row.automationId},
          ${row.projectId},
          ${row.threadId},
          ${row.status},
          ${JSON.stringify(row.trigger)},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.finishedAt},
          ${row.error},
          ${row.summary}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          automation_id = excluded.automation_id,
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          status = excluded.status,
          trigger_json = excluded.trigger_json,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          error = excluded.error,
          summary = excluded.summary
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionAutomationRunInput,
    Result: ProjectionAutomationRunDbRow,
    execute: ({ runId }) =>
      sql`
        SELECT ${columns}
        FROM projection_automation_runs
        WHERE run_id = ${runId}
      `,
  });

  const listPageRows = SqlSchema.findAll({
    Request: ListProjectionAutomationRunsPageInput,
    Result: ProjectionAutomationRunDbRow,
    execute: ({ automationId, limit, before }) =>
      before === undefined
        ? sql`
            SELECT ${columns}
            FROM projection_automation_runs
            WHERE automation_id = ${automationId}
            ORDER BY requested_at DESC, run_id DESC
            LIMIT ${limit}
          `
        : sql`
            SELECT ${columns}
            FROM projection_automation_runs
            WHERE automation_id = ${automationId}
              AND (
                requested_at < ${before.requestedAt}
                OR (requested_at = ${before.requestedAt} AND run_id < ${before.runId})
              )
            ORDER BY requested_at DESC, run_id DESC
            LIMIT ${limit}
          `,
  });

  const pruneRows = SqlSchema.void({
    Request: AutomationRunRetentionInput,
    execute: ({ automationId, keep }) =>
      sql`
        DELETE FROM projection_automation_runs
        WHERE run_id IN (
          SELECT run_id
          FROM projection_automation_runs
          WHERE automation_id = ${automationId}
          ORDER BY requested_at DESC, run_id DESC
          LIMIT -1 OFFSET ${keep}
        )
      `,
  });

  const deleteRowsByAutomation = SqlSchema.void({
    Request: DeleteProjectionAutomationRunsInput,
    execute: ({ automationId }) =>
      sql`
        DELETE FROM projection_automation_runs
        WHERE automation_id = ${automationId}
      `,
  });

  const upsert: ProjectionAutomationRunRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRunRepository.upsert:query")),
    );

  const getById: ProjectionAutomationRunRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRunRepository.getById:query")),
    );

  const listPage: ProjectionAutomationRunRepositoryShape["listPage"] = (input) =>
    listPageRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRunRepository.listPage:query")),
    );

  const pruneBeyond: ProjectionAutomationRunRepositoryShape["pruneBeyond"] = (input) =>
    pruneRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRunRepository.pruneBeyond:query")),
    );

  const deleteByAutomationId: ProjectionAutomationRunRepositoryShape["deleteByAutomationId"] = (
    input,
  ) =>
    deleteRowsByAutomation(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAutomationRunRepository.deleteByAutomationId:query"),
      ),
    );

  return {
    upsert,
    getById,
    listPage,
    pruneBeyond,
    deleteByAutomationId,
  } satisfies ProjectionAutomationRunRepositoryShape;
});

export const ProjectionAutomationRunRepositoryLive = Layer.effect(
  ProjectionAutomationRunRepository,
  makeProjectionAutomationRunRepository,
);
