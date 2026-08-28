import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationProject, OrchestrationThread } from "./orchestration.ts";

// Stays below the server's 128 MiB HTTP body ceiling and common managed-tunnel
// request limits. Dependency/build caches are excluded before compression.
export const PROJECT_TRANSFER_MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
export const PROJECT_TRANSFER_UPLOAD_URL_TTL_MS = 60 * 60_000;

export const ProjectTransferManifest = Schema.Struct({
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  project: OrchestrationProject,
  thread: OrchestrationThread,
  includesGitMetadata: Schema.Boolean,
  skippedAttachmentCount: NonNegativeInt,
});
export type ProjectTransferManifest = typeof ProjectTransferManifest.Type;

export const ProjectTransferInspectInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProjectTransferInspectInput = typeof ProjectTransferInspectInput.Type;

export const ProjectTransferInspectResult = Schema.Struct({
  manifest: ProjectTransferManifest,
});
export type ProjectTransferInspectResult = typeof ProjectTransferInspectResult.Type;

export const ProjectTransferPrepareInput = Schema.Struct({
  manifest: ProjectTransferManifest,
});
export type ProjectTransferPrepareInput = typeof ProjectTransferPrepareInput.Type;

export const ProjectTransferPrepareResult = Schema.Struct({
  transferId: TrimmedNonEmptyString,
  relativeUrl: TrimmedNonEmptyString,
  destinationPath: TrimmedNonEmptyString,
  expiresAt: Schema.Number,
});
export type ProjectTransferPrepareResult = typeof ProjectTransferPrepareResult.Type;

export const ProjectTransferSendInput = Schema.Struct({
  threadId: ThreadId,
  expectedUpdatedAt: IsoDateTime,
  destinationUrl: TrimmedNonEmptyString,
});
export type ProjectTransferSendInput = typeof ProjectTransferSendInput.Type;

export const ProjectTransferResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  workspaceRoot: TrimmedNonEmptyString,
});
export type ProjectTransferResult = typeof ProjectTransferResult.Type;

export const ProjectTransferCancelInput = Schema.Struct({
  transferId: TrimmedNonEmptyString,
});
export type ProjectTransferCancelInput = typeof ProjectTransferCancelInput.Type;

export const ProjectTransferCancelResult = Schema.Struct({
  cancelled: Schema.Boolean,
});
export type ProjectTransferCancelResult = typeof ProjectTransferCancelResult.Type;

const ProjectTransferErrorReason = Schema.Literals([
  "thread_not_found",
  "thread_busy",
  "thread_changed",
  "workspace_not_found",
  "destination_unavailable",
  "archive_failed",
  "archive_too_large",
  "upload_failed",
]);

const PROJECT_TRANSFER_ERROR_DETAIL_MAX_LENGTH = 4_096;

export class ProjectTransferError extends Schema.TaggedErrorClass<ProjectTransferError>()(
  "ProjectTransferError",
  {
    reason: ProjectTransferErrorReason,
    detail: Schema.String.check(Schema.isMaxLength(PROJECT_TRANSFER_ERROR_DETAIL_MAX_LENGTH)),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly reason: typeof ProjectTransferErrorReason.Type;
    readonly detail: string;
  }) {
    super({
      reason: props.reason,
      detail: props.detail.slice(0, PROJECT_TRANSFER_ERROR_DETAIL_MAX_LENGTH),
    } as any);
  }

  override get message(): string {
    return this.detail;
  }
}
