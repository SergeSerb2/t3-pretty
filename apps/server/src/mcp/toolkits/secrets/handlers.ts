import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as SecretRequestBroker from "../../SecretRequestBroker.ts";
import { type RequestApiKeyResult, SecretRequestPendingError, SecretsToolkit } from "./tools.ts";

/** What the agent is told once the prompt settles. Exported so the wording is testable. */
export function describeSecretRequestOutcome(
  outcome: SecretRequestBroker.SecretRequestOutcome,
): RequestApiKeyResult {
  switch (outcome.status) {
    case "provided":
      return {
        status: "provided",
        name: outcome.name,
        secretPath: outcome.secretPath,
        instructions: `${outcome.name} is stored as a sensitive global environment variable and is injected into every agent and terminal process T3 Code starts from now on. Your current process started before it existed, so for this session load it into a shell first, for example: export ${outcome.name}="$(cat '${outcome.secretPath}')". Never cat, echo, or otherwise print the value, and never commit it.`,
      };
    case "declined":
      return {
        status: "declined",
        name: outcome.name,
        instructions: `The user declined to provide ${outcome.name}. Do not ask again in this turn; explain what cannot be done without it and continue with the rest of the task.`,
      };
    case "timed_out":
      return {
        status: "timed_out",
        name: outcome.name,
        instructions: `The user did not answer the ${outcome.name} prompt in time. Tell the user the key is still needed and stop; they can add it under Settings, Providers, Global environment variables, or you can ask again in a later turn.`,
      };
    case "cancelled":
      return {
        status: "cancelled",
        name: outcome.name,
        instructions: `The turn ended before the user answered the ${outcome.name} prompt.`,
      };
  }
}

const make = Effect.gen(function* () {
  const broker = yield* SecretRequestBroker.SecretRequestBroker;

  return SecretsToolkit.of({
    request_api_key: (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("secrets");
        const outcome = yield* broker
          .request({
            scope,
            name: input.name,
            purpose: input.purpose,
            service: input.service,
          })
          .pipe(
            Effect.catchTag("SecretRequestPendingError", () =>
              Effect.fail(new SecretRequestPendingError({})),
            ),
          );
        return describeSecretRequestOutcome(outcome);
      }),
  });
});

export const SecretsToolkitHandlersLive = SecretsToolkit.toLayer(make);
