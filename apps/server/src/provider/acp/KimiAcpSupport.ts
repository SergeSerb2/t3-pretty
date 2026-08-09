import { type KimiSettings, type ProviderOptionSelection } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type KimiAcpRuntimeSettings = Pick<KimiSettings, "binaryPath">;

export interface KimiAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly kimiSettings: KimiAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface KimiAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-config-option" | "set-model";
  readonly configId?: string;
}

export function buildKimiAcpSpawnInput(
  kimiSettings: KimiAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: kimiSettings?.binaryPath || "kimi",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeKimiAcpRuntime = (
  input: KimiAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildKimiAcpSpawnInput(input.kimiSettings, input.cwd, input.environment),
        authMethodId: "login",
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

const optionValues = (option: EffectAcpSchema.SessionConfigOption): ReadonlyArray<string> => {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) =>
    "value" in entry ? [entry.value] : entry.options.map((nested) => nested.value),
  );
};

const findThinkingSelection = (
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): string | undefined => {
  const selection = selections?.find((entry) => {
    const id = entry.id.trim().toLowerCase();
    return id === "thinking" || id === "thought_level" || id === "reasoning";
  });
  return typeof selection?.value === "string" && selection.value.trim()
    ? selection.value.trim()
    : undefined;
};

export const resolveKimiAcpBaseModelId = (model: string | null | undefined): string =>
  model?.trim() || "kimi-code/k3";

interface KimiAcpModelSelectionRuntime {
  readonly getConfigOptions: AcpSessionRuntime.AcpSessionRuntime["Service"]["getConfigOptions"];
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export function applyKimiAcpModelSelection<E>(input: {
  readonly runtime: KimiAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: KimiAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    yield* input.runtime.setModel(resolveKimiAcpBaseModelId(input.model)).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          step: "set-model",
        }),
      ),
    );

    const thinkingValue = findThinkingSelection(input.selections);
    if (!thinkingValue) return;

    const configOptions = yield* input.runtime.getConfigOptions;
    const thinkingOption = configOptions.find((option) => {
      const id = option.id.trim().toLowerCase();
      const category = option.category?.trim().toLowerCase();
      return (
        option.type === "select" &&
        (id === "thinking" || category === "thought_level") &&
        optionValues(option).includes(thinkingValue)
      );
    });
    if (!thinkingOption) return;

    yield* input.runtime.setConfigOption(thinkingOption.id, thinkingValue).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          step: "set-config-option",
          configId: thinkingOption.id,
        }),
      ),
    );
  });
}
