import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadInput,
  GetProjectionThreadInput,
  ListProjectionThreadsByProjectInput,
  ProjectionThread,
  ProjectionThreadRepository,
  RecordProjectionThreadBranchHeadInput,
  type ProjectionThreadRepositoryShape,
} from "../Services/ProjectionThreads.ts";
import {
  ModelSelection,
  SkillId,
  ThreadSceneryAssignment,
  ThreadSubagentPolicy,
} from "@t3tools/contracts";

const ProjectionThreadDbRow = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    scenery: Schema.NullOr(Schema.fromJsonString(ThreadSceneryAssignment)),
    enabledSkillIds: Schema.fromJsonString(Schema.Array(SkillId)),
    subagentPolicy: Schema.NullOr(Schema.fromJsonString(ThreadSubagentPolicy)),
  }),
);
type ProjectionThreadDbRow = typeof ProjectionThreadDbRow.Type;

const makeProjectionThreadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadRow = SqlSchema.void({
    Request: ProjectionThread,
    execute: (row) =>
      sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          branch_event_id,
          branch_head_ref,
          branch_head_repository,
          branch_head_owner,
          branch_head_is_cross_repository,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          settled_override,
          settled_at,
          snoozed_until,
          snoozed_at,
          pinned_at,
          pin_order_key,
          scenery_json,
          enabled_skill_ids,
          subagent_policy_json,
          title_regeneration_request_id,
          title_regeneration_started_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.branch},
          ${row.branchEventId ?? null},
          ${row.branchHeadRef ?? null},
          ${row.branchHeadRepository ?? null},
          ${row.branchHeadOwner ?? null},
          ${row.branchHeadIsCrossRepository ?? null},
          ${row.worktreePath},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.settledOverride},
          ${row.settledAt},
          ${row.snoozedUntil},
          ${row.snoozedAt},
          ${row.pinnedAt},
          ${row.pinOrderKey ?? null},
          ${row.scenery == null ? null : JSON.stringify(row.scenery)},
          ${JSON.stringify(row.enabledSkillIds)},
          ${row.subagentPolicy == null ? null : JSON.stringify(row.subagentPolicy)},
          ${row.titleRegenerationRequestId ?? null},
          ${row.titleRegenerationStartedAt ?? null},
          ${row.latestUserMessageAt},
          ${row.pendingApprovalCount},
          ${row.pendingUserInputCount},
          ${row.hasActionableProposedPlan},
          ${row.deletedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          branch = excluded.branch,
          branch_event_id = excluded.branch_event_id,
          branch_head_ref = CASE
            WHEN projection_threads.branch_event_id IS excluded.branch_event_id
              THEN projection_threads.branch_head_ref
            ELSE excluded.branch_head_ref
          END,
          branch_head_repository = CASE
            WHEN projection_threads.branch_event_id IS excluded.branch_event_id
              THEN projection_threads.branch_head_repository
            ELSE excluded.branch_head_repository
          END,
          branch_head_owner = CASE
            WHEN projection_threads.branch_event_id IS excluded.branch_event_id
              THEN projection_threads.branch_head_owner
            ELSE excluded.branch_head_owner
          END,
          branch_head_is_cross_repository = CASE
            WHEN projection_threads.branch_event_id IS excluded.branch_event_id
              THEN projection_threads.branch_head_is_cross_repository
            ELSE excluded.branch_head_is_cross_repository
          END,
          worktree_path = excluded.worktree_path,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          settled_override = excluded.settled_override,
          settled_at = excluded.settled_at,
          snoozed_until = excluded.snoozed_until,
          snoozed_at = excluded.snoozed_at,
          pinned_at = excluded.pinned_at,
          pin_order_key = excluded.pin_order_key,
          scenery_json = excluded.scenery_json,
          enabled_skill_ids = excluded.enabled_skill_ids,
          subagent_policy_json = excluded.subagent_policy_json,
          title_regeneration_request_id = excluded.title_regeneration_request_id,
          title_regeneration_started_at = excluded.title_regeneration_started_at,
          latest_user_message_at = excluded.latest_user_message_at,
          pending_approval_count = excluded.pending_approval_count,
          pending_user_input_count = excluded.pending_user_input_count,
          has_actionable_proposed_plan = excluded.has_actionable_proposed_plan,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadInput,
    Result: ProjectionThreadDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          branch_event_id AS "branchEventId",
          branch_head_ref AS "branchHeadRef",
          branch_head_repository AS "branchHeadRepository",
          branch_head_owner AS "branchHeadOwner",
          branch_head_is_cross_repository AS "branchHeadIsCrossRepository",
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt",
          pinned_at AS "pinnedAt",
          pin_order_key AS "pinOrderKey",
          scenery_json AS "scenery",
          enabled_skill_ids AS "enabledSkillIds",
          subagent_policy_json AS "subagentPolicy",
          title_regeneration_request_id AS "titleRegenerationRequestId",
          title_regeneration_started_at AS "titleRegenerationStartedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const listProjectionThreadRows = SqlSchema.findAll({
    Request: ListProjectionThreadsByProjectInput,
    Result: ProjectionThreadDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          branch_event_id AS "branchEventId",
          branch_head_ref AS "branchHeadRef",
          branch_head_repository AS "branchHeadRepository",
          branch_head_owner AS "branchHeadOwner",
          branch_head_is_cross_repository AS "branchHeadIsCrossRepository",
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt",
          pinned_at AS "pinnedAt",
          pin_order_key AS "pinOrderKey",
          scenery_json AS "scenery",
          enabled_skill_ids AS "enabledSkillIds",
          subagent_policy_json AS "subagentPolicy",
          title_regeneration_request_id AS "titleRegenerationRequestId",
          title_regeneration_started_at AS "titleRegenerationStartedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listAllProjectionThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRow,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          branch_event_id AS "branchEventId",
          branch_head_ref AS "branchHeadRef",
          branch_head_repository AS "branchHeadRepository",
          branch_head_owner AS "branchHeadOwner",
          branch_head_is_cross_repository AS "branchHeadIsCrossRepository",
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt",
          pinned_at AS "pinnedAt",
          pin_order_key AS "pinOrderKey",
          scenery_json AS "scenery",
          enabled_skill_ids AS "enabledSkillIds",
          subagent_policy_json AS "subagentPolicy",
          title_regeneration_request_id AS "titleRegenerationRequestId",
          title_regeneration_started_at AS "titleRegenerationStartedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const deleteProjectionThreadRow = SqlSchema.void({
    Request: DeleteProjectionThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const recordProjectionThreadBranchHead = SqlSchema.void({
    Request: RecordProjectionThreadBranchHeadInput,
    execute: (input) =>
      sql`
        UPDATE projection_threads
        SET
          branch_head_ref = ${input.headRef},
          branch_head_repository = ${input.repositoryNameWithOwner},
          branch_head_owner = ${input.ownerLogin},
          branch_head_is_cross_repository = ${input.isCrossRepository ? 1 : 0}
        WHERE thread_id = ${input.threadId}
          AND branch_event_id = ${input.branchEventId}
      `,
  });

  const upsert: ProjectionThreadRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.upsert:query")),
    );

  const getById: ProjectionThreadRepositoryShape["getById"] = (input) =>
    getProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.getById:query")),
    );

  const listAll: ProjectionThreadRepositoryShape["listAll"] = () =>
    listAllProjectionThreadRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listAll:query")),
    );

  const listByProjectId: ProjectionThreadRepositoryShape["listByProjectId"] = (input) =>
    listProjectionThreadRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listByProjectId:query")),
    );

  const recordBranchHead: ProjectionThreadRepositoryShape["recordBranchHead"] = (input) =>
    recordProjectionThreadBranchHead(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.recordBranchHead:query")),
    );

  const deleteById: ProjectionThreadRepositoryShape["deleteById"] = (input) =>
    deleteProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    listByProjectId,
    recordBranchHead,
    deleteById,
  } satisfies ProjectionThreadRepositoryShape;
});

export const ProjectionThreadRepositoryLive = Layer.effect(
  ProjectionThreadRepository,
  makeProjectionThreadRepository,
);
