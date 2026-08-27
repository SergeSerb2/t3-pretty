import {
  type KimiSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import { makeKimiAcpRuntime } from "../acp/KimiAcpSupport.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const KIMI_PRESENTATION = {
  displayName: "Kimi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
  supportsNativeResume: true,
} as const;
const KIMI_INSTALL_DOCS_URL =
  "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html";
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const KIMI_ACP_DISCOVERY_TIMEOUT_MS = 20_000;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const FALLBACK_THINKING_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "thinking",
      label: "Thinking",
      description: "Kimi reasoning depth for this turn.",
      options: [
        { value: "low", label: "Thinking Low" },
        { value: "high", label: "Thinking High", isDefault: true },
        { value: "max", label: "Thinking Max" },
      ],
    }),
  ],
});

const KIMI_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "kimi-code/k3",
    name: "K3",
    isCustom: false,
    isDefault: true,
    capabilities: FALLBACK_THINKING_CAPABILITIES,
  },
  {
    slug: "kimi-code/k3-256k",
    name: "K3-256K",
    isCustom: false,
    capabilities: FALLBACK_THINKING_CAPABILITIES,
  },
  {
    slug: "kimi-code/kimi-for-coding",
    name: "K2.7 Coding",
    isCustom: false,
    capabilities: FALLBACK_THINKING_CAPABILITIES,
  },
  {
    slug: "kimi-code/kimi-for-coding-highspeed",
    name: "K2.7 Coding Highspeed",
    isCustom: false,
    capabilities: FALLBACK_THINKING_CAPABILITIES,
  },
];

interface KimiSessionSelectOption {
  readonly value: string;
  readonly name: string;
}

function flattenSelectOptions(
  option: EffectAcpSchema.SessionConfigOption | undefined,
): ReadonlyArray<KimiSessionSelectOption> {
  if (!option || option.type !== "select") return [];
  return option.options.flatMap((entry) =>
    "value" in entry
      ? [{ value: entry.value.trim(), name: entry.name.trim() }]
      : entry.options.map((nested) => ({
          value: nested.value.trim(),
          name: nested.name.trim(),
        })),
  );
}

function findConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  id: string,
  category: string,
): EffectAcpSchema.SessionConfigOption | undefined {
  return (
    configOptions.find((option) => option.id.trim().toLowerCase() === id) ??
    configOptions.find((option) => option.category?.trim().toLowerCase() === category)
  );
}

export function buildKimiCapabilitiesFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ModelCapabilities {
  if (!configOptions || configOptions.length === 0) return FALLBACK_THINKING_CAPABILITIES;
  const thinkingOption = findConfigOption(configOptions, "thinking", "thought_level");
  const options = flattenSelectOptions(thinkingOption).filter((entry) => entry.value.length > 0);
  if (options.length === 0) return EMPTY_CAPABILITIES;
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "thinking",
        label: thinkingOption?.name.trim() || "Thinking",
        description: thinkingOption?.description?.trim() || "Kimi reasoning depth for this turn.",
        options: options.map((entry) => ({
          value: entry.value,
          label: entry.name || entry.value,
          ...(thinkingOption?.type === "select" && thinkingOption.currentValue === entry.value
            ? { isDefault: true }
            : {}),
        })),
      }),
    ],
  });
}

export function buildKimiDiscoveredModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!configOptions) return [];
  const modelOption = findConfigOption(configOptions, "model", "model");
  const capabilities = buildKimiCapabilitiesFromConfigOptions(configOptions);
  const currentModel = modelOption?.type === "select" ? modelOption.currentValue.trim() : "";
  const seen = new Set<string>();
  return flattenSelectOptions(modelOption)
    .map((entry): ServerProviderModel | undefined => {
      if (!entry.value || seen.has(entry.value)) return undefined;
      seen.add(entry.value);
      return {
        slug: entry.value,
        name: entry.name || entry.value,
        isCustom: false,
        ...(entry.value === currentModel ? { isDefault: true } : {}),
        capabilities,
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

function kimiModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = KIMI_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    customModels ?? [],
    FALLBACK_THINKING_CAPABILITIES,
  );
}

export function buildInitialKimiProviderSnapshot(
  kimiSettings: KimiSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = kimiModelsFromSettings(kimiSettings.customModels);
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: kimiSettings.enabled,
      checkedAt,
      models,
      probe: kimiSettings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Kimi Code CLI availability...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Kimi is disabled in T3 Code settings.",
          },
    });
  });
}

const runKimiVersionCommand = (kimiSettings: KimiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = kimiSettings.binaryPath || "kimi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

const discoverKimiModelsViaAcp = (kimiSettings: KimiSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acp = yield* makeKimiAcpRuntime({
      kimiSettings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    return buildKimiDiscoveredModelsFromConfigOptions(started.sessionSetupResult.configOptions);
  }).pipe(Effect.scoped);

function isAuthenticationRequired(cause: Cause.Cause<unknown>): boolean {
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("authentication required") ||
    message.includes("login required") ||
    message.includes("not authenticated")
  );
}

export const checkKimiProviderStatus = Effect.fn("checkKimiProviderStatus")(function* (
  kimiSettings: KimiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = kimiModelsFromSettings(kimiSettings.customModels);
  if (!kimiSettings.enabled) {
    return yield* buildInitialKimiProviderSnapshot(kimiSettings);
  }

  const versionResult = yield* runKimiVersionCommand(kimiSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? `Kimi Code CLI (\`kimi\`) is not installed or not on PATH. See ${KIMI_INSTALL_DOCS_URL}.`
          : "Failed to execute the Kimi Code CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kimi Code CLI timed out while running `kimi --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Kimi Code CLI is installed but failed to run.",
      },
    });
  }

  const discoveryExit = yield* discoverKimiModelsViaAcp(kimiSettings, environment).pipe(
    Effect.timeoutOption(KIMI_ACP_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(discoveryExit)) {
    const unauthenticated = isAuthenticationRequired(discoveryExit.cause);
    yield* Effect.logWarning("Kimi ACP provider discovery failed", {
      errorTag: causeErrorTag(discoveryExit.cause),
    });
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: unauthenticated ? "unauthenticated" : "unknown" },
        message: unauthenticated
          ? "Kimi Code is not authenticated. Run `kimi login`, then refresh provider status."
          : "Kimi Code CLI is installed but ACP startup failed. Check server logs for details.",
      },
    });
  }
  if (Option.isNone(discoveryExit.value)) {
    return buildServerProvider({
      presentation: KIMI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Kimi ACP startup timed out after ${KIMI_ACP_DISCOVERY_TIMEOUT_MS}ms.`,
      },
    });
  }

  const discoveredModels = discoveryExit.value.value;
  return buildServerProvider({
    presentation: KIMI_PRESENTATION,
    enabled: true,
    checkedAt,
    models:
      discoveredModels.length > 0
        ? kimiModelsFromSettings(kimiSettings.customModels, discoveredModels)
        : fallbackModels,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});

export const enrichKimiSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap(input.publishSnapshot),
    Effect.catchCause((cause) =>
      Effect.logWarning("Kimi version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
