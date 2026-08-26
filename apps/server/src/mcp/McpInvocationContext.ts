import {
  ComputerUseError,
  type EnvironmentId,
  McpCapabilityUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability = "computer-use" | "preview";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

export const requireMcpCapability = Effect.fn("mcp.requireCapability")(function* <E>(
  capability: McpCapability,
  unavailable: (invocation: McpInvocationScope) => E,
) {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has(capability)) {
    return yield* Effect.fail(unavailable(invocation));
  }
  return invocation;
});

export const requirePreviewCapability = () =>
  requireMcpCapability(
    "preview",
    (invocation) =>
      new McpCapabilityUnavailableError({
        capability: "preview",
        environmentId: invocation.environmentId,
        threadId: invocation.threadId,
        providerSessionId: invocation.providerSessionId,
        providerInstanceId: invocation.providerInstanceId,
      }),
  );

export const requireComputerUseCapability = () =>
  requireMcpCapability(
    "computer-use",
    () =>
      new ComputerUseError({
        reason: "capability-unavailable",
        message: "This MCP credential does not grant computer control.",
      }),
  );
