import { describe, expect, it } from "vite-plus/test";
import {
  PROVIDER_OPTION_AGGREGATE_MAX_CHOICES,
  PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS,
  PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_OPTION_MAX_COUNT,
  PROVIDER_OPTION_VALUE_MAX_LENGTH,
} from "@t3tools/contracts";

import type * as EffectAcpSchema from "effect-acp/schema";

import {
  boundAcpSessionConfigOptions,
  extractModelConfigId,
  fingerprintAcpPlanUpdate,
  mergeToolCallState,
  parsePermissionRequest,
  parseSessionModeState,
  parseSessionUpdateEvent,
  sessionUpdateIsReplay,
  syntheticLoadSessionResponseFromInitialize,
  summarizeSessionConfigOptionValuesForError,
} from "./AcpRuntimeModel.ts";

function flattenConfigValues(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): ReadonlyArray<string> {
  return configOptions.flatMap((option) => {
    if (option.type !== "select") return [];
    return option.options.flatMap((entry) =>
      "value" in entry ? [entry.value] : entry.options.map((nested) => nested.value),
    );
  });
}

function configTextCharacters(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): number {
  let characters = 0;
  for (const option of configOptions) {
    characters +=
      option.id.length +
      option.name.length +
      (option.description?.length ?? 0) +
      (option.category?.length ?? 0);
    if (option.type !== "select") continue;
    characters += option.currentValue.length;
    for (const entry of option.options) {
      if ("value" in entry) {
        characters += entry.value.length + entry.name.length + (entry.description?.length ?? 0);
        continue;
      }
      characters += entry.group.length + entry.name.length;
      for (const nested of entry.options) {
        characters += nested.value.length + nested.name.length + (nested.description?.length ?? 0);
      }
    }
  }
  return characters;
}

describe("AcpRuntimeModel", () => {
  it("bounds ACP session configuration collections in provider order", () => {
    const booleans = Array.from({ length: PROVIDER_OPTION_MAX_COUNT + 1 }, (_, index) => ({
      type: "boolean" as const,
      id: `boolean-${index}`,
      name: `Boolean ${index}`,
      currentValue: false,
    }));
    expect(boundAcpSessionConfigOptions(booleans)).toHaveLength(PROVIDER_OPTION_MAX_COUNT);

    const selects = Array.from(
      { length: Math.ceil(PROVIDER_OPTION_AGGREGATE_MAX_CHOICES / PROVIDER_OPTION_MAX_COUNT) + 1 },
      (_, descriptorIndex) => ({
        type: "select" as const,
        id: `select-${descriptorIndex}`,
        name: `Select ${descriptorIndex}`,
        currentValue: `${descriptorIndex}-0`,
        options: Array.from({ length: PROVIDER_OPTION_MAX_COUNT + 1 }, (_, optionIndex) => ({
          value: `${descriptorIndex}-${optionIndex}`,
          name: `Choice ${descriptorIndex}-${optionIndex}`,
        })),
      }),
    );
    const bounded = boundAcpSessionConfigOptions(selects);
    const values = flattenConfigValues(bounded);
    expect(values).toHaveLength(PROVIDER_OPTION_AGGREGATE_MAX_CHOICES);
    expect(values.slice(0, 3)).toEqual(["0-0", "0-1", "0-2"]);
    expect(values).not.toContain(`0-${PROVIDER_OPTION_MAX_COUNT}`);
  });

  it("stops ACP configuration text at the shared aggregate budget", () => {
    const heavySelects = Array.from({ length: 2 }, (_, descriptorIndex) => ({
      type: "select" as const,
      id: `heavy-${descriptorIndex}`,
      name: `Heavy ${descriptorIndex}`,
      currentValue: `${descriptorIndex}-0`,
      options: Array.from({ length: PROVIDER_OPTION_MAX_COUNT }, (_, optionIndex) => ({
        value: `${descriptorIndex}-${optionIndex}`.padEnd(PROVIDER_OPTION_VALUE_MAX_LENGTH, "v"),
        name: `Choice ${descriptorIndex}-${optionIndex}`.padEnd(
          PROVIDER_OPTION_LABEL_MAX_LENGTH,
          "n",
        ),
        description: "d".repeat(PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH),
      })),
    }));
    const bounded = boundAcpSessionConfigOptions(heavySelects);

    expect(configTextCharacters(bounded)).toBeLessThanOrEqual(
      PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS,
    );
    expect(flattenConfigValues(bounded)[0]?.startsWith("0-0")).toBe(true);
  });

  it("summarizes invalid ACP option values without retaining the full menu", () => {
    const configOption = {
      type: "select" as const,
      id: "mode",
      name: "Mode",
      currentValue: "value-0",
      options: Array.from({ length: 20 }, (_, index) => ({
        value: `value-${index}-${"x".repeat(512)}`,
        name: `Value ${index}`,
      })),
    };

    const summary = summarizeSessionConfigOptionValuesForError(configOption);
    expect(summary.count).toBe(20);
    expect(summary.values).toHaveLength(16);
    expect(Math.max(...summary.values.map((value) => value.length))).toBeLessThanOrEqual(256);
  });

  it("fingerprints cumulative plans without serializing a retained payload copy", () => {
    const plan = {
      explanation: "Ship safely",
      plan: [
        { step: "Inspect", status: "completed" as const },
        { step: "Patch", status: "inProgress" as const },
      ],
    };

    expect(fingerprintAcpPlanUpdate(plan)).toBe(fingerprintAcpPlanUpdate({ ...plan }));
    expect(
      fingerprintAcpPlanUpdate({
        ...plan,
        plan: [...plan.plan, { step: "Verify", status: "pending" }],
      }),
    ).not.toBe(fingerprintAcpPlanUpdate(plan));
    expect(
      fingerprintAcpPlanUpdate({
        ...plan,
        plan: plan.plan.toReversed(),
      }),
    ).not.toBe(fingerprintAcpPlanUpdate(plan));
  });

  it("parses session mode state from typed ACP session setup responses", () => {
    const modeState = parseSessionModeState({
      sessionId: "session-1",
      modes: {
        currentModeId: " code ",
        availableModes: [
          { id: " ask ", name: " Ask ", description: " Request approval " },
          { id: " code ", name: " Code " },
        ],
      },
      configOptions: [],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modeState).toEqual({
      currentModeId: "code",
      availableModes: [
        { id: "ask", name: "Ask", description: "Request approval" },
        { id: "code", name: "Code" },
      ],
    });
  });

  it("extracts the model config id from typed ACP config options", () => {
    const modelConfigId = extractModelConfigId({
      sessionId: "session-1",
      configOptions: [
        {
          id: "approval",
          name: "Approval Mode",
          category: "permission",
          type: "select",
          currentValue: "ask",
          options: [{ value: "ask", name: "Ask" }],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Auto" }],
        },
      ],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modelConfigId).toBe("model");
  });

  it("detects Grok session replay updates from _meta.isReplay", () => {
    expect(
      sessionUpdateIsReplay({
        _meta: { isReplay: true },
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "replayed" },
        },
      } satisfies EffectAcpSchema.SessionNotification),
    ).toBe(true);
    expect(
      sessionUpdateIsReplay({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "live" },
        },
      } satisfies EffectAcpSchema.SessionNotification),
    ).toBe(false);
  });

  it("builds a synthetic load response from initialize model state", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [{ modelId: "grok-build", name: "Grok Build" }],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.models?.currentModelId).toBe("grok-build");
    expect(response._meta).toMatchObject({ t3SessionLoadReady: "replay_idle" });
  });

  it("accepts initialize model descriptions with null", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [{ modelId: "grok-build", name: "Grok Build", description: null }],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.models?.availableModels[0]?.description).toBeNull();
  });

  it("ignores malformed initialize model state in synthetic load responses", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [null],
        },
        modeState: {
          currentModeId: "code",
          availableModes: [{ id: "code", name: 12 }],
        },
      },
    } as EffectAcpSchema.InitializeResponse);

    expect(response.models).toBeUndefined();
    expect(response.modes).toBeUndefined();
    expect(response._meta).toMatchObject({ t3SessionLoadReady: "replay_idle" });
  });

  it("builds a synthetic load response with initialize mode state", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modeState: {
          currentModeId: "code",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.modes?.currentModeId).toBe("code");
    expect(response.modes?.availableModes).toHaveLength(2);
  });

  it("projects typed ACP tool call updates into runtime events", () => {
    const created = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          executable: "bun",
          args: ["run", "typecheck"],
        },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Running checks",
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(created.events).toEqual([
      {
        _tag: "ToolCallUpdated",
        toolCall: {
          toolCallId: "tool-1",
          kind: "execute",
          title: "Ran command",
          status: "pending",
          command: "bun run typecheck",
          detail: "bun run typecheck",
          data: {
            toolCallId: "tool-1",
            kind: "execute",
            command: "bun run typecheck",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Terminal",
            kind: "execute",
            status: "pending",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
      },
    ]);

    const updated = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: { exitCode: 0 },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]?._tag).toBe("ToolCallUpdated");
    const createdEvent = created.events[0];
    const updatedEvent = updated.events[0];
    if (createdEvent?._tag === "ToolCallUpdated" && updatedEvent?._tag === "ToolCallUpdated") {
      expect(mergeToolCallState(createdEvent.toolCall, updatedEvent.toolCall)).toMatchObject({
        toolCallId: "tool-1",
        status: "completed",
        title: "Ran command",
        detail: "bun run typecheck",
        command: "bun run typecheck",
      });
    }
  });

  it("trims padded current mode updates before emitting a mode change", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: " code ",
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.modeId).toBe("code");
    expect(result.events).toEqual([
      {
        _tag: "ModeChanged",
        modeId: "code",
      },
    ]);
  });

  it("projects typed ACP plan and content updates", () => {
    const planResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: " Inspect state ", priority: "high", status: "completed" },
          { content: "", priority: "medium", status: "in_progress" },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(planResult.events).toEqual([
      {
        _tag: "PlanUpdated",
        payload: {
          plan: [
            { step: "Inspect state", status: "completed" },
            { step: "Step 2", status: "inProgress" },
          ],
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: " Inspect state ", priority: "high", status: "completed" },
              { content: "", priority: "medium", status: "in_progress" },
            ],
          },
        },
      },
    ]);

    const contentResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "hello from acp",
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(contentResult.events).toEqual([
      {
        _tag: "ContentDelta",
        streamKind: "assistant_text",
        text: "hello from acp",
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "hello from acp",
            },
          },
        },
      },
    ]);

    const thoughtResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: {
          type: "text",
          text: "thinking through acp",
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(thoughtResult.events).toEqual([
      {
        _tag: "ContentDelta",
        streamKind: "reasoning_text",
        text: "thinking through acp",
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: {
              type: "text",
              text: "thinking through acp",
            },
          },
        },
      },
    ]);
  });

  it("keeps permission request parsing compatible with loose extension payloads", () => {
    const request = parsePermissionRequest({
      sessionId: "session-1",
      options: [
        {
          optionId: "allow-once",
          name: "Allow once",
          kind: "allow_once",
        },
      ],
      toolCall: {
        toolCallId: "tool-1",
        title: "`cat package.json`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Not in allowlist",
            },
          },
        ],
      },
    });

    expect(request).toMatchObject({
      kind: "execute",
      detail: "cat package.json",
      toolCall: {
        toolCallId: "tool-1",
        kind: "execute",
        status: "pending",
        command: "cat package.json",
      },
    });
  });
});
