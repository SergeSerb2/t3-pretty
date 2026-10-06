import * as Schema from "effect/Schema";

import { RuntimeRequestId, ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

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
  requestId: RuntimeRequestId,
  response: ThreadSecretRequestResponse,
});
export type ThreadSecretRequestRespondInput = typeof ThreadSecretRequestRespondInput.Type;

export const ThreadSecretRequestRespondResult = Schema.Struct({
  /** The environment variable name the value was stored under, when provided. */
  name: Schema.String,
});
export type ThreadSecretRequestRespondResult = typeof ThreadSecretRequestRespondResult.Type;

/**
 * The user's answer to an agent's request for a secret. A saved value is kept
 * by the server under a one-use SecretRef; the thread learns only the status.
 */
export const SecretRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({ type: Schema.Literal("save"), secret: TrimmedNonEmptyString }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type SecretRequestAnswerInput = typeof SecretRequestAnswerInput.Type;

const SECRET_REQUEST_FAILURE_MESSAGES = {
  "unknown-request": "This API key request no longer exists.",
  "persist-failed": "Could not store the API key.",
  load_failed: "Could not load the secret request.",
  not_found: "This secret request no longer exists.",
  already_answered: "This secret request was already answered.",
  agent_stopped: "The agent that asked has stopped, so this secret can't be used.",
  store_failed: "Could not store the secret.",
  record_failed: "Saved the secret, but could not update the request.",
  invalid_ref: "That secretRef is not valid.",
  read_failed: "Could not read the secret.",
  ref_unavailable:
    "That secretRef was already used or does not exist. Ask the user again with request_secret.",
  ref_expired: "That secretRef expired. Ask the user again with request_secret.",
  consume_failed: "Could not use that secretRef. Try again.",
} as const;

export const SecretRequestFailureReason = Schema.Literals(
  Object.keys(SECRET_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof SECRET_REQUEST_FAILURE_MESSAGES
  >,
);
export type SecretRequestFailureReason = typeof SecretRequestFailureReason.Type;

/** Answering a request or using its ref failed; the message is shown to users and agents. */
export class SecretRequestError extends Schema.TaggedError<SecretRequestError>()(
  "SecretRequestError",
  {
    reason: SecretRequestFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return SECRET_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
