import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  CLAUDE_SUBAGENT_MODEL_ENV,
  DEFAULT_SUBAGENT_POLICY_SETTINGS,
  deriveCheaperSiblingModel,
  renderSubagentPolicyInstructions,
  resolveSubagentPolicy,
  SubagentPolicySettings,
  ThreadSubagentPolicy,
} from "./subagentPolicy.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const grok = ProviderDriverKind.make("grok");
const codex = ProviderDriverKind.make("codex");
const instance = ProviderInstanceId.make("claudeAgent");
const grokInstance = ProviderInstanceId.make("grok");

const decodeSettings = Schema.decodeUnknownSync(SubagentPolicySettings);
const decodeThread = Schema.decodeUnknownSync(ThreadSubagentPolicy);

describe("SubagentPolicySettings", () => {
  it("defaults to spawning on with no instance pins", () => {
    expect(decodeSettings({})).toEqual(DEFAULT_SUBAGENT_POLICY_SETTINGS);
  });
});

describe("deriveCheaperSiblingModel", () => {
  it("renames Claude family slugs in place so OpenRouter ids stay valid", () => {
    expect(deriveCheaperSiblingModel(claude, "anthropic/claude-opus-4.6")).toBe(
      "anthropic/claude-sonnet-4.6",
    );
    expect(deriveCheaperSiblingModel(claude, "claude-sonnet-5")).toBe("claude-haiku-5");
    expect(deriveCheaperSiblingModel(claude, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("maps expensive Grok and Codex parents onto cheaper siblings", () => {
    expect(deriveCheaperSiblingModel(grok, "grok-4.6")).toBe("grok-build");
    expect(deriveCheaperSiblingModel(codex, "gpt-5.6-sol")).toBe("gpt-5.6-luna");
  });
});

describe("resolveSubagentPolicy", () => {
  it("inherits the global switch and a sibling child when nothing is pinned", () => {
    const resolved = resolveSubagentPolicy({
      parentModel: "claude-opus-4.6",
      parentInstanceId: instance,
      driver: claude,
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.source).toBe("global");
    expect(resolved.childSource).toBe("sibling");
    expect(resolved.child?.model).toBe("claude-sonnet-4.6");
    expect(resolved.bind).toBe("session-env");
    expect(CLAUDE_SUBAGENT_MODEL_ENV).toBe("CLAUDE_CODE_SUBAGENT_MODEL");
  });

  it("lets a thread turn spawning off without touching the global default", () => {
    const resolved = resolveSubagentPolicy({
      global: { enabled: true, children: {} },
      thread: decodeThread({ mode: "off" }),
      parentModel: "grok-4.6",
      parentInstanceId: grokInstance,
      driver: grok,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.source).toBe("thread");
    expect(resolved.child).toBeNull();
    expect(resolved.bind).toBe("hint");
  });

  it("prefers a thread pin, then a global instance pin, then the sibling", () => {
    const globalChild = { model: "claude-sonnet-5", options: [{ id: "effort", value: "medium" }] };
    const threadChild = { model: "claude-haiku-4-5", options: [{ id: "effort", value: "low" }] };

    expect(
      resolveSubagentPolicy({
        global: { enabled: true, children: { [instance]: globalChild } },
        thread: { mode: "on", child: threadChild },
        parentModel: "claude-opus-4.6",
        parentInstanceId: instance,
        driver: claude,
      }).child,
    ).toEqual(threadChild);

    expect(
      resolveSubagentPolicy({
        global: { enabled: true, children: { [instance]: globalChild } },
        thread: { mode: "on" },
        parentModel: "claude-opus-4.6",
        parentInstanceId: instance,
        driver: claude,
      }).child,
    ).toEqual(globalChild);
  });

  it("honors a global off switch for inherit threads", () => {
    const resolved = resolveSubagentPolicy({
      global: { enabled: false, children: {} },
      thread: { mode: "inherit" },
      parentModel: "grok-4.6",
      parentInstanceId: grokInstance,
      driver: grok,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.source).toBe("global");
  });
});

describe("renderSubagentPolicyInstructions", () => {
  it("forbids spawning when the policy is off", () => {
    const text = renderSubagentPolicyInstructions({
      enabled: false,
      source: "thread",
      child: null,
      childSource: null,
      bind: "hint",
      parentModel: "grok-4.6",
    });
    expect(text).toContain("Do not spawn subagents");
  });

  it("names the required child model when spawning is on", () => {
    const text = renderSubagentPolicyInstructions({
      enabled: true,
      source: "global",
      child: { model: "grok-build", options: [{ id: "reasoningEffort", value: "low" }] },
      childSource: "sibling",
      bind: "hint",
      parentModel: "grok-4.6",
    });
    expect(text).toContain("grok-build");
    expect(text).toContain("reasoningEffort=low");
    expect(text).toContain("grok-4.6");
  });
});
