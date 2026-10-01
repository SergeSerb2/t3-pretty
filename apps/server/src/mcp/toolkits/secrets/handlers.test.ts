import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as SecretRequestBroker from "../../SecretRequestBroker.ts";
import { describeSecretRequestOutcome, SecretsToolkitHandlersLive } from "./handlers.ts";
import { SecretsToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-1");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeHarness = (outcome: SecretRequestBroker.SecretRequestOutcome) =>
  Effect.gen(function* () {
    const requests: SecretRequestBroker.SecretRequestInput[] = [];
    const brokerLayer = Layer.mock(SecretRequestBroker.SecretRequestBroker)({
      request: (input) =>
        Effect.sync(() => {
          requests.push(input);
          return outcome;
        }),
    });
    const toolkit = yield* SecretsToolkit.pipe(
      Effect.provide(SecretsToolkitHandlersLive.pipe(Layer.provide(brokerLayer))),
    );
    const call = (
      params: Parameters<typeof toolkit.handle<"request_api_key">>[1],
      capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["secrets"],
    ) =>
      toolkit.handle("request_api_key", params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map(
          (chunk) =>
            chunk.at(-1)!.result as Tool.Success<typeof SecretsToolkit.tools.request_api_key>,
        ),
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
        Effect.provide(brokerLayer),
      );
    return { requests, call };
  });

describe("SecretsToolkit", () => {
  it.effect("forwards the prompt to the broker and describes the outcome", () =>
    Effect.gen(function* () {
      const { requests, call } = yield* makeHarness({
        status: "provided",
        name: "OPENAI_API_KEY",
        secretPath: "/tmp/secrets/global-env-abc.bin",
      });
      const result = yield* call({
        name: "OPENAI_API_KEY",
        purpose: "Call the OpenAI API.",
        service: "OpenAI",
      });
      expect(requests).toEqual([
        {
          scope: invocation(["secrets"]),
          name: "OPENAI_API_KEY",
          purpose: "Call the OpenAI API.",
          service: "OpenAI",
        },
      ]);
      expect(result.status).toBe("provided");
      expect(result.secretPath).toBe("/tmp/secrets/global-env-abc.bin");
      expect(result.instructions).toContain(
        `export OPENAI_API_KEY="$(cat '/tmp/secrets/global-env-abc.bin')"`,
      );
    }),
  );

  it.effect("rejects a credential without the secrets capability", () =>
    Effect.gen(function* () {
      const { requests, call } = yield* makeHarness({ status: "declined", name: "KEY" });
      const error = yield* call({ name: "KEY", purpose: "Why." }, ["pull-requests"]).pipe(
        Effect.flip,
      );
      expect(error).toMatchObject({ _tag: "McpCapabilityUnavailableError", capability: "secrets" });
      expect(requests).toEqual([]);
    }),
  );

  it("tells the agent not to retry after a decline and never to print the value", () => {
    expect(
      describeSecretRequestOutcome({ status: "declined", name: "KEY" }).instructions,
    ).toContain("Do not ask again in this turn");
    expect(
      describeSecretRequestOutcome({ status: "provided", name: "KEY", secretPath: "/p" })
        .instructions,
    ).toContain("Never cat, echo, or otherwise print the value");
  });
});
