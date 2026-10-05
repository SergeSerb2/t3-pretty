import { ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSystemPrompt,
  t3ThreadMessageForProvider,
} from "./T3OrchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "ordinary top-level T3 conversations");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `t3_thread_send` on `childThreadId`",
    );
  });

  it("tells the receiving agent which thread sent a message", () => {
    const sender = ThreadId.make("thread-sender");
    const ordinary = {
      id: ThreadId.make("thread-receiver"),
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: sender },
    };
    const wrap = (
      text: string,
      message: Parameters<typeof t3ThreadMessageForProvider>[0]["message"],
      thread: Parameters<typeof t3ThreadMessageForProvider>[0]["thread"] = ordinary,
    ) => t3ThreadMessageForProvider({ text, message, thread });

    const peer = wrap("Which files did you touch?", { createdBy: "agent", senderThreadId: sender });
    assert.match(peer, /^<t3_thread_message from_thread_id="thread-sender">/);
    assert.include(peer, "only if this message asks for an answer");
    assert.isTrue(peer.endsWith("\n\nWhich files did you touch?"));

    // A fork's source is a peer, not the owner of a delegated task.
    const fork = {
      ...ordinary,
      lineage: {
        ...ordinary.lineage,
        parentThreadId: sender,
        relationshipToParent: "fork" as const,
      },
    };
    assert.notEqual(wrap("Hi", { createdBy: "agent", senderThreadId: sender }, fork), "Hi");

    // The parent of a delegated task already receives the result automatically.
    const child = {
      ...fork,
      lineage: { ...fork.lineage, relationshipToParent: "subagent" as const },
    };
    assert.equal(wrap("Task", { createdBy: "agent", senderThreadId: sender }, child), "Task");
    assert.equal(wrap("Hi", { createdBy: "user" }), "Hi");
    assert.equal(wrap("Check CI", { createdBy: "agent", senderThreadId: ordinary.id }), "Check CI");
    assert.equal(wrap("/compact", { createdBy: "agent", senderThreadId: sender }), "/compact");
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = t3OrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasT3Mcp: true,
    });

    assert.include(injected, "<t3_code_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasT3Mcp: true }),
      prompt,
    );
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasT3Mcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the T3 MCP server is attached", () => {
    assert.equal(t3OrchestrationSystemPrompt(false), undefined);
    assert.equal(t3OrchestrationSystemPrompt(true), T3_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = t3AcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasT3Mcp: true },
    });

    assert.include(injected, "T3 Code interaction mode: Default");
    assert.include(injected, "T3 Code collaborative browser");
    assert.include(injected, "T3 Code orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasT3Mcp: true } as const;

    assert.equal(
      t3AcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "T3 Code interaction mode: Plan",
    );
    const withoutMcp = t3AcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasT3Mcp: false },
    });
    assert.include(withoutMcp, "T3 Code interaction mode: Default");
    assert.notInclude(withoutMcp, "T3 Code collaborative browser");
    assert.notInclude(withoutMcp, "T3 Code orchestration");
  });
});
