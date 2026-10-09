import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS,
} from "@t3tools/contracts";

import * as McpProviderSession from "@t3tools/provider-core/server/mcpSession";
import { cursorMcpServers, cursorRuntimeAgentPolicy } from "./CursorAdapterV2.ts";
import { claudeMcpQueryOverrides } from "./ClaudeAdapterV2.ts";
import { codexThreadRuntimeParams, normalizeCodexUserInputQuestions } from "./CodexAdapterV2.ts";
import { museSessionMcpConfig } from "./MuseAdapterV2.ts";
import { buildPiRpcLaunch } from "@t3tools/provider-pi/server/mcpInjection";
import { grokAcpSpawnArgs } from "../../provider/acp/GrokAcpSupport.ts";
import { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import { T3_MCP_SERVERS_ENV } from "@t3tools/provider-pi/server/mcpExtensionSource";

const threadId = ThreadId.make("fork-provider-mcp-thread");
const session: McpProviderSession.McpProviderSessionConfig = {
  environmentId: EnvironmentId.make("fork-provider-mcp-environment"),
  threadId,
  providerSessionId: "fork-provider-mcp-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
  endpoint: "http://127.0.0.1:43000/mcp",
  authorizationHeader: "Bearer scoped-test-token",
  capabilities: new Set(["preview", "computer-use", "automations"]),
  preview: true,
  browserToolsAvailable: true,
  servers: [
    { name: "t3-code", url: "http://127.0.0.1:43000/mcp" },
    { name: "t3-code-computer", url: "http://127.0.0.1:43000/mcp/computer-use" },
    { name: "connected-app", url: "http://127.0.0.1:43000/mcp/apps/example" },
  ],
};

describe("fork provider workflows on V2", () => {
  it("keeps every granted toolkit and connected app on SDK and Codex sessions", () => {
    McpProviderSession.setMcpProviderSession(session);
    try {
      const cursor = cursorMcpServers(threadId);
      const claude = claudeMcpQueryOverrides({ threadId, readOnlySandbox: false });
      const codex = codexThreadRuntimeParams({ threadId }).config.mcp_servers;
      const muse = museSessionMcpConfig(session).mcpServers;
      const expectedNames = session.servers.map((server) => server.name);
      assert.deepEqual(Object.keys(cursor ?? {}), expectedNames);
      assert.deepEqual(Object.keys(claude.mcpServers ?? {}), expectedNames);
      assert.deepEqual(Object.keys((codex ?? {}) as Record<string, unknown>), expectedNames);
      assert.deepEqual(Object.keys(muse), expectedNames);
      for (const server of session.servers) {
        assert.deepInclude(cursor?.[server.name], { type: "http", url: server.url });
        assert.isTrue((claude.allowedTools ?? []).includes(`mcp__${server.name}__*`));
        assert.deepInclude(muse[server.name], {
          transport: "streamableHttp",
          mode: "optional",
          url: server.url,
        });
      }
      const restricted = claudeMcpQueryOverrides({ threadId, readOnlySandbox: true });
      assert.isFalse((restricted.allowedTools ?? []).includes("mcp__t3-code-computer__*"));
      assert.isFalse((restricted.allowedTools ?? []).includes("mcp__connected-app__*"));
    } finally {
      McpProviderSession.clearMcpProviderSession(threadId);
    }
  });

  it("passes each granted server to the Pi extension and clears stale inherited entries", () => {
    const launch = buildPiRpcLaunch({
      launchArgs: [],
      environment: { [T3_MCP_SERVERS_ENV]: "stale" },
      mcpSession: session,
      extensionPath: "/tmp/t3-extension.ts",
    });
    assert.deepEqual(JSON.parse(launch.env[T3_MCP_SERVERS_ENV]!), session.servers);
    const detached = buildPiRpcLaunch({
      launchArgs: [],
      environment: launch.env,
      mcpSession: undefined,
      extensionPath: "/tmp/t3-extension.ts",
    });
    assert.isUndefined(detached.env[T3_MCP_SERVERS_ENV]);
  });

  it("keeps legacy yolo sessions at full access after migration", () => {
    const policy = ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "yolo",
      interactionMode: "default",
      cwd: "/repo",
    });
    assert.deepEqual(cursorRuntimeAgentPolicy(policy), {
      autoReview: false,
      sandboxEnabled: false,
    });
    assert.deepEqual(grokAcpSpawnArgs("yolo"), grokAcpSpawnArgs("full-access"));
  });

  it("rejects oversized and ambiguous Codex questions before persisting a request", () => {
    const question = {
      id: "question-1",
      header: "Mode",
      question: "Which mode?",
      options: [{ label: "Safe", description: "Use supervised mode" }],
    };
    assert.equal(normalizeCodexUserInputQuestions([question])?.[0]?.id, question.id);
    assert.isUndefined(normalizeCodexUserInputQuestions([question, question]));
    assert.isUndefined(normalizeCodexUserInputQuestions([{ ...question, id: " question-1 " }]));
    assert.isUndefined(
      normalizeCodexUserInputQuestions(
        Array.from({ length: PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS + 1 }, (_, index) => ({
          ...question,
          id: `question-${index}`,
        })),
      ),
    );
  });
});
