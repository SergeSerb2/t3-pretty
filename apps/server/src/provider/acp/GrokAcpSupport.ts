import {
  type GrokSettings,
  type ModelCapabilities,
  type ModelSelection,
  PROVIDER_MODEL_ID_MAX_LENGTH,
  PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_OPTION_MAX_COUNT,
  PROVIDER_OPTION_VALUE_MAX_LENGTH,
  ProviderDriverKind,
  SERVER_PROVIDER_LABEL_MAX_LENGTH,
  SERVER_PROVIDER_MODELS_MAX_ITEMS,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import {
  createModelCapabilities,
  getModelSelectionStringOptionValue,
  normalizeModelSlug,
} from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const T3_CODE_OAUTH_REFERRER = "t3code";
const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

/** Composer option id for Grok reasoning effort. Same shape as Codex. */
export const GROK_REASONING_EFFORT_OPTION_ID = "reasoningEffort";

const GROK_SPAWN_EFFORT_LEVELS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

const GROK_REASONING_EFFORT_LOW = {
  id: "low",
  label: "Low",
  description: "Quick implementations",
} as const;
const GROK_REASONING_EFFORT_MEDIUM = {
  id: "medium",
  label: "Medium",
  description: "Balanced effort",
} as const;
const GROK_REASONING_EFFORT_HIGH = {
  id: "high",
  label: "High",
  description: "Higher implementation quality",
  isDefault: true,
} as const;
const GROK_REASONING_EFFORT_XHIGH = {
  id: "xhigh",
  label: "Extra High",
  description: "Highest effort and reasoning level",
} as const;

const GROK_45_REASONING_EFFORTS = [
  GROK_REASONING_EFFORT_LOW,
  GROK_REASONING_EFFORT_MEDIUM,
  GROK_REASONING_EFFORT_HIGH,
] as const;

const GROK_46_REASONING_EFFORTS = [
  GROK_REASONING_EFFORT_LOW,
  GROK_REASONING_EFFORT_MEDIUM,
  GROK_REASONING_EFFORT_HIGH,
  GROK_REASONING_EFFORT_XHIGH,
] as const;

type GrokAcpRuntimeGrokSettings = Pick<GrokSettings, "binaryPath">;

interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeGrokSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly reasoningEffort?: string;
}

export interface GrokReasoningEffortChoice {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

export interface GrokAcpModelMeta {
  readonly supportsReasoningEffort: boolean;
  readonly reasoningEffort?: string;
  readonly reasoningEfforts: ReadonlyArray<GrokReasoningEffortChoice>;
}

export interface GrokAcpSelection {
  readonly modelId: string | undefined;
  readonly reasoningEffort: string | undefined;
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeGrokSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  reasoningEffort?: string,
): AcpSessionRuntime.AcpSpawnInput {
  const spawnEffort = spawnableGrokReasoningEffort(reasoningEffort);
  return {
    command: grokSettings?.binaryPath || "grok",
    args: spawnEffort ? ["agent", "--reasoning-effort", spawnEffort, "stdio"] : ["agent", "stdio"],
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: T3_CODE_OAUTH_REFERRER,
    },
  };
}

function resolveGrokAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(
          input.grokSettings,
          input.cwd,
          input.environment,
          input.reasoningEffort,
        ),
        authMethodId: resolveGrokAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "grok-build";
  return normalizeModelSlug(base, GROK_DRIVER_KIND) ?? "grok-build";
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return boundedGrokIdentity(
    sessionSetupResult.models?.currentModelId,
    PROVIDER_MODEL_ID_MAX_LENGTH,
  );
}

export function spawnableGrokReasoningEffort(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !GROK_SPAWN_EFFORT_LEVELS.has(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedGrokIdentity(value: unknown, maximumChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > maximumChars) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function boundedGrokPresentation(value: unknown, maximumChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, maximumChars).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Grok 4.5 accepts low/medium/high; xhigh is 4.6+. */
export function grokModelSupportsXhighEffort(
  slug: string | null | undefined,
  name?: string | null,
): boolean {
  return !looksLikeGrok45(slug) && !looksLikeGrok45(name);
}

function looksLikeGrok45(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /(?:^|[^0-9])4[.-]5(?:[^0-9]|$)/.test(value);
}

function parseGrokReasoningEffortChoice(value: unknown): GrokReasoningEffortChoice | undefined {
  if (typeof value === "string") {
    const id = boundedGrokIdentity(value, PROVIDER_OPTION_VALUE_MAX_LENGTH);
    return id ? { id, label: id } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const id =
    boundedGrokIdentity(value.value, PROVIDER_OPTION_VALUE_MAX_LENGTH) ??
    boundedGrokIdentity(value.id, PROVIDER_OPTION_VALUE_MAX_LENGTH);
  if (!id) {
    return undefined;
  }
  const label =
    boundedGrokPresentation(value.label, PROVIDER_OPTION_LABEL_MAX_LENGTH) ??
    boundedGrokPresentation(value.name, PROVIDER_OPTION_LABEL_MAX_LENGTH) ??
    id;
  const description = boundedGrokPresentation(
    value.description,
    PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  );
  return {
    id,
    label,
    ...(description ? { description } : {}),
    ...(value.default === true || value.isDefault === true ? { isDefault: true } : {}),
  };
}

/** Reads the per-model effort menu Grok stamps onto ACP `models._meta`. */
export function parseGrokAcpModelMeta(meta: unknown): GrokAcpModelMeta {
  if (!isRecord(meta)) {
    return { supportsReasoningEffort: false, reasoningEfforts: [] };
  }

  const unique = new Map<string, GrokReasoningEffortChoice>();
  if (Array.isArray(meta.reasoningEfforts)) {
    for (const entry of meta.reasoningEfforts) {
      if (unique.size >= PROVIDER_OPTION_MAX_COUNT) break;
      const choice = parseGrokReasoningEffortChoice(entry);
      if (choice && !unique.has(choice.id)) {
        unique.set(choice.id, choice);
      }
    }
  }
  const choices = [...unique.values()];
  const current = boundedGrokIdentity(meta.reasoningEffort, PROVIDER_OPTION_VALUE_MAX_LENGTH);
  const supportsReasoningEffort = meta.supportsReasoningEffort === true || choices.length > 0;

  return {
    supportsReasoningEffort,
    ...(current ? { reasoningEffort: current } : {}),
    reasoningEfforts: choices.map((choice) =>
      current && choice.id === current && choice.isDefault !== true
        ? { ...choice, isDefault: true }
        : choice,
    ),
  };
}

export function fallbackGrokReasoningEffortsForModel(
  slug: string | null | undefined,
  name?: string | null,
): ReadonlyArray<GrokReasoningEffortChoice> {
  return grokModelSupportsXhighEffort(slug, name)
    ? [...GROK_46_REASONING_EFFORTS]
    : [...GROK_45_REASONING_EFFORTS];
}

export function grokReasoningEffortCapabilities(
  efforts: ReadonlyArray<GrokReasoningEffortChoice>,
): ModelCapabilities {
  if (efforts.length === 0) {
    return createModelCapabilities({ optionDescriptors: [] });
  }
  const defaultId = efforts.find((choice) => choice.isDefault)?.id ?? efforts[0]?.id;
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: GROK_REASONING_EFFORT_OPTION_ID,
        label: "Reasoning",
        type: "select",
        options: efforts.map((choice) => ({
          id: choice.id,
          label: choice.label,
          ...(choice.description ? { description: choice.description } : {}),
          ...(choice.isDefault ? { isDefault: true } : {}),
        })),
        ...(defaultId ? { currentValue: defaultId } : {}),
      },
    ],
  });
}

/** Live ACP menu when present; otherwise 4.5 vs 4.6 fallbacks. */
export function grokModelCapabilities(input: {
  readonly slug: string;
  readonly name?: string | null;
  readonly meta?: unknown;
}): ModelCapabilities {
  const advertised = parseGrokAcpModelMeta(input.meta).reasoningEfforts;
  return grokReasoningEffortCapabilities(
    advertised.length > 0
      ? advertised
      : fallbackGrokReasoningEffortsForModel(input.slug, input.name),
  );
}

export function requestedGrokReasoningEffort(
  modelSelection: ModelSelection | null | undefined,
  advertised: ReadonlyArray<string>,
): string | undefined {
  const requested = getModelSelectionStringOptionValue(
    modelSelection,
    GROK_REASONING_EFFORT_OPTION_ID,
  )?.trim();
  if (!requested) {
    return undefined;
  }
  const allowed =
    advertised.length > 0
      ? advertised
      : fallbackGrokReasoningEffortsForModel(modelSelection?.model).map((choice) => choice.id);
  return allowed.includes(requested) ? requested : undefined;
}

export function grokReasoningEffortMenusFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): Map<string, ReadonlyArray<string>> {
  const menus = new Map<string, ReadonlyArray<string>>();
  let inspectedModels = 0;
  for (const model of sessionSetupResult.models?.availableModels ?? []) {
    if (inspectedModels >= SERVER_PROVIDER_MODELS_MAX_ITEMS) break;
    inspectedModels += 1;
    if (model.modelId.length > PROVIDER_MODEL_ID_MAX_LENGTH) continue;
    const slug = resolveGrokAcpBaseModelId(model.modelId);
    const advertised = parseGrokAcpModelMeta(model._meta).reasoningEfforts.map(
      (choice) => choice.id,
    );
    const efforts =
      advertised.length > 0
        ? advertised
        : fallbackGrokReasoningEffortsForModel(
            slug,
            model.name.slice(0, SERVER_PROVIDER_LABEL_MAX_LENGTH),
          ).map((choice) => choice.id);
    if (efforts.length > 0) {
      menus.set(slug, efforts);
      menus.set(model.modelId, efforts);
    }
  }
  return menus;
}

export function advertisedGrokReasoningEffortsFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
  modelId: string | undefined,
): ReadonlyArray<string> {
  const menus = grokReasoningEffortMenusFromSessionSetup(sessionSetupResult);
  if (modelId && menus.has(modelId)) {
    return menus.get(modelId) ?? [];
  }
  const current = sessionSetupResult.models?.currentModelId;
  if (current && menus.has(current)) {
    return menus.get(current) ?? [];
  }
  return fallbackGrokReasoningEffortsForModel(modelId ?? current).map((choice) => choice.id);
}

export function currentGrokReasoningEffortFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const currentModelId = sessionSetupResult.models?.currentModelId;
  const current = sessionSetupResult.models?.availableModels.find(
    (model) => model.modelId === currentModelId,
  );
  return parseGrokAcpModelMeta(current?._meta).reasoningEffort;
}

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly currentReasoningEffort?: string | undefined;
  readonly requestedReasoningEffort?: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<GrokAcpSelection, E> {
  const nextModelId = input.requestedModelId ?? input.currentModelId;
  const nextEffort = input.requestedReasoningEffort ?? input.currentReasoningEffort;
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  const shouldSwitchEffort =
    input.requestedReasoningEffort !== undefined &&
    input.requestedReasoningEffort !== input.currentReasoningEffort;

  if (!shouldSwitchModel && !shouldSwitchEffort) {
    return Effect.succeed({
      modelId: input.currentModelId,
      reasoningEffort: input.currentReasoningEffort,
    });
  }

  if (nextModelId === undefined) {
    return Effect.succeed({
      modelId: undefined,
      reasoningEffort: nextEffort,
    });
  }

  return input.runtime
    .setSessionModel(
      nextModelId,
      nextEffort ? { _meta: { reasoningEffort: nextEffort } } : undefined,
    )
    .pipe(
      Effect.mapError(input.mapError),
      Effect.as({
        modelId: nextModelId,
        reasoningEffort: nextEffort,
      }),
    );
}
