import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { KimiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildKimiCapabilitiesFromConfigOptions,
  buildKimiDiscoveredModelsFromConfigOptions,
  checkKimiProviderStatus,
} from "./KimiProvider.ts";
const decodeKimiSettings = Schema.decodeSync(KimiSettings);

const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "kimi-code/k3",
    options: [
      { value: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
      { value: "kimi-code/k3", name: "K3" },
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    description: "Choose Kimi's reasoning depth.",
    type: "select",
    currentValue: "high",
    options: [
      { value: "low", name: "Thinking Low" },
      { value: "high", name: "Thinking High" },
      { value: "max", name: "Thinking Max" },
    ],
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

describe("Kimi provider discovery", () => {
  it("maps the ACP model catalog and preserves the active default", () => {
    expect(buildKimiDiscoveredModelsFromConfigOptions(configOptions)).toMatchObject([
      {
        slug: "kimi-code/kimi-for-coding",
        name: "K2.7 Coding",
      },
      {
        slug: "kimi-code/k3",
        name: "K3",
        isDefault: true,
      },
    ]);
  });

  it("maps negotiated thinking levels into model option capabilities", () => {
    expect(buildKimiCapabilitiesFromConfigOptions(configOptions)).toEqual({
      optionDescriptors: [
        {
          id: "thinking",
          label: "Thinking",
          description: "Choose Kimi's reasoning depth.",
          type: "select",
          currentValue: "high",
          options: [
            { id: "low", label: "Thinking Low" },
            { id: "high", label: "Thinking High", isDefault: true },
            { id: "max", label: "Thinking Max" },
          ],
        },
      ],
    });
  });

  it.effect("optionally probes the installed Kimi CLI through the provider health path", () => {
    if (process.env.T3_KIMI_LIVE !== "1") return Effect.void;
    return Effect.gen(function* () {
      const snapshot = yield* checkKimiProviderStatus(
        decodeKimiSettings({
          binaryPath: process.env.T3_KIMI_BINARY?.trim() || "kimi",
        }),
      );

      expect(snapshot).toMatchObject({
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
      });
      expect(snapshot.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(snapshot.models.map((model) => model.slug)).toContain("kimi-code/k3");
    }).pipe(Effect.provide(NodeServices.layer));
  });
});
