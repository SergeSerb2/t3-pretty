/**
 * ProjectionAutomationRunRepository - Projection repository interface for
 * automation run rows. Pages are keyset-ordered on
 * `(requested_at DESC, run_id DESC)`, the same order the runs index uses.
 *
 * @module ProjectionAutomationRunRepository
 */
import {
  AutomationId,
  AutomationRun,
  AutomationRunId,
  IsoDateTime,
  PositiveInt,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAutomationRun = AutomationRun;
export type ProjectionAutomationRun = typeof ProjectionAutomationRun.Type;

export const GetProjectionAutomationRunInput = Schema.Struct({
  runId: AutomationRunId,
});
export type GetProjectionAutomationRunInput = typeof GetProjectionAutomationRunInput.Type;

export const AutomationRunPageCursor = Schema.Struct({
  requestedAt: IsoDateTime,
  runId: AutomationRunId,
});
export type AutomationRunPageCursor = typeof AutomationRunPageCursor.Type;

export const ListProjectionAutomationRunsPageInput = Schema.Struct({
  automationId: AutomationId,
  limit: PositiveInt,
  /** Exclusive: rows strictly older than this `(requestedAt, runId)` pair. */
  before: Schema.optional(AutomationRunPageCursor),
});
export type ListProjectionAutomationRunsPageInput =
  typeof ListProjectionAutomationRunsPageInput.Type;

export const AutomationRunRetentionInput = Schema.Struct({
  automationId: AutomationId,
  /** Newest rows to keep. */
  keep: PositiveInt,
});
export type AutomationRunRetentionInput = typeof AutomationRunRetentionInput.Type;

export const DeleteProjectionAutomationRunsInput = Schema.Struct({
  automationId: AutomationId,
});
export type DeleteProjectionAutomationRunsInput = typeof DeleteProjectionAutomationRunsInput.Type;

export interface ProjectionAutomationRunRepositoryShape {
  readonly upsert: (row: ProjectionAutomationRun) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionAutomationRunInput,
  ) => Effect.Effect<Option.Option<ProjectionAutomationRun>, ProjectionRepositoryError>;

  /** Newest first. */
  readonly listPage: (
    input: ListProjectionAutomationRunsPageInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAutomationRun>, ProjectionRepositoryError>;

  /** Drop rows older than the newest `keep`. */
  readonly pruneBeyond: (
    input: AutomationRunRetentionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly deleteByAutomationId: (
    input: DeleteProjectionAutomationRunsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionAutomationRunRepository extends Context.Service<
  ProjectionAutomationRunRepository,
  ProjectionAutomationRunRepositoryShape
>()("t3/persistence/Services/ProjectionAutomationRuns/ProjectionAutomationRunRepository") {}
