import * as Schema from "effect/Schema";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderNativeSessionId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderModelId } from "./model.ts";
import {
  ChatAttachment,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  TurnDeliveryMode,
  THREAD_TURN_START_PATH_MAX_LENGTH,
  THREAD_TURN_START_TITLE_MAX_LENGTH,
} from "./orchestration.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";
import { ResolvedSubagentPolicy } from "./subagentPolicy.ts";

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

export const PROVIDER_SESSION_ERROR_MAX_LENGTH = 64 * 1024;
const ProviderSessionPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_TURN_START_PATH_MAX_LENGTH),
);
const ProviderSessionTitle = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_TURN_START_TITLE_MAX_LENGTH),
);
const ProviderSessionError = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SESSION_ERROR_MAX_LENGTH),
);

export function normalizeProviderSessionError(value: string): string {
  return value.trim().slice(0, PROVIDER_SESSION_ERROR_MAX_LENGTH) || "Provider session failed.";
}

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  // populates it (post-slice-4), routing flips to instance-id-only and the
  // legacy `provider` field is removed.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(ProviderSessionPath),
  model: Schema.optional(ProviderModelId),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(ProviderSessionError),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: Schema.optional(ProviderSessionPath),
  title: Schema.optional(ProviderSessionTitle),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  nativeSessionId: Schema.optional(ProviderNativeSessionId),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  runtimeMode: RuntimeMode,
  // Resolved at turn start. Claude applies the child model via session env
  // on new sessions; other adapters ignore this and use the turn hint.
  subagentPolicy: Schema.optional(ResolvedSubagentPolicy),
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
  // The user's delivery intent. Adapters whose provider session may lag the
  // orchestration view (Codex) must not steer a message sent with "queue".
  delivery: Schema.optional(TurnDeliveryMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

export const ProviderUploadFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderUploadFeedbackInput = typeof ProviderUploadFeedbackInput.Type;

export const ProviderUploadFeedbackResult = Schema.Struct({
  feedbackId: TrimmedNonEmptyString,
});
export type ProviderUploadFeedbackResult = typeof ProviderUploadFeedbackResult.Type;

export class ProviderUploadFeedbackError extends Schema.TaggedErrorClass<ProviderUploadFeedbackError>()(
  "ProviderUploadFeedbackError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to upload feedback for thread ${this.threadId}.`;
  }
}

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
