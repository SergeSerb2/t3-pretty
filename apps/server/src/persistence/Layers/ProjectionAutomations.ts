import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  AutomationActiveRun,
  AutomationLastRun,
  AutomationRunTrigger,
  AutomationTriggers,
  ModelSelection,
} from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionAutomationInput,
  ListProjectionAutomationsByProjectInput,
  ProjectionAutomation,
  ProjectionAutomationRepository,
  type ProjectionAutomationRepositoryShape,
} from "../Services/ProjectionAutomations.ts";

const ProjectionAutomationDbRow = ProjectionAutomation.mapFields(
  Struct.assign({
    enabled: Schema.Number,
    triggers: Schema.fromJsonString(AutomationTriggers),
    modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    createPullRequest: Schema.Number,
    includeLastRunSummary: Schema.Number,
    catchUpMissedRuns: Schema.Number,
    activeRun: Schema.NullOr(Schema.fromJsonString(AutomationActiveRun)),
    lastRun: Schema.NullOr(Schema.fromJsonString(AutomationLastRun)),
    pendingTrigger: Schema.NullOr(Schema.fromJsonString(AutomationRunTrigger)),
  }),
);
type ProjectionAutomationDbRow = typeof ProjectionAutomationDbRow.Type;

const fromDbRow = (row: ProjectionAutomationDbRow): ProjectionAutomation => ({
  ...row,
  enabled: row.enabled === 1,
  createPullRequest: row.createPullRequest === 1,
  includeLastRunSummary: row.includeLastRunSummary === 1,
  catchUpMissedRuns: row.catchUpMissedRuns === 1,
});

const SELECT_COLUMNS = `
  automation_id AS "id",
  project_id AS "projectId",
  name,
  prompt,
  enabled,
  triggers_json AS "triggers",
  model_selection_json AS "modelSelection",
  runtime_mode AS "runtimeMode",
  workspace,
  create_pull_request AS "createPullRequest",
  include_last_run_summary AS "includeLastRunSummary",
  catch_up_missed_runs AS "catchUpMissedRuns",
  min_interval_seconds AS "minIntervalSeconds",
  timeout_minutes AS "timeoutMinutes",
  webhook_token AS "webhookToken",
  source_thread_id AS "sourceThreadId",
  next_run_at AS "nextRunAt",
  active_run_json AS "activeRun",
  last_run_json AS "lastRun",
  last_requested_at AS "lastRequestedAt",
  pending_trigger_json AS "pendingTrigger",
  consecutive_failures AS "consecutiveFailures",
  run_count AS "runCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const makeProjectionAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql.literal(SELECT_COLUMNS);

  const upsertRow = SqlSchema.void({
    Request: ProjectionAutomation,
    execute: (row) =>
      sql`
        INSERT INTO projection_automations (
          automation_id,
          project_id,
          name,
          prompt,
          enabled,
          triggers_json,
          model_selection_json,
          runtime_mode,
          workspace,
          create_pull_request,
          include_last_run_summary,
          catch_up_missed_runs,
          min_interval_seconds,
          timeout_minutes,
          webhook_token,
          source_thread_id,
          next_run_at,
          active_run_json,
          last_run_json,
          last_requested_at,
          pending_trigger_json,
          consecutive_failures,
          run_count,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.name},
          ${row.prompt},
          ${row.enabled ? 1 : 0},
          ${JSON.stringify(row.triggers)},
          ${row.modelSelection === null ? null : JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.workspace},
          ${row.createPullRequest ? 1 : 0},
          ${row.includeLastRunSummary ? 1 : 0},
          ${row.catchUpMissedRuns ? 1 : 0},
          ${row.minIntervalSeconds},
          ${row.timeoutMinutes},
          ${row.webhookToken},
          ${row.sourceThreadId},
          ${row.nextRunAt},
          ${row.activeRun === null ? null : JSON.stringify(row.activeRun)},
          ${row.lastRun === null ? null : JSON.stringify(row.lastRun)},
          ${row.lastRequestedAt},
          ${row.pendingTrigger === null ? null : JSON.stringify(row.pendingTrigger)},
          ${row.consecutiveFailures},
          ${row.runCount},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (automation_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          prompt = excluded.prompt,
          enabled = excluded.enabled,
          triggers_json = excluded.triggers_json,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          workspace = excluded.workspace,
          create_pull_request = excluded.create_pull_request,
          include_last_run_summary = excluded.include_last_run_summary,
          catch_up_missed_runs = excluded.catch_up_missed_runs,
          min_interval_seconds = excluded.min_interval_seconds,
          timeout_minutes = excluded.timeout_minutes,
          webhook_token = excluded.webhook_token,
          source_thread_id = excluded.source_thread_id,
          next_run_at = excluded.next_run_at,
          active_run_json = excluded.active_run_json,
          last_run_json = excluded.last_run_json,
          last_requested_at = excluded.last_requested_at,
          pending_trigger_json = excluded.pending_trigger_json,
          consecutive_failures = excluded.consecutive_failures,
          run_count = excluded.run_count,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionAutomationInput,
    Result: ProjectionAutomationDbRow,
    execute: ({ automationId }) =>
      sql`
        SELECT ${columns}
        FROM projection_automations
        WHERE automation_id = ${automationId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionAutomationDbRow,
    execute: () =>
      sql`
        SELECT ${columns}
        FROM projection_automations
        ORDER BY created_at ASC, automation_id ASC
      `,
  });

  const listRowsByProject = SqlSchema.findAll({
    Request: ListProjectionAutomationsByProjectInput,
    Result: ProjectionAutomationDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT ${columns}
        FROM projection_automations
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, automation_id ASC
      `,
  });

  const deleteRow = SqlSchema.void({
    Request: GetProjectionAutomationInput,
    execute: ({ automationId }) =>
      sql`
        DELETE FROM projection_automations
        WHERE automation_id = ${automationId}
      `,
  });

  const upsert: ProjectionAutomationRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.upsert:query")),
    );

  const getById: ProjectionAutomationRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.map(Option.map(fromDbRow)),
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.getById:query")),
    );

  const listAll: ProjectionAutomationRepositoryShape["listAll"] = () =>
    listRows().pipe(
      Effect.map((rows) => rows.map(fromDbRow)),
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.listAll:query")),
    );

  const listByProjectId: ProjectionAutomationRepositoryShape["listByProjectId"] = (input) =>
    listRowsByProject(input).pipe(
      Effect.map((rows) => rows.map(fromDbRow)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionAutomationRepository.listByProjectId:query"),
      ),
    );

  const deleteById: ProjectionAutomationRepositoryShape["deleteById"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    listByProjectId,
    deleteById,
  } satisfies ProjectionAutomationRepositoryShape;
});

export const ProjectionAutomationRepositoryLive = Layer.effect(
  ProjectionAutomationRepository,
  makeProjectionAutomationRepository,
);
