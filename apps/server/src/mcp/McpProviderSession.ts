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
export const T3_CODE_AUTOMATIONS_MCP_SERVER_NAME = "t3-code-automations";

export type McpProviderSessionCapability = McpCapability | "device";

export function builtInMcpServers(
  endpoint: string,
  capabilities: ReadonlySet<McpProviderSessionCapability>,
): ReadonlyArray<McpProviderSessionServer> {
  return [
    { name: T3_CODE_MCP_SERVER_NAME, url: endpoint },
    ...(capabilities.has("computer-use")
      ? [{ name: T3_CODE_COMPUTER_MCP_SERVER_NAME, url: `${endpoint}/computer-use` }]
      : []),
    ...(capabilities.has("automations")
      ? [{ name: T3_CODE_AUTOMATIONS_MCP_SERVER_NAME, url: `${endpoint}/automations` }]
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
  /** Capabilities the credential grants, including MCP toolkits and parent device access. */
  readonly capabilities: ReadonlySet<McpProviderSessionCapability>;
  /** Whether the credential grants the preview (browser) toolkit; the pull request toolkit always is. */
  readonly preview: boolean;
  /**
   * Every server to attach, in order: the built-in `t3-code` server, other
   * capability-specific built-in servers, then each attachable app behind the
   * `/mcp/apps/<id>` proxy. Adapters map this list into their own config dialect
   * and never consult `endpoint` directly.
   */
  readonly servers: ReadonlyArray<McpProviderSessionServer>;
  /**
   * Set when the session may drive devices. Adapters spread this into the
   * provider subprocess environment so the `agent-device` CLI is on PATH and
   * already pointed at the server's daemon; the agent never handles a token.
   */
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
}

/** Whether the built-in `t3-code` toolkit includes preview tools. */
export function hasBrowserTools(config: McpProviderSessionConfig | undefined): boolean {
  return config?.capabilities.has("preview") === true;
}

/** Whether the built-in `t3-code-computer` toolkit is attached. */
export function hasComputerTools(config: McpProviderSessionConfig | undefined): boolean {
  return config?.capabilities.has("computer-use") === true;
}

/** Provider env with the device variables applied over `base`, or `base` untouched. */
export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
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
