/**
 * ProjectionAutomationRepository - Projection repository interface for
 * automation definitions plus their derived shell state (next run, active
 * run, last run, counters). `webhookPath` is derived on read, not stored.
 *
 * @module ProjectionAutomationRepository
 */
import {
  Automation,
  AutomationActiveRun,
  AutomationId,
  AutomationLastRun,
  AutomationRunTrigger,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAutomation = Schema.Struct({
  ...Automation.fields,
  nextRunAt: Schema.NullOr(IsoDateTime),
  activeRun: Schema.NullOr(AutomationActiveRun),
  lastRun: Schema.NullOr(AutomationLastRun),
  lastRequestedAt: Schema.NullOr(IsoDateTime),
  pendingTrigger: Schema.NullOr(AutomationRunTrigger),
  consecutiveFailures: NonNegativeInt,
  runCount: NonNegativeInt,
});
export type ProjectionAutomation = typeof ProjectionAutomation.Type;

export const GetProjectionAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type GetProjectionAutomationInput = typeof GetProjectionAutomationInput.Type;

export const ListProjectionAutomationsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionAutomationsByProjectInput =
  typeof ListProjectionAutomationsByProjectInput.Type;

export interface ProjectionAutomationRepositoryShape {
  /** Insert or replace a projected automation row by `id`. */
  readonly upsert: (row: ProjectionAutomation) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionAutomationInput,
  ) => Effect.Effect<Option.Option<ProjectionAutomation>, ProjectionRepositoryError>;

  /** Every automation row, in creation order. */
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionAutomation>,
    ProjectionRepositoryError
  >;

  readonly listByProjectId: (
    input: ListProjectionAutomationsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAutomation>, ProjectionRepositoryError>;

  /** Hard delete; run rows are removed separately by the runs repository. */
  readonly deleteById: (
    input: GetProjectionAutomationInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionAutomationRepository extends Context.Service<
  ProjectionAutomationRepository,
  ProjectionAutomationRepositoryShape
>()("t3/persistence/Services/ProjectionAutomations/ProjectionAutomationRepository") {}
