import { describe, expect, it } from "vite-plus/test";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";

import { buildThreadModelIdentity, threadChatHeaderSubtitle } from "./threadModelIdentity";

const descriptors: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "reasoningEffort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
    ],
    currentValue: "high",
  },
  {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Priority" },
    ],
    currentValue: "priority",
  },
  {
    id: "contextWindow",
    label: "Context",
    type: "select",
    options: [
      { id: "128k", label: "128k" },
      { id: "200k", label: "200k" },
    ],
    currentValue: "200k",
  },
  {
    id: "fastMode",
    label: "Fast mode",
    type: "boolean",
    currentValue: false,
  },
];

describe("buildThreadModelIdentity", () => {
  it("summarizes the model and the option values currently in effect", () => {
    const identity = buildThreadModelIdentity({
      modelLabel: "Grok 4.6",
      providerDriver: "grok",
      optionDescriptors: descriptors,
    });

    expect(identity.modelLabel).toBe("Grok 4.6");
    expect(identity.providerDriver).toBe("grok");
    expect(identity.traitSummary).toBe("High · Priority · 200k");
    expect(identity.summary).toBe("Grok 4.6 · High · Priority · 200k");
    expect(identity.compactLabel).toBe("Grok 4.6 · High");
    expect(identity.accessibilityLabel).toBe(
      "Model Grok 4.6, Reasoning High, Service Tier Priority, Context 200k",
    );
  });

  it("omits disabled boolean options and falls back to the model name", () => {
    const identity = buildThreadModelIdentity({
      modelLabel: "GPT-5.6 Sol",
      providerDriver: "codex",
      optionDescriptors: [
        { id: "fastMode", label: "Fast mode", type: "boolean", currentValue: false },
      ],
    });

    expect(identity.summary).toBe("GPT-5.6 Sol");
    expect(identity.compactLabel).toBe("GPT-5.6 Sol");
    expect(identity.traits).toEqual([]);
  });

  it("includes enabled boolean options by their descriptor label", () => {
    const identity = buildThreadModelIdentity({
      modelLabel: "Opus 4.6",
      providerDriver: "claudeAgent",
      optionDescriptors: [
        { id: "thinking", label: "Thinking", type: "boolean", currentValue: true },
      ],
    });

    expect(identity.summary).toBe("Opus 4.6 · Thinking");
    expect(identity.accessibilityLabel).toBe("Model Opus 4.6, Thinking");
  });
});

describe("threadChatHeaderSubtitle", () => {
  const identity = buildThreadModelIdentity({
    modelLabel: "Grok 4.6",
    providerDriver: "grok",
    optionDescriptors: descriptors,
  });

  it("leads with the compact model identity so truncation keeps the model", () => {
    expect(
      threadChatHeaderSubtitle({
        identity,
        location: "T3 Pretty · Serge's MacBook",
      }),
    ).toBe("Grok 4.6 · High · T3 Pretty · Serge's MacBook");
  });

  it("falls back to location when the thread has no model identity yet", () => {
    expect(
      threadChatHeaderSubtitle({
        identity: null,
        location: "T3 Pretty · Serge's MacBook",
      }),
    ).toBe("T3 Pretty · Serge's MacBook");
  });

  it("uses the compact identity alone when location is empty", () => {
    expect(threadChatHeaderSubtitle({ identity, location: "" })).toBe("Grok 4.6 · High");
  });
});
