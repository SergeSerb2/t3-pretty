import { expect, it } from "@effect/vitest";
import {
  AutomationsError,
  EnvironmentId,
  PreviewAutomationUnavailableError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "./McpInvocationContext.ts";

it("checks each scoped MCP capability independently", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-capabilities"),
    threadId: ThreadId.make("thread-capabilities"),
    providerSessionId: "provider-session-capabilities",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["preview"]),
    issuedAt: 1,
  };

  expect(McpInvocationContext.hasMcpCapability(invocation, "preview")).toBe(true);
  expect(McpInvocationContext.hasMcpCapability(invocation, "computer-use")).toBe(false);
  expect(McpInvocationContext.hasMcpCapability(invocation, "automations")).toBe(false);
});

it.effect("reports the scoped credential context when preview capability is unavailable", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requirePreviewCapability().pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(PreviewAutomationUnavailableError);
    expect(error).toMatchObject({
      capability: "preview",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
    expect(error.message).toBe("MCP credential does not grant the preview capability.");
  });
});

it.effect("names the missing capability when automations are not granted", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-2"),
    threadId: ThreadId.make("thread-2"),
    providerSessionId: "provider-session-2",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["preview"]),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireAutomationsCapability().pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(AutomationsError);
    expect(error.operation).toBe("capability");
  });
});
