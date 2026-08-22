import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyKimiAcpModelSelection,
  buildKimiAcpSpawnInput,
  KIMI_ACP_CLIENT_CAPABILITIES,
  resolveKimiAcpBaseModelId,
} from "./KimiAcpSupport.ts";

const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "kimi-code/k3",
    options: [
      { value: "kimi-code/k3", name: "K3" },
      { value: "kimi-code/k3-256k", name: "K3-256K" },
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "low", name: "Thinking Low" },
      { value: "high", name: "Thinking High" },
      { value: "max", name: "Thinking Max" },
    ],
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

describe("Kimi ACP support", () => {
  it("opts into ACP terminals", () => {
    expect(KIMI_ACP_CLIENT_CAPABILITIES).toEqual({ terminal: true });
  });

  it("spawns the official stdio ACP entry point", () => {
    expect(
      buildKimiAcpSpawnInput({ binaryPath: "/opt/kimi/bin/kimi" }, "/repo", {
        KIMI_CODE_HOME: "/tmp/kimi",
      }),
    ).toEqual({
      command: "/opt/kimi/bin/kimi",
      args: ["acp"],
      cwd: "/repo",
      env: { KIMI_CODE_HOME: "/tmp/kimi" },
    });
  });

  it("normalizes an empty model to K3", () => {
    expect(resolveKimiAcpBaseModelId(" ")).toBe("kimi-code/k3");
    expect(resolveKimiAcpBaseModelId(" kimi-code/k3-256k ")).toBe("kimi-code/k3-256k");
  });

  it.effect("applies model and thinking through session config options", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [string, string]> = [];
      const runtime = {
        getConfigOptions: Effect.succeed(configOptions),
        setModel: (model: string) =>
          Effect.sync(() => {
            calls.push(["model", model]);
          }),
        setConfigOption: (id: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push([id, String(value)]);
          }),
      };

      yield* applyKimiAcpModelSelection({
        runtime,
        model: "kimi-code/k3-256k",
        selections: [{ id: "thinking", value: "max" }],
        mapError: ({ cause }) => cause,
      });

      expect(calls).toEqual([
        ["model", "kimi-code/k3-256k"],
        ["thinking", "max"],
      ]);
    }),
  );
});
