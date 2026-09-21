/**
 * Shared server settings.
 *
 * Every server keeps its own `settings.json`, but some keys are user
 * preferences that only live on the server because the server has to act on
 * them (auto-settlement runs with no client attached). A user does not want
 * those to differ per machine. Clients write these keys to every shared-settings
 * sync target, and warn when another target still holds a different value so
 * the user can push their current value out.
 */
import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ProviderInstanceEnvironment,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

/** Server keys that hold a user preference rather than machine config. */
const SHARED_SERVER_SETTING_KEYS = [
  "continueThreadsAfterServerUpdate",
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleOnMerge",
  "sidebarProjectFolders",
  "sidebarProjectFolderAssignments",
  "sceneryPhotoSet",
  "newWorktreesStartFromOrigin",
  "sourceControlWritingStyle",
  "textGenerationModelSelection",
  "globalEnvironment",
] as const satisfies ReadonlyArray<keyof ServerSettings & keyof ServerSettingsPatch>;

export type SharedSettingsCapabilities = Pick<
  ExecutionEnvironmentCapabilities,
  "threadRestartContinuation" | "globalEnvironment" | "sceneryPhotoSet"
>;

/** Fill redacted secret values from an operator export so other machines receive them. */
export function hydrateSharedGlobalEnvironment(
  patch: ProviderInstanceEnvironment,
  exported: ProviderInstanceEnvironment,
): ProviderInstanceEnvironment {
  if (!patch.some((variable) => variable.valueRedacted === true)) {
    return patch;
  }
  const exportedByName = new Map(exported.map((variable) => [variable.name, variable]));
  return patch.map((variable) => {
    if (variable.valueRedacted !== true) return variable;
    const secret = exportedByName.get(variable.name);
    if (secret === undefined || secret.value.length === 0) return variable;
    const { valueRedacted: _omit, ...rest } = variable;
    return { ...rest, value: secret.value };
  });
}

export function sharedGlobalEnvironmentNeedsExport(patch: ServerSettingsPatch): boolean {
  return patch.globalEnvironment?.some((variable) => variable.valueRedacted === true) === true;
}

/** Hydrate secrets for mesh fan-out. A failed export must not copy redacted rows. */
export function prepareSharedGlobalEnvironmentFanOut(
  patch: ServerSettingsPatch,
  exported: ProviderInstanceEnvironment | null,
): { readonly patch: ServerSettingsPatch; readonly fanOutSecrets: boolean } {
  if (!sharedGlobalEnvironmentNeedsExport(patch)) {
    return { patch, fanOutSecrets: true };
  }
  if (exported === null) {
    return { patch, fanOutSecrets: false };
  }
  const globalEnvironment = hydrateSharedGlobalEnvironment(patch.globalEnvironment!, exported);
  return {
    patch: { ...patch, globalEnvironment },
    fanOutSecrets: !globalEnvironment.some((variable) => variable.valueRedacted === true),
  };
}

export type SharedServerSettingKey = (typeof SHARED_SERVER_SETTING_KEYS)[number];

const SHARED_KEY_SET = new Set<string>(SHARED_SERVER_SETTING_KEYS);

/** Split a server patch into the keys every environment should receive and the primary-only rest. */
export function splitSharedServerPatch(patch: ServerSettingsPatch): {
  sharedPatch: ServerSettingsPatch;
  localPatch: ServerSettingsPatch;
} {
  const sharedPatch: Record<string, unknown> = {};
  const localPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SHARED_KEY_SET.has(key)) {
      sharedPatch[key] = value;
    } else {
      localPatch[key] = value;
    }
  }
  return {
    sharedPatch: sharedPatch as ServerSettingsPatch,
    localPatch: localPatch as ServerSettingsPatch,
  };
}

/** Filter unsupported preferences; direct model writes retain the server's fallback behavior. */
export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  capabilities: SharedSettingsCapabilities | undefined,
  settings?: ServerSettings,
  sourceSettings = settings,
  targetIsSource = false,
): ServerSettingsPatch {
  const instanceId =
    patch.textGenerationModelSelection?.instanceId ??
    sourceSettings?.textGenerationModelSelection.instanceId;
  if (
    !targetIsSource &&
    patch.textGenerationModelSelection &&
    (!settings ||
      (instanceId !== undefined &&
        (sourceSettings?.providerInstances[instanceId]?.driver ?? instanceId) !==
          (settings.providerInstances[instanceId]?.driver ?? instanceId)) ||
      !isModelSelectionProviderEnabled(settings, {
        ...settings.textGenerationModelSelection,
        ...patch.textGenerationModelSelection,
      }))
  ) {
    patch = Struct.omit(patch, ["textGenerationModelSelection"]);
  }
  if (capabilities?.threadRestartContinuation !== true) {
    patch = Struct.omit(patch, ["continueThreadsAfterServerUpdate"]);
  }
  if (capabilities?.sceneryPhotoSet !== true) {
    patch = Struct.omit(patch, ["sceneryPhotoSet"]);
  }
  return capabilities?.globalEnvironment === true
    ? patch
    : Struct.omit(patch, ["globalEnvironment"]);
}

/** The shared subset supported by one environment. */
export function pickSharedServerSettings(
  settings: ServerSettings,
  capabilities?: SharedSettingsCapabilities,
): ServerSettingsPatch {
  return filterSharedServerPatch(
    Struct.pick(settings, SHARED_SERVER_SETTING_KEYS),
    capabilities,
    settings,
  );
}

/**
 * Whether an environment can participate in shared-settings sync right now.
 * Auto-settlement establishes baseline support; newer preferences are filtered separately.
 */
export function supportsSharedSettingsSync(environment: {
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "threadAutoSettlement">;
    };
  } | null;
}): boolean {
  return (
    environment.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.threadAutoSettlement === true
  );
}

export interface SharedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly syncEligible: boolean;
  readonly settings: ServerSettings | null;
  readonly capabilities?: SharedSettingsCapabilities | undefined;
}

/**
 * Shared-settings sync targets whose values differ from the primary
 * environment's. Other environments are skipped: nothing can be read from or
 * written to them, or their server lacks baseline shared-settings support. With no
 * primary settings loaded there is nothing to compare against, so nothing is
 * reported. Callers must pass the real loaded settings, never a default
 * fallback, or "apply to all" would push defaults over real values.
 */
export function findSharedSettingsMismatches(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primarySettings: ServerSettings | null;
  readonly primaryCapabilities?: SharedSettingsCapabilities | undefined;
  readonly environments: ReadonlyArray<SharedSettingsEnvironment>;
}): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  if (input.primaryEnvironmentId === null || input.primarySettings === null) {
    return [];
  }
  const primarySettings = pickSharedServerSettings(
    input.primarySettings,
    input.primaryCapabilities,
  );
  return input.environments.flatMap((environment) => {
    if (
      environment.environmentId === input.primaryEnvironmentId ||
      !environment.syncEligible ||
      environment.settings === null
    ) {
      return [];
    }
    const expected = filterSharedServerPatch(
      primarySettings,
      environment.capabilities,
      environment.settings,
      input.primarySettings ?? undefined,
    );
    let actual = filterSharedServerPatch(
      pickSharedServerSettings(environment.settings, environment.capabilities),
      input.primaryCapabilities,
      environment.settings,
    );
    if (!expected.textGenerationModelSelection) {
      actual = Struct.omit(actual, ["textGenerationModelSelection"]);
    }
    return Equal.equals(actual, expected)
      ? []
      : [{ environmentId: environment.environmentId, label: environment.label }];
  });
}
