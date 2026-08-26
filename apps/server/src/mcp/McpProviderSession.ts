import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import type { McpCapability } from "./McpInvocationContext.ts";

/** One MCP server to attach to a provider session. All share the session's bearer. */
export interface McpProviderSessionServer {
  /** Server name as the provider will show it (`t3-code`, or an app slug). */
  readonly name: string;
  readonly url: string;
}

export const T3_CODE_MCP_SERVER_NAME = "t3-code";
export const T3_CODE_COMPUTER_MCP_SERVER_NAME = "t3-code-computer";

export function builtInMcpServers(
  endpoint: string,
  capabilities: ReadonlySet<McpCapability>,
): ReadonlyArray<McpProviderSessionServer> {
  return [
    ...(capabilities.has("preview") ? [{ name: T3_CODE_MCP_SERVER_NAME, url: endpoint }] : []),
    ...(capabilities.has("computer-use")
      ? [{ name: T3_CODE_COMPUTER_MCP_SERVER_NAME, url: `${endpoint}/computer-use` }]
      : []),
  ];
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  /** Base endpoint for built-in tool servers and app proxies. */
  readonly endpoint: string;
  readonly authorizationHeader: string;
  readonly capabilities: ReadonlySet<McpCapability>;
  /**
   * Every server to attach, in order: capability-specific built-in servers,
   * then each attachable app behind the `/mcp/apps/<id>` proxy. Adapters map
   * this list into their own config dialect and never consult `endpoint`
   * directly.
   */
  readonly servers: ReadonlyArray<McpProviderSessionServer>;
}

/** Whether the built-in `t3-code` toolkit includes preview tools. */
export function hasBrowserTools(config: McpProviderSessionConfig | undefined): boolean {
  return config?.capabilities.has("preview") === true;
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}
