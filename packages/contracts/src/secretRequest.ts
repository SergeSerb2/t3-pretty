import * as Schema from "effect/Schema";

import { ApprovalRequestId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Upper bound for a pasted API key. Matches the per-variable limit in provider environments. */
export const SECRET_REQUEST_VALUE_MAX_LENGTH = 16_384;

/**
 * Answer to an agent's API key prompt. The value travels only over this RPC
 * and into the secret store; it is never written to an orchestration event.
 */
export const ThreadSecretRequestResponse = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("provided"),
    value: TrimmedNonEmptyString.check(Schema.isMaxLength(SECRET_REQUEST_VALUE_MAX_LENGTH)),
  }),
  Schema.Struct({ kind: Schema.Literal("declined") }),
]);
export type ThreadSecretRequestResponse = typeof ThreadSecretRequestResponse.Type;

export const ThreadSecretRequestRespondInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  response: ThreadSecretRequestResponse,
});
export type ThreadSecretRequestRespondInput = typeof ThreadSecretRequestRespondInput.Type;

export const ThreadSecretRequestRespondResult = Schema.Struct({
  /** The environment variable name the value was stored under, when provided. */
  name: Schema.String,
});
export type ThreadSecretRequestRespondResult = typeof ThreadSecretRequestRespondResult.Type;

export class SecretRequestError extends Schema.TaggedError<SecretRequestError>()(
  "SecretRequestError",
  {
    reason: Schema.Literals(["unknown-request", "persist-failed"]),
    message: Schema.String,
  },
) {}
