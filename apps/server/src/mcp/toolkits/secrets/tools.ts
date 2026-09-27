import {
  McpCapabilityUnavailableError,
  ProviderInstanceEnvironmentVariableName,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as SecretRequestBroker from "../../SecretRequestBroker.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  SecretRequestBroker.SecretRequestBroker,
];

export const REQUEST_API_KEY_PURPOSE_MAX_LENGTH = 500;

export const RequestApiKeyInput = Schema.Struct({
  name: ProviderInstanceEnvironmentVariableName.annotate({
    description:
      "Environment variable to store the key under, in the service's conventional name, for example OPENAI_API_KEY or STRIPE_SECRET_KEY.",
  }),
  purpose: TrimmedNonEmptyString.check(
    Schema.isMaxLength(REQUEST_API_KEY_PURPOSE_MAX_LENGTH),
  ).annotate({
    description:
      "One or two sentences telling the user what the key is for and what you will do with it. Shown verbatim.",
  }),
  service: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
      description: "Service the key belongs to, for example OpenAI. Used as the prompt title.",
    }),
  ),
});
export type RequestApiKeyInput = typeof RequestApiKeyInput.Type;

export const RequestApiKeyResult = Schema.Struct({
  status: Schema.Literals(["provided", "declined", "timed_out", "cancelled"]),
  name: Schema.String,
  /** Present when provided: a 0600 file with the raw value for shells started before the variable existed. */
  secretPath: Schema.optional(Schema.String),
  instructions: Schema.String,
});
export type RequestApiKeyResult = typeof RequestApiKeyResult.Type;

export class SecretRequestPendingError extends Schema.TaggedError<SecretRequestPendingError>()(
  "SecretRequestPendingError",
  {},
) {
  override get message(): string {
    return "Another API key request is already waiting on the user for this thread. Wait for it to resolve before asking again.";
  }
}

export const RequestApiKeyToolError = Schema.Union([
  McpCapabilityUnavailableError,
  SecretRequestPendingError,
]);

const RequestApiKeyTool = Tool.make("request_api_key", {
  description:
    "Ask the user for an API key or other secret you need to finish the task. T3 Code shows a masked prompt in the thread; the value is stored as a sensitive environment variable named `name` and is never returned to you or written to the conversation. Blocks until the user answers or dismisses the prompt (up to 10 minutes). Use it instead of asking for a key in a message, and never print or echo the value once you have it.",
  parameters: RequestApiKeyInput,
  success: RequestApiKeyResult,
  failure: RequestApiKeyToolError,
  dependencies,
})
  .annotate(Tool.Title, "Request an API key from the user")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const SecretsToolkit = Toolkit.make(RequestApiKeyTool);
