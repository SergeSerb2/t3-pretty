import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

function activity(payload: Record<string, unknown>): OrchestrationThreadActivity {
  return {
    id: "activity-1",
    tone: "tool",
    kind: "tool.completed",
    summary: "Tool",
    payload,
    turnId: null,
    createdAt: "2026-08-01T10:00:00.000Z",
  } as unknown as OrchestrationThreadActivity;
}

/**
 * Wire-survival regression: the slimming pass rewrites payload.data but must
 * never strip the top-level per-agent fields the subagent fold depends on.
 * If slimming ever moves to an allowlist over the whole payload, these
 * assertions are the tripwire.
 */
describe("projectActivityPayload", () => {
  it("preserves tool attribution (agentId/parentToolUseId) through data slimming", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        agentId: "task-123",
        parentToolUseId: "toolu_abc",
        data: {
          toolName: "Bash",
          input: { command: "ls" },
          command: "ls",
          rawOutput: { content: "x".repeat(10) },
          somethingClientNeverReads: { big: "blob" },
        },
      }),
    );
    const payload = projected.payload as Record<string, unknown>;
    expect(payload.agentId).toBe("task-123");
    expect(payload.parentToolUseId).toBe("toolu_abc");
    // Slimming itself still applies to data.
    const data = payload.data as Record<string, unknown>;
    expect(data.toolName).toBe("Bash");
    expect(data.somethingClientNeverReads).toBeUndefined();
  });

  it("preserves non-MCP tool names used by the subagent activity feed", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "dynamic_tool_call",
        agentId: "task-123",
        data: {
          toolName: "Read",
          toolCallId: "tool-read-1",
          input: { file_path: "/tmp/app.ts" },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.toolName).toBe("Read");
    expect(data.toolCallId).toBe("tool-read-1");
  });

  it("keeps a bounded Codex command output summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          item: {
            command: "/bin/zsh -lc 'printf hello'",
            aggregatedOutput: `hello from codex\n${"x".repeat(5000)}`,
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.item).toEqual({
      command: "/bin/zsh -lc 'printf hello'",
      aggregatedOutput: "hello from codex",
    });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("keeps bounded Claude and ACP command output summaries", () => {
    const claude = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          command: "printf hello",
          rawOutput: { stdout: `hello from claude\n${"y".repeat(5000)}` },
        },
      }),
    );
    const acp = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: {
          command: "printf hello",
          content: [
            {
              type: "content",
              content: { type: "text", text: `hello from acp\n${"z".repeat(5000)}` },
            },
          ],
        },
      }),
    );

    const claudeData = (claude.payload as Record<string, unknown>).data as Record<string, unknown>;
    const acpData = (acp.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(claudeData.rawOutput).toEqual({ content: "hello from claude" });
    expect(acpData.rawOutput).toEqual({ content: "hello from acp" });
    expect(JSON.stringify(claude.payload).length).toBeLessThan(500);
    expect(JSON.stringify(acp.payload).length).toBeLessThan(500);
  });

  it("normalizes Claude and OpenCode command inputs before slimming provider data", () => {
    const claude = projectActivityPayload(
      activity({
        itemType: "command_execution",
        toolCallId: "claude-call-1",
        data: {
          toolName: "Bash",
          input: { command: "vp test run" },
          result: { content: "x".repeat(5_000) },
        },
      }),
    );
    const openCode = projectActivityPayload(
      activity({
        itemType: "command_execution",
        toolCallId: "opencode-call-1",
        data: {
          tool: "bash",
          state: {
            status: "running",
            input: { command: "vp lint" },
            output: "x".repeat(5_000),
          },
        },
      }),
    );

    expect(claude.payload).toMatchObject({
      toolCallId: "claude-call-1",
      data: { command: "vp test run" },
    });
    expect(openCode.payload).toMatchObject({
      toolCallId: "opencode-call-1",
      data: { command: "vp lint" },
    });
    expect(JSON.stringify(claude.payload).length).toBeLessThan(200);
    expect(JSON.stringify(openCode.payload).length).toBeLessThan(200);
  });

  it("slims Codex-shaped mcp_tool_call items to rendered fields plus a result summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          item: {
            type: "mcpToolCall",
            id: "item-1",
            tool: "fetch_pr",
            server: "github",
            status: "completed",
            arguments: { pr: 42 },
            durationMs: 1200,
            result: {
              content: [{ type: "text", text: `PR body line one\n${"x".repeat(5000)}` }],
              structuredContent: { huge: "y".repeat(5000) },
            },
            _meta: { internal: true },
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const item = data.item as Record<string, unknown>;
    expect(item.tool).toBe("fetch_pr");
    expect(item.server).toBe("github");
    expect(item.arguments).toEqual({ pr: 42 });
    expect(item._meta).toBeUndefined();
    expect(item.result).toEqual({ content: "PR body line one" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("slims Claude-shaped mcp_tool_call data without retaining unbounded input", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__github__fetch_pr",
          input: { path: "apps/server/src/index.ts", body: "x".repeat(1_000_000) },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: `first line of output\n${"z".repeat(5000)}` }],
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.toolName).toBe("mcp__github__fetch_pr");
    expect(data.input).toBeUndefined();
    expect(data.files).toEqual([{ path: "apps/server/src/index.ts" }]);
    expect(data.result).toEqual({ content: "first line of output" });
    expect(JSON.stringify(projected.payload).length).toBeLessThan(500);
  });

  it("normalizes small Claude MCP input to arguments for client rendering", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__t3-code__preview_click",
          input: { locator: "role=button[name='Send']" },
          result: { content: [{ type: "text", text: "{}" }] },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.arguments).toEqual({ locator: "role=button[name='Send']" });
    expect(data.input).toBeUndefined();
  });

  it("drops oversized Codex MCP arguments instead of shipping them", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          item: {
            type: "mcpToolCall",
            id: "item-1",
            tool: "preview_evaluate",
            server: "t3-code",
            status: "completed",
            arguments: { expression: "e".repeat(50_000) },
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;
    const item = data.item as Record<string, unknown>;
    expect(item.tool).toBe("preview_evaluate");
    expect(item.arguments).toBeUndefined();
  });

  it("keeps first-line summary semantics across MCP text blocks", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: {
          toolName: "mcp__github__fetch_pr",
          result: {
            content: [
              { type: "text", text: "  ```  " },
              { type: "image", data: "discarded" },
              { type: "text", text: "  first   useful\tline  \nsecond line" },
            ],
          },
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.result).toEqual({ content: "first useful line" });
  });

  it("preserves fence-only and long-line raw output summaries", () => {
    const fenceOnly = projectActivityPayload(
      activity({ itemType: "command_execution", data: { rawOutput: { content: "```\n```" } } }),
    );
    const longLine = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: { rawOutput: { content: `first ${"x".repeat(1_000_000)}` } },
      }),
    );
    const fenceData = (fenceOnly.payload as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const longData = (longLine.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(fenceData.rawOutput).toEqual({ content: "2 lines" });
    expect(longData.rawOutput).toEqual({ content: `first ${"x".repeat(77)}…` });
  });

  it("falls back to stdout when content has no meaningful summary", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "command_execution",
        data: { rawOutput: { content: " \n\t ", stdout: " useful   stdout " } },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.rawOutput).toEqual({ content: "useful stdout" });
  });

  it("bounds MCP block scanning when no renderable text is near the front", () => {
    let textReads = 0;
    const content = Array.from({ length: 1_000 }, () => {
      const block: Record<string, unknown> = { type: "image" };
      Object.defineProperty(block, "text", {
        get() {
          textReads += 1;
          return undefined;
        },
      });
      return block;
    });

    const projected = projectActivityPayload(
      activity({
        itemType: "mcp_tool_call",
        data: { toolName: "mcp__images__inspect", result: { content } },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.result).toBeUndefined();
    expect(textReads).toBeLessThanOrEqual(256);
  });

  it("bounds changed-file traversal for pathless collections", () => {
    let pathReads = 0;
    const files = Array.from({ length: 10_000 }, () => {
      const file: Record<string, unknown> = {};
      Object.defineProperty(file, "path", {
        get() {
          pathReads += 1;
          return undefined;
        },
      });
      return file;
    });

    const projected = projectActivityPayload(
      activity({ itemType: "dynamic_tool_call", data: { toolName: "Read", files } }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.files).toBeUndefined();
    expect(pathReads).toBeLessThanOrEqual(512);
  });

  it("finds direct file siblings before traversing large generic payloads", () => {
    const projected = projectActivityPayload(
      activity({
        itemType: "dynamic_tool_call",
        data: {
          toolName: "Edit",
          input: Array.from({ length: 10_000 }, () => ({})),
          files: [{ path: "apps/mobile/src/App.tsx" }],
        },
      }),
    );
    const data = (projected.payload as Record<string, unknown>).data as Record<string, unknown>;

    expect(data.files).toEqual([{ path: "apps/mobile/src/App.tsx" }]);
  });

  it("passes task lifecycle payloads (no data field) through untouched", () => {
    const source = activity({
      taskId: "task-9",
      title: "Audit auth",
      role: "explorer",
      model: "opus",
      effort: "high",
      workflowName: "audit-flow",
      phases: [{ index: 0, title: "Audit" }],
      typedUsage: { totalTokens: 1200 },
      runHandles: { runId: "run-1", scriptPath: "/tmp/wf.js" },
      timelineBypass: true,
    });
    const projected = projectActivityPayload(source);
    expect(projected.payload).toEqual(source.payload);
  });
});
