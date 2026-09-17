import { serverConfigDigest } from "@t3tools/shared/serverConfigDigest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "./serverSettings.ts";

const EDITOR_DISCOVERY_TIMEOUT = Duration.seconds(5);
const REMOTE_OPEN_TARGET_DISCOVERY_TIMEOUT = Duration.seconds(5);

export const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) =>
  discovery.pipe(
    Effect.timeoutOption(EDITOR_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(() => [])),
  );

export const resolveRemoteOpenTargetsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) =>
  discovery.pipe(
    Effect.timeoutOption(REMOTE_OPEN_TARGET_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(() => [])),
  );

export const loadServerConfig = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const keybindings = yield* Keybindings.Keybindings;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
  const keybindingsConfig = yield* keybindings.loadConfigState;
  const providers = yield* providerRegistry.getProviders;
  const settings = ServerSettings.redactServerSettingsForClient(yield* serverSettings.getSettings);
  const [availableEditors, resolvedRemoteOpenTargets] = yield* Effect.all(
    [
      resolveAvailableEditorsForConfig(externalLauncher.resolveAvailableEditors()),
      resolveRemoteOpenTargetsForConfig(remoteOpenTargets.resolveTargets()),
    ],
    { concurrency: "unbounded" },
  );

  return {
    environment: yield* serverEnvironment.getDescriptor,
    auth: yield* serverAuth.getDescriptor(),
    cwd: config.cwd,
    keybindingsConfigPath: config.keybindingsConfigPath,
    keybindings: keybindingsConfig.keybindings,
    issues: keybindingsConfig.issues,
    providers,
    availableEditors,
    remoteOpenTargets: resolvedRemoteOpenTargets,
    observability: {
      logsDirectoryPath: config.logsDir,
      localTracingEnabled:
        config.traceMinLevel === "All" ||
        config.traceMinLevel === "Trace" ||
        config.traceMinLevel === "Debug" ||
        config.traceMinLevel === "Info",
      ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
      otlpTracesEnabled: config.otlpTracesUrl !== undefined,
      ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
      otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
    },
    settings,
    shellResumeCompletionMarker: true,
    threadResumeCompletionMarker: true,
    threadSnapshotPagination: true,
  };
});

export const loadServerConfigSnapshot = loadServerConfig.pipe(
  Effect.map((config) => ({ config, digest: serverConfigDigest(config) })),
);
