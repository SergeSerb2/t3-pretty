import {
  ChatImageAttachment,
  ChatFileAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "./chatAttachment.ts";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;

export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
  "yolo",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";

export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;

export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;

export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;

export const ProviderApprovalOption = Schema.Struct({
  decision: ProviderApprovalDecision,
  label: TrimmedNonEmptyString,
  /** Provider-supplied caution shown next to the option, such as a prompt injection warning. */
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderApprovalOption = typeof ProviderApprovalOption.Type;

export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const UserInputAttachments = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Union([ChatImageAttachment, ChatFileAttachment])).pipe(
    Schema.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
);
export type UserInputAttachments = typeof UserInputAttachments.Type;

export const UserInputAttachmentAnswerPayload = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  questionTextById: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  answers: ProviderUserInputAnswers,
  attachmentsByQuestionId: UserInputAttachments,
});
export type UserInputAttachmentAnswerPayload = typeof UserInputAttachmentAnswerPayload.Type;

export const TurnDeliveryMode = Schema.Literals(["steer", "queue"]);
export type TurnDeliveryMode = typeof TurnDeliveryMode.Type;

export const PROVIDER_INTERACTION_MAX_KEY_LENGTH = 512;
export const PROVIDER_INTERACTION_MAX_STRING_CHARS = 1024 * 1024;
export const PROVIDER_INTERACTION_MAX_NODES = 4_096;
export const PROVIDER_INTERACTION_MAX_DEPTH = 32;

export const ProviderInteractionOpaquePayload = Schema.Unknown;
export type ProviderInteractionOpaquePayload = typeof ProviderInteractionOpaquePayload.Type;

export const THREAD_TURN_START_TITLE_MAX_LENGTH = 8_192;
export const THREAD_TURN_START_BRANCH_MAX_LENGTH = 4_096;
export const THREAD_TURN_START_PATH_MAX_LENGTH = 32 * 1024;
export const THREAD_TURN_START_MAX_ENABLED_SKILL_ID_CHARS = 2 * 1024 * 1024;


// "yolo" was Kimi-only. Remap it to generic "full-access" whenever the
// destination provider is known. A missing driver keeps the stored mode so
// a stale lookup cannot invent a different access level.
export function resolveRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  return runtimeMode === "yolo" && providerDriver != null && providerDriver !== "unconfigured"
    ? "full-access"
    : runtimeMode;
}

export function displayRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  return resolveRuntimeModeForProviderDriver(providerDriver, runtimeMode);
}

export function defaultRuntimeModeForProviderDriver(
  _providerDriver: string | null | undefined,
): RuntimeMode {
  return DEFAULT_RUNTIME_MODE;
}

// Compose the provider default with the historical yolo remap. Pass `null`
// when the mode is still unset so every driver inherits full-access.
export function effectiveRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode | null | undefined,
): RuntimeMode {
  return displayRuntimeModeForProviderDriver(
    providerDriver,
    runtimeMode ?? defaultRuntimeModeForProviderDriver(providerDriver),
  );
}
