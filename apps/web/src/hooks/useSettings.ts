/**
 * Environment-scoped settings hooks.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
 *
 * Live server settings always require an environment id. Primary-environment
 * access is intentionally named as such so environment-sensitive consumers
 * cannot silently read the wrong server's settings.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  type ClientSettingsPatch,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type EnvironmentIdentificationMode,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { subscribeBrowserClientSettings } from "~/clientPersistenceStorage";
import { ensureLocalApi } from "~/localApi";
import {
  getThemeDefinition,
  getThemePreviewSidebarArtwork,
  resolveThemeHalf,
  subscribeToThemePreview,
  themeAllowsSidebarArtwork,
} from "~/themePalette";
import * as Struct from "effect/Struct";
import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { usePrimaryEnvironment } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../components/SidebarStageBackdrop";
import { useTheme } from "./useTheme";

const CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE = "[CLIENT_SETTINGS]";

type UnifiedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const clientSettingsListeners = new Set<() => void>();
const clientSettingsHydrationListeners = new Set<() => void>();
let clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
let clientSettingsHydrated = false;
let clientSettingsHydrationPromise: Promise<void> | null = null;
let clientSettingsHydrationGeneration = 0;
let pendingClientSettingsPatch: ClientSettingsPatch = {};
let queuedClientSettingsWrite: ClientSettings | null = null;
let clientSettingsWritePromise: Promise<void> | null = null;
let clientSettingsWriteGeneration = 0;
let clientSettingsExternalSubscription: (() => void) | null = null;
let clientSettingsExternalRefreshGeneration = 0;
let clientSettingsLocalMutationGeneration = 0;

function emitClientSettingsChange() {
  for (const listener of clientSettingsListeners) {
    listener();
  }
}

function emitClientSettingsHydrationChange() {
  for (const listener of clientSettingsHydrationListeners) {
    listener();
  }
}

function getClientSettingsSnapshot(): ClientSettings {
  return clientSettingsSnapshot;
}

function replaceClientSettingsSnapshot(settings: ClientSettings): void {
  clientSettingsSnapshot = settings;
  emitClientSettingsChange();
}

function setClientSettingsHydrated(nextHydrated: boolean): void {
  if (clientSettingsHydrated === nextHydrated) {
    return;
  }
  clientSettingsHydrated = nextHydrated;
  emitClientSettingsHydrationChange();
}

function syncClientSettingsExternalSubscription(): void {
  const hasSubscribers =
    clientSettingsListeners.size > 0 || clientSettingsHydrationListeners.size > 0;
  if (hasSubscribers && clientSettingsExternalSubscription === null) {
    clientSettingsExternalSubscription = subscribeBrowserClientSettings(() => {
      void refreshClientSettingsFromExternalStorage();
    });
    return;
  }
  if (!hasSubscribers && clientSettingsExternalSubscription !== null) {
    clientSettingsExternalSubscription();
    clientSettingsExternalSubscription = null;
  }
}

function subscribeClientSettings(listener: () => void): () => void {
  clientSettingsListeners.add(listener);
  syncClientSettingsExternalSubscription();
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsListeners.delete(listener);
    syncClientSettingsExternalSubscription();
  };
}

function getClientSettingsHydratedSnapshot(): boolean {
  return clientSettingsHydrated;
}

function subscribeClientSettingsHydration(listener: () => void): () => void {
  clientSettingsHydrationListeners.add(listener);
  syncClientSettingsExternalSubscription();
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsHydrationListeners.delete(listener);
    syncClientSettingsExternalSubscription();
  };
}

async function hydrateClientSettings(): Promise<void> {
  if (clientSettingsHydrated) {
    return;
  }
  if (clientSettingsHydrationPromise) {
    return clientSettingsHydrationPromise;
  }

  const hydrationGeneration = clientSettingsHydrationGeneration;
  const externalRefreshGeneration = clientSettingsExternalRefreshGeneration;
  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (
        hydrationGeneration !== clientSettingsHydrationGeneration ||
        externalRefreshGeneration !== clientSettingsExternalRefreshGeneration
      ) {
        return;
      }
      const pendingPatch = pendingClientSettingsPatch;
      pendingClientSettingsPatch = {};
      const hydratedSettings = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...persistedSettings,
        ...pendingPatch,
      };
      replaceClientSettingsSnapshot(hydratedSettings);
      setClientSettingsHydrated(true);
      if (Object.keys(pendingPatch).length > 0) enqueueClientSettingsWrite(hydratedSettings);
    } catch (error) {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, {
        operation: "hydrate",
        ...safeErrorLogAttributes(error),
      });
      throw error;
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (clientSettingsHydrationPromise === hydrationPromise) {
      clientSettingsHydrationPromise = null;
    }
  });
  clientSettingsHydrationPromise = hydrationPromise;

  return clientSettingsHydrationPromise;
}

async function waitForClientSettingsWrites(): Promise<void> {
  for (;;) {
    const write = clientSettingsWritePromise;
    if (write === null) return;
    await write;
  }
}

async function refreshClientSettingsFromExternalStorage(): Promise<void> {
  const refreshGeneration = ++clientSettingsExternalRefreshGeneration;
  const localMutationGeneration = clientSettingsLocalMutationGeneration;
  try {
    // A local full-document write wins if it overlaps an older cross-tab
    // notification. Wait for it, then read whichever document is actually
    // current instead of briefly rolling the UI back to the other tab's copy.
    await waitForClientSettingsWrites();
    const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
    if (
      refreshGeneration !== clientSettingsExternalRefreshGeneration ||
      localMutationGeneration !== clientSettingsLocalMutationGeneration
    ) {
      return;
    }
    const pendingPatch = pendingClientSettingsPatch;
    pendingClientSettingsPatch = {};
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ...persistedSettings,
      ...pendingPatch,
    };
    replaceClientSettingsSnapshot(settings);
    setClientSettingsHydrated(true);
    if (Object.keys(pendingPatch).length > 0) enqueueClientSettingsWrite(settings);
  } catch (error) {
    console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} external sync failed`, {
      operation: "external-sync",
      ...safeErrorLogAttributes(error),
    });
  }
}

function enqueueClientSettingsWrite(settings: ClientSettings): void {
  queuedClientSettingsWrite = settings;
  if (clientSettingsWritePromise) return;

  const writeGeneration = clientSettingsWriteGeneration;
  const writePromise = (async () => {
    for (;;) {
      if (writeGeneration !== clientSettingsWriteGeneration) return;
      const next = queuedClientSettingsWrite;
      if (next === null) return;
      queuedClientSettingsWrite = null;
      try {
        await ensureLocalApi().persistence.setClientSettings(next);
      } catch (error) {
        console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
          operation: "persist",
          ...safeErrorLogAttributes(error),
        });
      }
    }
  })().finally(() => {
    if (clientSettingsWritePromise === writePromise) {
      clientSettingsWritePromise = null;
      if (queuedClientSettingsWrite) enqueueClientSettingsWrite(queuedClientSettingsWrite);
    }
  });
  clientSettingsWritePromise = writePromise;
}

function persistClientSettingsPatch(patch: ClientSettingsPatch): void {
  clientSettingsLocalMutationGeneration += 1;
  pendingClientSettingsPatch = { ...pendingClientSettingsPatch, ...patch };
  const settings = { ...getClientSettingsSnapshot(), ...patch };
  replaceClientSettingsSnapshot(settings);
  if (!clientSettingsHydrated) {
    void hydrateClientSettings().catch(() => undefined);
    return;
  }
  pendingClientSettingsPatch = {};
  enqueueClientSettingsWrite(settings);
}

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: UnifiedSettingsPatch): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Non-hook accessor for the current merged client settings snapshot.
 * Used by non-React code paths (e.g. runtime services) that need the latest
 * settings without subscribing.
 */
export function getClientSettings(): ClientSettings {
  return getClientSettingsSnapshot();
}

/**
 * Resolves once client settings have been read from disk.
 *
 * The pre-hydration snapshot is just the schema defaults, so imperative paths
 * that open a preview must await this or they bake the built-in viewport, zoom
 * and appearance into a tab that never picks up the user's saved values.
 */
export function ensureClientSettingsHydrated(): Promise<void> {
  return hydrateClientSettings();
}

export function useClientSettingsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
}

function useClientSettingsValue(): ClientSettings {
  return useSyncExternalStore(
    subscribeClientSettings,
    getClientSettingsSnapshot,
    () => DEFAULT_CLIENT_SETTINGS,
  );
}

export function mergeEnvironmentSettings(
  serverSettings: ServerSettings,
  clientSettings: ClientSettings,
): UnifiedSettings {
  return { ...serverSettings, ...clientSettings };
}

function useMergedSettings<T>(
  serverSettings: ServerSettings,
  selector: ((settings: UnifiedSettings) => T) | undefined,
): T {
  const clientSettings = useClientSettingsValue();

  const merged = useMemo<UnifiedSettings>(
    () => mergeEnvironmentSettings(serverSettings, clientSettings),
    [clientSettings, serverSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

export function useClientSettings<T = ClientSettings>(
  selector?: (settings: ClientSettings) => T,
): T {
  const settings = useClientSettingsValue();
  return useMemo(() => (selector ? selector(settings) : (settings as T)), [selector, settings]);
}

export function resolveEnvironmentIdentificationMode(input: {
  mode: EnvironmentIdentificationMode;
  settingsHydrated: boolean;
  paletteThemeActive?: boolean;
  paletteThemeAllowsArtwork?: boolean;
  pillAvailable?: boolean;
}): EnvironmentIdentificationMode {
  // Avoid briefly rendering the default artwork before a persisted pill/none choice loads.
  if (!input.settingsHydrated) return "none";
  // Artwork palettes are maintained for built-ins only. Keep an explicit
  // "none", but use the theme-aware pill for user-controlled palettes.
  const mode =
    input.paletteThemeActive && !input.paletteThemeAllowsArtwork && input.mode === "artwork"
      ? "pill"
      : input.mode;
  // A stored or remapped pill with no label becomes artwork. Callers that have
  // no artwork for this stage still paint nothing.
  return mode === "pill" && input.pillAvailable === false ? "artwork" : mode;
}

const ENVIRONMENT_IDENTIFICATION_MODES_WITH_PILL = ["artwork", "pill", "none"] as const;
const ENVIRONMENT_IDENTIFICATION_MODES_WITHOUT_PILL = ["artwork", "none"] as const;

export function resolveEnvironmentIdentificationSetting(input: {
  mode: EnvironmentIdentificationMode;
  pillAvailable: boolean;
}): {
  value: EnvironmentIdentificationMode;
  modes: readonly EnvironmentIdentificationMode[];
} {
  const modes = input.pillAvailable
    ? ENVIRONMENT_IDENTIFICATION_MODES_WITH_PILL
    : ENVIRONMENT_IDENTIFICATION_MODES_WITHOUT_PILL;

  return {
    modes,
    value: input.mode === "pill" && !input.pillAvailable ? "artwork" : input.mode,
  };
}

export function useEnvironmentIdentificationMode(): EnvironmentIdentificationMode {
  const settingsHydrated = useClientSettingsHydrated();
  const mode = useClientSettingsValue().environmentIdentificationMode;
  const stageLabel = useEnvironmentStageLabel();
  const { resolvedTheme, theme, themeHalves } = useTheme();
  const previewSidebarArtwork = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewSidebarArtwork,
    () => null,
  );
  const activeTheme = resolveThemeHalf(theme, themeHalves, resolvedTheme);
  const activeThemeDefinition = getThemeDefinition(activeTheme);
  return resolveEnvironmentIdentificationMode({
    mode,
    settingsHydrated,
    paletteThemeActive: previewSidebarArtwork !== null || activeThemeDefinition !== null,
    paletteThemeAllowsArtwork: previewSidebarArtwork ?? themeAllowsSidebarArtwork(activeTheme),
    pillAvailable: resolveEnvironmentIdentificationPillLabel(stageLabel) !== null,
  });
}

/**
 * Whether the legacy sidebar (Settings → General → Legacy features) replaces
 * the default one.
 *
 * Held at the default sidebar until client settings hydrate: the pre-hydration
 * snapshot is just the schema defaults, so resolving against it could mount one
 * sidebar and then swap it out once persisted settings land — remounting the
 * whole tree for everyone instead of only for legacy opt-ins.
 */
export function useLegacySidebarEnabled(): boolean {
  const settingsHydrated = useClientSettingsHydrated();
  const legacySidebarEnabled = useClientSettingsValue().legacySidebarEnabled;
  return settingsHydrated && legacySidebarEnabled;
}

/** Read current settings for one environment, merged with client-local preferences. */
export function useEnvironmentSettings<T = UnifiedSettings>(
  environmentId: EnvironmentId,
  selector?: (settings: UnifiedSettings) => T,
): T {
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return useMergedSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, selector);
}

/** Primary-only settings access for the settings UI and other explicitly global surfaces. */
export function usePrimarySettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  return useMergedSettings(useAtomValue(primaryServerSettingsAtom), selector);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Client keys go through client persistence.
 */
function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  const persistServerSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "server settings update",
  );
  const updateSettings = useCallback(
    (patch: UnifiedSettingsPatch) => {
      const { serverPatch, clientPatch } = splitPatch(patch);

      if (Object.keys(serverPatch).length > 0) {
        if (environmentId) {
          void persistServerSettings({
            environmentId,
            input: { patch: serverPatch },
          });
        }
      }
      if (Object.keys(clientPatch).length > 0) {
        persistClientSettingsPatch(clientPatch);
      }
    },
    [environmentId, persistServerSettings],
  );

  return updateSettings;
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function useUpdateClientSettings() {
  return useCallback((patch: ClientSettingsPatch) => {
    persistClientSettingsPatch(patch);
  }, []);
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsWriteGeneration += 1;
  clientSettingsExternalRefreshGeneration += 1;
  clientSettingsLocalMutationGeneration += 1;
  clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
  clientSettingsHydrated = false;
  clientSettingsHydrationPromise = null;
  pendingClientSettingsPatch = {};
  queuedClientSettingsWrite = null;
  clientSettingsWritePromise = null;
  clientSettingsListeners.clear();
  clientSettingsHydrationListeners.clear();
  syncClientSettingsExternalSubscription();
}

export function __setClientSettingsForTests(settings: ClientSettings): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsWriteGeneration += 1;
  clientSettingsExternalRefreshGeneration += 1;
  clientSettingsLocalMutationGeneration += 1;
  clientSettingsSnapshot = settings;
  clientSettingsHydrated = true;
  clientSettingsHydrationPromise = null;
  pendingClientSettingsPatch = {};
  queuedClientSettingsWrite = null;
  clientSettingsWritePromise = null;
}

export function __persistClientSettingsPatchForTests(patch: ClientSettingsPatch): void {
  persistClientSettingsPatch(patch);
}

export async function __waitForClientSettingsPersistenceForTests(): Promise<void> {
  await waitForClientSettingsWrites();
}
