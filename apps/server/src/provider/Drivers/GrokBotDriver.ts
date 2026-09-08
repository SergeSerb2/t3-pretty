import { GrokBotSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import type * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/TextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeGrokBotClient, resolveCursorAccessToken } from "../grokBot/GrokBotGateway.ts";
import { makeGrokBotAdapter } from "../Layers/GrokBotAdapter.ts";
import {
  buildInitialGrokBotProviderSnapshot,
  checkGrokBotProviderStatus,
} from "../Layers/GrokBotProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const decodeGrokBotSettings = Schema.decodeSync(GrokBotSettings);

const DRIVER_KIND = ProviderDriverKind.make("grokBot");
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({ provider: DRIVER_KIND, packageName: null }),
);

export type GrokBotDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

/**
 * Grok Bot driver. No subprocess: the instance holds one HTTP client for
 * Cursor's Grok Bot API and the user's box gateway. The Cursor token is read
 * on every request so a `cursor-agent login` refresh is picked up without a
 * restart.
 */
export const GrokBotDriver: ProviderDriver<GrokBotSettings, GrokBotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Grok Bot",
    supportsMultipleInstances: true,
  },
  configSchema: GrokBotSettings,
  defaultConfig: (): GrokBotSettings => decodeGrokBotSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GrokBotSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: "",
        env: processEnv,
      });

      const accessToken = resolveCursorAccessToken({
        explicitToken: effectiveConfig.accessToken,
        environment: processEnv,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.orElseSucceed(() => undefined),
      );
      const machineId = yield* crypto.randomUUIDv4.pipe(
        Effect.map((id) => id.replace(/-/g, "").repeat(2)),
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to generate a Grok Bot machine id.",
              cause,
            }),
        ),
      );
      const client = yield* makeGrokBotClient({ accessToken, machineId }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );

      const adapter = yield* makeGrokBotAdapter(client, {
        instanceId,
        environment: processEnv,
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<GrokBotSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialGrokBotProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkGrokBotProviderStatus(effectiveConfig, client).pipe(
          Effect.map(stampIdentity),
        ),
        enrichSnapshot: () => Effect.void,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Grok Bot snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: makeUnsupportedTextGeneration("Grok Bot"),
      } satisfies ProviderInstance;
    }),
};
