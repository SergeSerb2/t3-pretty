import {
  AutomationsError,
  ComputerUseError,
  type EnvironmentId,
  McpCapabilityUnavailableError,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability =
  | "automations"
  | "computer-use"
  | "preview"
  | "pull-requests";

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

export const hasMcpCapability = (
  invocation: McpInvocationScope,
  capability: McpCapability,
): boolean => invocation.capabilities.has(capability);

/** The error a missing capability surfaces as; preview keeps its own so the broker can route it. */
export type McpCapabilityError<C extends McpCapability> = C extends "preview"
  ? PreviewAutomationUnavailableError
  : McpCapabilityUnavailableError;

const missingCapability = (
  invocation: McpInvocationScope,
  capability: McpCapability,
): PreviewAutomationUnavailableError | McpCapabilityUnavailableError => {
  const fields = {
    environmentId: invocation.environmentId,
    threadId: invocation.threadId,
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  };
  return capability === "preview"
    ? new PreviewAutomationUnavailableError({ capability, ...fields })
    : new McpCapabilityUnavailableError({ capability, ...fields });
};

export function requireMcpCapability<const C extends McpCapability>(
  capability: C,
): Effect.Effect<McpInvocationScope, McpCapabilityError<C>, McpInvocationContext>;
export function requireMcpCapability<E>(
  capability: McpCapability,
  unavailable: (invocation: McpInvocationScope) => E,
): Effect.Effect<McpInvocationScope, E, McpInvocationContext>;
export function requireMcpCapability<E>(
  capability: McpCapability,
  unavailable?: (invocation: McpInvocationScope) => E,
): Effect.Effect<McpInvocationScope, unknown, McpInvocationContext> {
  return Effect.flatMap(McpInvocationContext, (invocation) => {
    if (hasMcpCapability(invocation, capability)) {
      return Effect.succeed(invocation);
    }
    return Effect.fail(
      unavailable === undefined
        ? missingCapability(invocation, capability)
        : unavailable(invocation),
    );
  }).pipe(Effect.withSpan("mcp.requireCapability"));
}

export const requirePreviewCapability = () =>
  requireMcpCapability("preview");

export const requireComputerUseCapability = () =>
  requireMcpCapability(
    "computer-use",
    () =>
      new ComputerUseError({
        reason: "capability-unavailable",
        message: "This MCP credential does not grant computer control.",
      }),
  );

export const requireAutomationsCapability = () =>
  requireMcpCapability(
    "automations",
    () =>
      new AutomationsError({
        operation: "capability",
        message: "This MCP credential does not grant automation management.",
      }),
  );
