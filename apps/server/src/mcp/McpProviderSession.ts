import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/** One MCP server to attach to a provider session. All share the session's bearer. */
export interface McpProviderSessionServer {
  /** Server name as the provider will show it (`t3-code`, or an app slug). */
  readonly name: string;
  readonly url: string;
}

export const T3_CODE_MCP_SERVER_NAME = "t3-code";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  /** The built-in `t3-code` endpoint; `servers` decides whether it is attached. */
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /**
   * Every server to attach, in order: `t3-code` when agent browser access is
   * on, then each attachable app behind the `/mcp/apps/<id>` proxy. Adapters
   * map this list into their own config dialect and never consult
   * `endpoint` directly.
   */
  readonly servers: ReadonlyArray<McpProviderSessionServer>;
}

/** Whether the built-in `t3-code` toolkit (preview tools) is attached. */
export function hasBrowserTools(config: McpProviderSessionConfig | undefined): boolean {
  return config?.servers.some((server) => server.name === T3_CODE_MCP_SERVER_NAME) === true;
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
