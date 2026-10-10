import * as AgentInstructionFiles from "./instructions/AgentInstructionFiles.ts";
import * as SkillLibrary from "./skills/SkillLibrary.ts";
import * as SkillMarketplace from "./skills/SkillMarketplace.ts";
import * as AppsService from "./apps/AppsService.ts";
import * as AppsHttp from "./apps/AppsHttp.ts";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import type { RelayManagedEndpointRuntimeConfig } from "@t3tools/contracts/relay";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Random from "effect/Random";
import * as Semaphore from "effect/Semaphore";

import * as PullRequestSyncReactor from "./orchestration-v2/PullRequestSyncReactor.ts";
import * as PullRequestWatchReactor from "./orchestration-v2/PullRequestWatchReactor.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi, type RepositoryIdentity } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "./background/HostPowerMonitor.ts";
import * as ServerConfig from "./config.ts";
import {
  layerOtlpTracesProxyRoute as otlpTracesProxyRouteLayer,
  layerAssetRoute as assetRouteLayer,
  layerAttachmentUploadRoute as attachmentUploadRouteLayer,
  layerServerEnvironmentHttpApi as serverEnvironmentHttpApiLayer,
  serverConfigHttpApiLayer,
  layerStaticAndDevRoute as staticAndDevRouteLayer,
  layerBrowserApiCors as browserApiCorsLayer,
  layerHttpCompression as httpCompressionLayer,
  withUntracedRequests,
} from "./http.ts";
import { guardHttpResponseWriteErrors } from "./httpResponseErrorGuard.ts";
import { fixPath } from "./os-jank.ts";
import { layer as websocketRpcRouteLayer } from "./ws.ts";
import * as AgentScopeLive from "./process/agentScope.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as NodePtyAdapter from "./terminal/NodePtyAdapter.ts";
import { layer as pullRequestHttpApiLayer } from "./pullRequest/http.ts";
import { readAloudHttpApiLayer } from "./readAloud/http.ts";
import * as PullRequestProviderRegistry from "./pullRequest/PullRequestProviderRegistry.ts";
import * as PullRequestService from "./pullRequest/PullRequestService.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as PullRequestFilesViewed from "./persistence/PullRequestFilesViewed.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as ProviderEventIngestor from "./orchestration-v2/ProviderEventIngestor.ts";
import * as ModelManifest from "./provider/ModelManifest.ts";
import * as ResetCreditCoordinator from "./provider/resetCreditCoordinator.ts";
import * as EventNdjsonLogger from "./provider/EventNdjsonLogger.ts";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as OpenCodeRuntime from "@t3tools/provider-opencode/server/OpenCodeRuntime";
import * as OpenCodeServerLedger from "@t3tools/provider-opencode/server/OpenCodeServerLedger";
import * as ProviderHostLive from "./provider/ProviderHostLive.ts";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import * as CheckpointDiffQuery from "./checkpointing/CheckpointDiffQuery.ts";
import * as CheckpointStore from "./checkpointing/CheckpointStore.ts";
import * as AntigravityUsage from "./provider/Drivers/AntigravityUsage.ts";
import * as CursorAccountReader from "@t3tools/provider-cursor/server/CursorAccountReader";
import * as CursorKeychain from "@t3tools/provider-cursor/server/CursorKeychain";
import * as CursorUsageAccounts from "@t3tools/provider-cursor/server/CursorUsageAccounts";
import * as TextGeneration from "./textGeneration/TextGeneration.ts";
import { layer as ProviderInstanceRegistryHydrationLive } from "./provider/ProviderInstanceRegistryHydration.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as McpHttpServer from "./mcp/McpHttpServer.ts";
import * as McpSessionRegistry from "./mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./mcp/PreviewAutomationBroker.ts";
import * as AutomationStore from "./automations/AutomationStore.ts";
import * as AutomationScheduler from "./automations/AutomationScheduler.ts";
import * as AutomationWebhookHttp from "./automations/AutomationWebhookHttp.ts";
import { ProjectionAutomationRepositoryLive } from "./persistence/ProjectionAutomations.ts";
import { ProjectionAutomationRunRepositoryLive } from "./persistence/ProjectionAutomationRuns.ts";
import * as SecretRequestBroker from "./mcp/SecretRequestBroker.ts";
import * as DeviceService from "./device/DeviceService.ts";
import { layer as deviceHubProxyRouteLayer } from "./device/DeviceHubProxy.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as PortScanner from "./preview/PortScanner.ts";
import * as PreviewBrowser from "./preview/PreviewBrowser.ts";
import * as DesktopBrowserChannel from "./preview/DesktopBrowserChannel.ts";
import * as ServerBrowser from "./preview/ServerBrowser.ts";
import * as ServerBrowserStream from "./preview/ServerBrowserStream.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as GitManager from "./git/GitManager.ts";
import * as EnvironmentTheme from "./environmentTheme.ts";
import * as Keybindings from "./keybindings.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import * as HomeSuggestions from "./homeSuggestions/HomeSuggestionsService.ts";
import * as HomeSuggestionsMesh from "./homeSuggestions/HomeSuggestionsMesh.ts";
import * as AgentAwarenessRelay from "./relay/AgentAwarenessRelay.ts";
import * as ActivityHeadlineReactor from "./orchestration-v2/ActivityHeadlineReactor.ts";
import { hasCloudPublicConfig } from "./cloud/publicConfig.ts";
import { layer as ProviderRegistryLive } from "./provider/ProviderRegistry.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as ProjectEnrichmentService from "./project/ProjectEnrichmentService.ts";
import * as NativeAppIconResolver from "./assets/NativeAppIconResolver.ts";
import * as AntigravityInstallation from "./provider/AntigravityInstallation.ts";
import * as CodexInstallation from "./provider/CodexInstallation.ts";
import * as ProviderInstanceRegistry from "./provider/ProviderInstanceRegistry.ts";
import * as ProviderAdapterRegistry from "./orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRegistry from "./provider/ProviderRegistry.ts";
import { layer as ProviderUsageLimitsIngestionLive } from "./provider/ProviderUsageLimitsIngestion.ts";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import * as ProjectFaviconResolver from "./project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "./project/T3ProjectFileLoader.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as ProjectCloneTracker from "./project/ProjectCloneTracker.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as ComputerUseService from "./computerUse/ComputerUseService.ts";
import * as OriginCli from "./sourceControl/OriginCli.ts";
import * as SourceControlBuiltInDrivers from "./sourceControl/builtInDrivers.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as PullRequestReadCache from "./pullRequest/PullRequestReadCache.ts";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import * as WorktreeSetupTracker from "./project/WorktreeSetupTracker.ts";
import { layer as ObservabilityLive } from "./observability/Observability.ts";
import * as HeapSnapshot from "./observability/HeapSnapshot.ts";
import * as EventLoopMonitor from "./observability/EventLoopMonitor.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as AgentMonitoring from "./observability/AgentMonitoring.ts";
import * as DirectEndpoints from "./environment/DirectEndpoints.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import {
  layer as authHttpApiLayer,
  layerAuthenticatedAuth as environmentAuthenticatedAuthLayer,
} from "./auth/http.ts";
import * as ReplayMarkers from "./auth/replayMarkers.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as McpOAuth from "./auth/McpOAuth.ts";
import * as McpOAuthHttp from "./auth/mcpOAuthHttp.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import {
  connectHttpApiLayer,
  pendingServiceUpdateExists,
  reconcileDesiredCloudLinkIfStillDesired,
  recoverManagedCloudTunnel,
  registerManagedCloudTunnelRecovery,
  startManagedCloudTunnelIfOriginConfirmed,
  releaseManagedTunnelOnShutdown,
} from "./cloud/http.ts";
import * as CloudLink from "./cloud/CloudLink.ts";
import { shouldRetryCloudLink } from "./cloud/CloudLink.ts";
import { layerServerRelayBroker as serverRelayBrokerTracingLayer } from "./cloud/relayTracing.ts";
import * as CloudManagedEndpointRuntime from "./cloud/ManagedEndpointRuntime.ts";
import {
  MANAGED_TUNNEL_FIRST_REGISTRATION_JITTER,
  MANAGED_TUNNEL_RECOVERY_COOLDOWN,
  managedTunnelStartupAction,
  retryManagedTunnelRegistration,
} from "./cloud/managedTunnelStartup.ts";
import * as CloudCliTokenManager from "./cloud/CliTokenManager.ts";
import * as CloudCliState from "./cloud/CliState.ts";
import * as ServerSelfUpdate from "./cloud/selfUpdate.ts";
import * as WebhookRoute from "./scheduledTasks/webhookRoute.ts";
import * as RelayDeliveryProof from "./scheduledTasks/RelayDeliveryProof.ts";
import * as DesktopAppUpdate from "./desktopUpdate/DesktopAppUpdate.ts";
import * as ServiceLauncherClient from "./cloud/serviceLauncherClient.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as HostResources from "./resourceTelemetry/HostResources.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as DesktopTelemetryReceiver from "./resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as NativeTelemetryClient from "./resourceTelemetry/NativeTelemetryClient.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import * as ResourceMonitorBinary from "./resourceTelemetry/ResourceMonitorBinary.ts";
import * as ResourceTelemetry from "./resourceTelemetry/ResourceTelemetry.ts";
import * as UsageService from "./usage/UsageService.ts";
import * as StorageInventoryService from "./storage/StorageInventoryService.ts";
import {
  layerEventInfrastructure as OrchestrationEventInfrastructureLayerLive,
  layerProduction as OrchestrationV2ProductionLayerLive,
  layerProjectService as ProjectServiceLayerLive,
  layerProjectSetupScriptRunner as ProjectSetupScriptRunnerLayerLive,
} from "./orchestration-v2/runtimeLayer.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ThreadSearch from "./orchestration-v2/ThreadSearch.ts";
import * as ResourceCleanupService from "./orchestration-v2/ResourceCleanupService.ts";
import * as ThreadSettlementService from "./orchestration-v2/ThreadSettlementService.ts";
import * as ThreadPullRequestService from "./orchestration-v2/ThreadPullRequestService.ts";
import * as RunFinalizationService from "./orchestration-v2/RunFinalizationService.ts";
import * as ProjectionStoreV2 from "./orchestration-v2/ProjectionStore.ts";
import {
  clearPersistedServerRuntimeState,
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState.ts";
import { layer as orchestrationHttpApiLayer } from "./orchestration-v2/http.ts";
import { layer as projectHttpApiLayer } from "./project/http.ts";
import * as NetService from "@t3tools/shared/Net";
import * as RelayClient from "@t3tools/shared/relayClient";
import { disableTailscaleServe, ensureTailscaleServe } from "@t3tools/tailscale";
import * as ServerActivation from "./serverActivation.ts";

// MCP handoff thread IDs include escaped provenance and can exceed find-my-way's
// 100-character default for one path segment.
export const HTTP_ROUTER_CONFIG = {
  maxParamLength: 512,
} as const;

// Effect's default preemptive shutdown waits 20s before finalizing request scopes.
// T3's primary transport is long-lived WebSocket RPC, whose Effect scope finalizer
// already closes the websocket gracefully. Do not add an artificial drain before
// those finalizers get a chance to run.
const HTTP_PREEMPTIVE_SHUTDOWN_GRACE_MS = 0;
const ResourceAttributionLayerLive = ResourceAttribution.layer;
const ApplicationObservabilityLive = EventLoopMonitor.layer.pipe(
  Layer.provideMerge(ObservabilityLive),
  Layer.provideMerge(ResourceAttributionLayerLive),
);

// One rotating store behind both logger views, so driver instances never race
// its rotation. Diagnostics must not block startup: a store that cannot open
// degrades to the no-op loggers. Pretty keeps T3CODE_LOG_PROVIDER_EVENTS_VERBOSE
// so native per-token records can be retained for protocol debugging.
const layerProviderEventLoggers = Layer.effect(
  ProviderEventLoggers.ProviderEventLoggers,
  Effect.gen(function* () {
    const { providerEventLogPath } = yield* ServerConfig.ServerConfig;
    const attribution = yield* ResourceAttribution.ResourceAttribution;
    const verbose = yield* Config.Boolean("T3CODE_LOG_PROVIDER_EVENTS_VERBOSE").pipe(
      Config.withDefault(false),
    );
    const store = yield* EventNdjsonLogger.makeEventNdjsonLogStore(providerEventLogPath, {
      attribution,
      verbose,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(error.message, { error }).pipe(
          Effect.annotateLogs({ scope: "provider-observability" }),
          Effect.as(undefined),
        ),
      ),
    );
    if (!store) return ProviderEventLoggers.NoOpProviderEventLoggers;
    yield* Effect.addFinalizer(() => store.close());
    return { native: store.logger("native"), canonical: store.logger("canonical") };
  }),
);

const PtyAdapterLive = NodePtyAdapter.layer;

const ServerSettingsLayerLive = ServerSettings.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(SqlitePersistence.layerConfig),
);

const NativeTelemetryLayerLive = NativeTelemetryClient.layer.pipe(
  Layer.provide(ResourceMonitorBinary.layer),
);
const DesktopTelemetryReceiverLayerLive = DesktopTelemetryReceiver.layer.pipe(
  Layer.provideMerge(ServerSettingsLayerLive),
);

const ResourceTelemetryLayerLive = ResourceTelemetry.layer.pipe(
  Layer.provideMerge(NativeTelemetryLayerLive),
  Layer.provideMerge(DesktopTelemetryReceiverLayerLive),
);

const HostPowerMonitorLayerLive = HostPowerMonitor.layer.pipe(
  Layer.provide(DesktopTelemetryReceiverLayerLive),
);

// Reuses DesktopTelemetryReceiverLayerLive: a fresh receiver layer here
// would open a second reader on the desktop telemetry fd.
const DesktopAppUpdateLayerLive = DesktopAppUpdate.layer.pipe(
  Layer.provide(DesktopTelemetryReceiverLayerLive),
);

const BackgroundLayerLive = BackgroundPolicy.layer.pipe(
  Layer.provide(HostPowerMonitorLayerLive),
  Layer.provideMerge(ServerSettingsLayerLive),
);

const UsageLayerLive = UsageService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      AntigravityUsage.layer,
      CursorUsageAccounts.layer.pipe(
        Layer.provide(CursorAccountReader.layer.pipe(Layer.provide(CursorKeychain.layer))),
      ),
    ).pipe(Layer.provide(ProviderHostLive.layer.pipe(Layer.provide(ServerSecretStore.layer)))),
  ),
  Layer.provide(ServerSettingsLayerLive),
);

const ResourceDiagnosticsLayerLive = Layer.mergeAll(
  HostResources.layer,
  ResourceTelemetryLayerLive,
  ProcessDiagnostics.layer.pipe(Layer.provide(ResourceTelemetryLayerLive)),
  ProcessResourceMonitor.layer.pipe(Layer.provide(ResourceTelemetryLayerLive)),
);

const RelayClientLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return RelayClient.layerCloudflared({ baseDir: config.baseDir });
  }),
);

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return NodeHttpServer.layer(() => guardHttpResponseWriteErrors(NodeHttp.createServer()), {
      host: config.host ?? "127.0.0.1",
      port: config.port,
      gracefulShutdownTimeout: HTTP_PREEMPTIVE_SHUTDOWN_GRACE_MS,
      // Negotiate permessage-deflate with clients that offer it; clients
      // that don't still get uncompressed frames on their connection.
      // Context takeover stays enabled (ws default) so the compression
      // window is shared across frames — that also makes small frames cheap
      // to compress, so no size threshold is set (ws only honors
      // `threshold` when context takeover is disabled).
      websocket: { perMessageDeflate: true },
    });
  }),
);

const PlatformServicesLive = NodeServices.layer;

const PersistenceLayerLive = Layer.empty.pipe(Layer.provideMerge(SqlitePersistence.layerConfig));

const StorageInventoryLayerLive = StorageInventoryService.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(ProjectStore.layer),
  Layer.provide(ProjectionStoreV2.layer),
  Layer.provide(PersistenceLayerLive),
);

const VcsDriverRegistryLayerLive = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProjectConfig.layer),
);

const SourceControlProviderRegistryLayerLive = SourceControlProviderRegistry.layer.pipe(
  Layer.provideMerge(SourceControlBuiltInDrivers.layer),
  Layer.provide(OriginCli.layer),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(VcsDriverRegistryLayerLive),
);

const RepositoryIdentityResolverLayerLive = Layer.effect(
  RepositoryIdentityResolver.RepositoryIdentityResolver,
  Effect.gen(function* () {
    const registry = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
    return yield* RepositoryIdentityResolver.make({
      // Each host that can refine an identity gets a turn; the first one that changes it wins.
      refine: Effect.fn(function* (identity: RepositoryIdentity) {
        for (const kind of SourceControlBuiltInDrivers.BUILT_IN_SOURCE_CONTROL_DRIVERS.map(
          (driver) => driver.kind,
        )) {
          const provider = yield* registry.get(kind);
          if (provider.refineRepositoryIdentity === undefined) continue;
          const refined = yield* provider.refineRepositoryIdentity({
            identity,
            resolveContext: (input) =>
              registry.resolveHandle(input).pipe(Effect.map((handle) => handle.context)),
          });
          if (refined !== identity) return refined;
        }
        return identity;
      }),
    });
  }),
).pipe(Layer.provide(SourceControlProviderRegistryLayerLive), Layer.provide(ProcessRunner.layer));

const PullRequestServiceLive = PullRequestService.layer.pipe(
  Layer.provide(PullRequestProviderRegistry.layer),
  // Where the viewed-file marks live for a host that keeps none of its own.
  Layer.provide(PullRequestFilesViewed.layer),
  Layer.provide(PullRequestReadCache.layer),
  Layer.provide(SourceControlProviderRegistryLayerLive),
  Layer.provide(SourceControlRateLimit.layer),
);

const GitManagerLayerLive = GitManager.layer.pipe(
  // Per-project git settings resolve the acting thread's project.
  Layer.provide(Layer.merge(ProjectionStoreV2.layer, ProjectStore.layer)),
  Layer.provideMerge(ProjectSetupScriptRunnerLayerLive),
  Layer.provideMerge(WorktreeSetupTracker.layer),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(SourceControlProviderRegistryLayerLive),
  Layer.provideMerge(
    TextGeneration.layer.pipe(Layer.provide(SourceControlProviderRegistryLayerLive)),
  ),
);

const GitLayerLive = Layer.empty.pipe(
  Layer.provideMerge(GitManagerLayerLive),
  Layer.provideMerge(GitVcsDriver.layer),
);

const GitWorkflowLayerLive = GitWorkflowService.layer.pipe(
  Layer.provideMerge(VcsDriverRegistryLayerLive),
  Layer.provideMerge(GitLayerLive),
);

const SourceControlRepositoryServiceLayerLive = SourceControlRepositoryService.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(SourceControlProviderRegistryLayerLive),
);

const ProjectCloneTrackerLayerLive = ProjectCloneTracker.layer.pipe(
  Layer.provide(SourceControlRepositoryServiceLayerLive),
);

const ReviewLayerLive = ReviewService.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(VcsDriverRegistryLayerLive),
);

const VcsLayerLive = Layer.empty.pipe(
  Layer.provideMerge(VcsProjectConfig.layer),
  Layer.provideMerge(VcsDriverRegistryLayerLive),
  Layer.provideMerge(VcsProvisioningService.layer.pipe(Layer.provide(VcsDriverRegistryLayerLive))),
  Layer.provideMerge(GitWorkflowLayerLive),
  Layer.provideMerge(ReviewLayerLive),
  Layer.provideMerge(SourceControlRepositoryServiceLayerLive),
  Layer.provideMerge(ProjectCloneTrackerLayerLive),
  Layer.provideMerge(
    VcsStatusBroadcaster.layer.pipe(
      Layer.provide(GitWorkflowLayerLive),
      // Auto-pull reads the project row. The orchestration runtime also
      // consumes the broadcaster (run finalization), so the policy cannot read
      // the store from the runtime's output.
      Layer.provide(
        VcsStatusBroadcaster.layerAutoPullPolicy.pipe(Layer.provide(ProjectStore.layer)),
      ),
    ),
  ),
);

const CheckpointStoreLayerLive = CheckpointStore.layer.pipe(
  Layer.provide(VcsDriverRegistryLayerLive),
);

const PortScannerLayerLive = PortScanner.layer.pipe(Layer.provide(ProcessRunner.layer));

const TerminalLayerLive = TerminalManager.layer.pipe(
  Layer.provide(PtyAdapterLive),
  Layer.provide(PortScannerLayerLive),
  Layer.provide(NativeTelemetryLayerLive),
);

const PreviewLayerLive = Layer.empty.pipe(
  Layer.provideMerge(PreviewManager.layer),
  Layer.provideMerge(PortScannerLayerLive),
);

const DeviceLayerLive = DeviceService.layer.pipe(
  Layer.provide(ServerSettingsLayerLive),
  Layer.provide(ProcessRunner.layer),
  Layer.provide(NetService.layer),
);

const WorkspaceEntriesLayerLive = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));

const WorkspaceFileSystemLayerLive = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntriesLayerLive),
);

const WorkspaceLayerLive = Layer.mergeAll(
  WorkspacePaths.layer,
  WorkspaceEntriesLayerLive,
  WorkspaceFileSystemLayerLive,
);

const ProjectFaviconResolverLayerLive = ProjectFaviconResolver.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(T3ProjectFileLoader.layer),
);

const ServerEnvironmentLayerLive = ServerEnvironment.layer.pipe(
  Layer.provide(ServerSecretStore.layer),
);

const AuthLayerLive = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(PersistenceLayerLive),
  Layer.provide(ServerEnvironmentLayerLive),
  Layer.provide(ServerSecretStore.layer),
);

const CloudManagedEndpointRuntimeLive = Layer.mergeAll(
  RelayClientLive,
  CloudManagedEndpointRuntime.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(RelayClientLive),
  ),
);

const OrchestrationV2RuntimeLayerLive = OrchestrationV2ProductionLayerLive.pipe(
  Layer.provide(ProviderEventIngestor.layerAnalytics),
  Layer.provide(CheckpointStoreLayerLive),
  Layer.provide(GitWorkflowLayerLive),
  Layer.provide(ResourceCleanupService.layer),
  Layer.provide(
    RunFinalizationService.layerObserver.pipe(
      Layer.provide(ProjectionStoreV2.layer),
      Layer.provide(PullRequestServiceLive),
      Layer.provide(ProjectServiceLayerLive),
    ),
  ),
);

const OrchestrationApplicationLayerLive = CheckpointDiffQuery.layer.pipe(
  Layer.provideMerge(CheckpointStoreLayerLive),
  Layer.provideMerge(OrchestrationV2RuntimeLayerLive),
);

// Automatic thread settlement (#8600): a server-owned sweep evaluates
// inactivity and merged pull requests, then settles through the orchestrator
// so every client sees the same shelf.
const ThreadSettlementWorkerLive = Layer.effectDiscard(
  ThreadSettlementService.make.pipe(Effect.flatMap((service) => service.start())),
).pipe(Layer.provide(PullRequestServiceLive), Layer.provide(ProjectionStoreV2.layer));

const ThreadPullRequestWorkerLive = Layer.effectDiscard(
  ThreadPullRequestService.make.pipe(Effect.flatMap((service) => service.start())),
).pipe(Layer.provide(PullRequestServiceLive));

const ProviderInstallationRefreshLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const antigravity = yield* AntigravityInstallation.AntigravityInstallation;
    const codex = yield* CodexInstallation.CodexInstallation;
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    yield* Stream.merge(
      antigravity.changes.pipe(
        Stream.changesWith((a, b) => a.installedVersion === b.installedVersion),
        Stream.drop(1),
      ),
      codex.changes.pipe(
        Stream.changesWith((a, b) => a.installedVersion === b.installedVersion),
        Stream.drop(1),
      ),
    ).pipe(
      Stream.runForEach((state) =>
        instances.listInstances.pipe(
          Effect.flatMap((entries) =>
            Effect.forEach(
              entries.filter((instance) => instance.driverKind === state.driver),
              (instance) => providers.refreshInstance(instance.instanceId),
              { discard: true },
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);

const AutomationStoreLive = AutomationStore.layer.pipe(
  Layer.provide(ProjectionAutomationRepositoryLive),
  Layer.provide(ProjectionAutomationRunRepositoryLive),
  Layer.provide(ProjectServiceLayerLive),
);

const RuntimeCoreDependenciesBaseLive = Layer.mergeAll(
  AgentMonitoring.layer,
  Layer.effectDiscard(
    Effect.flatMap(AutomationScheduler.AutomationScheduler, (service) => service.start()),
  ).pipe(Layer.provide(AutomationScheduler.layer), Layer.provide(PullRequestServiceLive)),
  Layer.effectDiscard(
    Effect.flatMap(ActivityHeadlineReactor.ActivityHeadlineReactor, (service) => service.start()),
  ).pipe(Layer.provide(ActivityHeadlineReactor.layer)),
  AgentAwarenessRelay.layer,
  ThreadSettlementWorkerLive,
  StorageCleanup.layer.pipe(Layer.provide(ProjectionStoreV2.layer)),
  ThreadPullRequestWorkerLive,
  Layer.effectDiscard(
    Effect.gen(function* () {
      const service = yield* PullRequestSyncReactor.PullRequestSyncReactor;
      yield* service.start();
    }),
  ).pipe(
    Layer.provideMerge(PullRequestSyncReactor.layer),
    Layer.provide(PullRequestServiceLive),
    Layer.provide(ProjectionStoreV2.layer),
  ),
  Layer.effectDiscard(
    Effect.gen(function* () {
      const service = yield* PullRequestWatchReactor.PullRequestWatchReactor;
      yield* service.start();
    }),
  ).pipe(
    Layer.provide(PullRequestWatchReactor.layer),
    Layer.provide(PullRequestServiceLive),
    Layer.provide(ProjectionStoreV2.layer),
  ),
  // Subscribes to `account.rate-limits.updated` so usage bars track live
  // telemetry instead of waiting for the next status probe.
  ProviderUsageLimitsIngestionLive,
  ProviderInstallationRefreshLive,
  ReplayMarkers.layer,
).pipe(
  // Core Services
  Layer.provideMerge(AutomationStoreLive),
  Layer.provideMerge(
    HomeSuggestions.layer.pipe(
      Layer.provide(HomeSuggestionsMesh.layer.pipe(Layer.provide(ServerSecretStore.layer))),
    ),
  ),
  Layer.provideMerge(OrchestrationApplicationLayerLive),
  Layer.provideMerge(OrchestrationEventInfrastructureLayerLive),
  Layer.provideMerge(Layer.merge(ProjectStore.layer, ThreadSearch.layer)),
  Layer.provideMerge(ServerSettingsLayerLive),
  // The asset route uses the registry's GitHub credential for private PR media, which the
  // built-in drivers' layer provides alongside the registry.
  Layer.provideMerge(SourceControlProviderRegistryLayerLive),
  Layer.provideMerge(GitLayerLive),
  Layer.provideMerge(VcsLayerLive),
  Layer.provideMerge(Layer.mergeAll(TerminalLayerLive, PreviewLayerLive, DeviceLayerLive)),
  Layer.provideMerge(PersistenceLayerLive),
  // Both read a user-owned file out of the state directory and stream changes
  // to clients; neither depends on the other.
  Layer.provideMerge(
    Layer.mergeAll(Keybindings.layer, EnvironmentTheme.layer, UsageLimitSources.layer),
  ),
  Layer.provideMerge(ProviderRegistryLive),
  // The instance registry is the new routing keystone — text generation,
  // adapter lookup, and runtime ingestion all resolve `ProviderInstanceId`
  // through this layer. Built-in drivers come from `BUILT_IN_DRIVERS`;
  // hydration adds their default instances to `providerInstances` on boot.
  Layer.provideMerge(ProviderInstanceRegistryHydrationLive),
  Layer.provideMerge(
    Layer.mergeAll(
      AntigravityInstallation.AntigravityInstallation.layer,
      CodexInstallation.CodexInstallation.layer,
    ),
  ),
);

const RuntimeCoreDependenciesLive = RuntimeCoreDependenciesBaseLive.pipe(
  Layer.provideMerge(PtyAdapterLive),
  // Search, prepare, status inspection, and turn launch share one registry
  // cache so every client and provider instance sees the same prepared agents.
  Layer.provideMerge(AcpRegistrySupport.layerFromHost.pipe(Layer.provide(ProviderHostLive.layer))),
  // Provider event loggers are shared by every driver instance and the
  // orchestration runtime, so they are provided once here.
  // `ModelManifest.layer` is the model manifest, refreshed from the repo's
  // `model-manifest.json` on `main`. Drivers read their entry through the
  // `ModelCatalog` port it provides.
  Layer.provideMerge(
    Layer.mergeAll(
      layerProviderEventLoggers,
      ModelManifest.layerModelCatalog.pipe(Layer.provideMerge(ModelManifest.layer)),
      ResetCreditCoordinator.layer,
      ProviderLatestVersions.layer,
      McpProviderSessions.layer,
    ),
  ),
  // `OpenCodeDriver.create()` yields `OpenCodeRuntime`; previously the old
  // `ProviderRegistryLive` pulled `OpenCodeRuntimeLive` in for itself, but
  // the rewritten registry reads snapshots off the instance registry and
  // no longer transitively provides it. Exposing it at the runtime level
  // keeps a single Live for all opencode consumers.
  Layer.provideMerge(
    OpenCodeRuntime.layer.pipe(
      Layer.provide(
        Layer.unwrap(
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            return OpenCodeServerLedger.layer({ stateDir: config.stateDir });
          }),
        ),
      ),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(AgentInstructionFiles.layer, SkillMarketplace.layer, AppsService.layer),
  ),
  Layer.provideMerge(SkillLibrary.layer),
  Layer.provideMerge(WorkspaceLayerLive),
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(Layer.mergeAll(NativeAppIconResolver.layer, ProjectFaviconResolverLayerLive)),
  Layer.provideMerge(RepositoryIdentityResolverLayerLive),
  Layer.provideMerge(ServerEnvironmentLayerLive),
  Layer.provideMerge(AuthLayerLive),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      CloudCliTokenManager.layer.pipe(
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ExternalLauncher.layer),
      ),
      CloudManagedEndpointRuntimeLive,
    ),
  ),
);

const RuntimeDependenciesLive = RuntimeCoreDependenciesLive.pipe(
  // Misc. Usage readers need ProviderHost, which needs BackgroundPolicy, so
  // the usage layer is merged first and Background satisfies it.
  Layer.provideMerge(Layer.mergeAll(UsageLayerLive, StorageInventoryLayerLive)),
  Layer.provideMerge(BackgroundLayerLive),
  Layer.provideMerge(ResourceDiagnosticsLayerLive),
  Layer.provideMerge(TraceDiagnostics.layer),
  Layer.provideMerge(AnalyticsService.layer),
  Layer.provideMerge(ExternalLauncher.layer),
  Layer.provideMerge(RemoteOpenTargets.layer),
  Layer.provideMerge(DirectEndpoints.layer),
  Layer.provideMerge(ServerLifecycleEvents.layer),
  Layer.provide(NetService.layer),
);

const commandReadinessLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.flatMap(ServerRuntimeStartup.ServerRuntimeStartup, (startup) =>
      startup.awaitCommandReady.pipe(Effect.orDie, Effect.andThen(httpEffect)),
    ),
  { global: true },
);

const makeRoutesLayer = Layer.mergeAll(
  Layer.mergeAll(
    HttpApiBuilder.layer(EnvironmentHttpApi).pipe(
      Layer.provide(authHttpApiLayer),
      Layer.provide(McpOAuthHttp.layer.pipe(Layer.provide(McpOAuth.layer))),
      Layer.provide(connectHttpApiLayer),
      Layer.provide(orchestrationHttpApiLayer),
      Layer.provide(pullRequestHttpApiLayer),
      Layer.provide(projectHttpApiLayer),
      Layer.provide(serverEnvironmentHttpApiLayer),
      Layer.provide(serverConfigHttpApiLayer),
      Layer.provide(readAloudHttpApiLayer),
      // EnvironmentHttpApi includes the public /api/hooks group. HttpApiBuilder
      // waits for every group; omitting this never finishes HttpRouter.serve.
      Layer.provide(WebhookRoute.layer.pipe(Layer.provide(RelayDeliveryProof.layer))),
      Layer.provide(environmentAuthenticatedAuthLayer),
    ),
    otlpTracesProxyRouteLayer,
    assetRouteLayer,
    attachmentUploadRouteLayer,
    deviceHubProxyRouteLayer,
    ServerBrowserStream.routeLayer,
    staticAndDevRouteLayer,
    websocketRpcRouteLayer,
    AutomationWebhookHttp.layer,
    AppsHttp.layer,
  ),
  // The MCP session registry is provided globally (shared with V2 provider
  // sessions) rather than inline here. The orchestrator toolkit resolves
  // delegation targets through the same live adapter facade the V2
  // orchestrator uses, so MCP capability reporting can never drift from
  // what dispatch can actually serve.
  McpHttpServer.layer.pipe(
    Layer.provide(ComputerUseService.layer),
    Layer.provide(ProviderAdapterRegistry.layerFromProviderInstanceRegistry),
    Layer.provide(McpOAuth.layerMcpClientAuthenticator),
  ),
).pipe(
  // Both transports consume the same service instance, so caches single-flight across clients
  // and mutations observed on WebSocket invalidate patches subsequently read over HTTP.
  Layer.provide(PullRequestServiceLive),
  // The stream route and the WebSocket RPCs share one browser. Ws.layer
  // yields ServerBrowser while building, so omitting this keeps
  // HttpRouter.serve from finishing and the process never logs Listening.
  Layer.provide(ServerBrowser.layer.pipe(Layer.provide(DesktopBrowserChannel.layer))),
  // Server browser tabs and HTML render previews install and run the same headless browser.
  Layer.provide(PreviewBrowser.layer),
  Layer.provide(PreviewAutomationBroker.layer),
  Layer.provide(SecretRequestBroker.layer),
  Layer.provide(ServerSelfUpdate.layer.pipe(Layer.provide(DesktopAppUpdateLayerLive))),
  Layer.provide(commandReadinessLayer),
  Layer.provide(browserApiCorsLayer),
  Layer.provide(httpCompressionLayer),
);

const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const activation = yield* Deferred.make<void>();
    const awaitActivation = Deferred.await(activation);
    const activationLayer = Layer.succeed(ServerActivation.ServerActivation, awaitActivation);
    const runtimeStateParked = yield* Deferred.make<void>();
    const tailscaleParked = yield* Deferred.make<void>();
    const cloudLinkParked = yield* Deferred.make<void>();
    const routesReady = yield* Deferred.make<void>();
    const launcherLayer = ServiceLauncherClient.layer;

    yield* fixPath({ shellEnvironmentPrepared: config.shellEnvironmentPrepared });

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
        yield* startup.markHttpListening;
      }),
    );
    const runtimeStateLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.gen(function* () {
          yield* Deferred.succeed(runtimeStateParked, undefined).pipe(Effect.orDie);
          yield* awaitActivation;
          const server = yield* HttpServer.HttpServer;
          const address = server.address;
          if (typeof address === "string" || !("port" in address)) {
            return;
          }

          const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;
          const state = yield* makePersistedServerRuntimeState({
            config,
            port: address.port,
            serviceManaged: launcher.managed,
          });
          yield* persistServerRuntimeState({
            path: config.serverRuntimeStatePath,
            state,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to persist server runtime state", { cause }),
            ),
          );
        }),
        () =>
          clearPersistedServerRuntimeState(config.serverRuntimeStatePath).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to clear server runtime state", { cause }),
            ),
          ),
      ),
    );
    const tailscaleServeLayer = config.tailscaleServeEnabled
      ? Layer.effectDiscard(
          Effect.acquireRelease(
            Effect.gen(function* () {
              yield* Deferred.succeed(tailscaleParked, undefined).pipe(Effect.orDie);
              yield* awaitActivation;
              const server = yield* HttpServer.HttpServer;
              const address = server.address;
              if (typeof address === "string" || !("port" in address)) {
                return null;
              }

              const localPort = address.port;
              return yield* ensureTailscaleServe({
                localPort,
                servePort: config.tailscaleServePort,
                localHost: "127.0.0.1",
              }).pipe(
                Effect.as({ localPort, servePort: config.tailscaleServePort }),
                Effect.tap(() =>
                  Effect.logInfo("Tailscale Serve configured", {
                    localPort,
                    servePort: config.tailscaleServePort,
                  }),
                ),
                Effect.catch((cause) =>
                  Effect.logWarning("Failed to configure Tailscale Serve", {
                    cause,
                    localPort,
                    servePort: config.tailscaleServePort,
                  }).pipe(Effect.as(null)),
                ),
              );
            }),
            (configured) =>
              configured
                ? disableTailscaleServe({ servePort: configured.servePort }).pipe(
                    Effect.tap(() =>
                      Effect.logInfo("Tailscale Serve disabled", {
                        servePort: configured.servePort,
                      }),
                    ),
                    Effect.catch((cause) =>
                      Effect.logWarning("Failed to disable Tailscale Serve", {
                        cause,
                        servePort: configured.servePort,
                      }),
                    ),
                  )
                : Effect.void,
          ),
        )
      : Layer.empty;
    const cloudDesiredLinkReconcileLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        const releaseManagedTunnel = releaseManagedTunnelOnShutdown().pipe(
          Effect.timeout("10 seconds"),
          Effect.tap((released) =>
            released ? Effect.logInfo("Released the managed tunnel on shutdown") : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Failed to release the managed tunnel on shutdown; the next link reuses it",
              { errors: Cause.prettyErrors(cause).map((error) => error.message) },
            ),
          ),
          Effect.asVoid,
        );
        // A launcher trial can be stopped before activation. The previous
        // server is already gone, so the trial owns cleanup immediately; the
        // pending-state check keeps the tunnel for normal commit or rollback,
        // while the launcher's explicit-stop marker allows it to be released.
        // Other runtimes wait for activation so a failed standby cannot tear
        // down the active runtime's tunnel.
        const cleanupBeforeActivation = yield* pendingServiceUpdateExists;
        if (cleanupBeforeActivation) {
          yield* Effect.addFinalizer(() => releaseManagedTunnel);
        }
        yield* ServerActivation.forkParked(
          Effect.gen(function* () {
            if (!cleanupBeforeActivation) {
              yield* Effect.addFinalizer(() => releaseManagedTunnel);
            }
            const server = yield* HttpServer.HttpServer;
            const address = server.address;
            if (typeof address === "string" || !("port" in address)) return;
            const localOrigin = `http://127.0.0.1:${address.port}`;
            const endpointRuntime = yield* CloudManagedEndpointRuntime.CloudManagedEndpointRuntime;
            const recoveryLock = yield* Semaphore.make(1);
            let lastRecoveryAtMillis = 0;
            const recoverManagedTunnel = (config: RelayManagedEndpointRuntimeConfig) =>
              recoveryLock.withPermits(1)(
                Effect.gen(function* () {
                  const elapsed = (yield* Clock.currentTimeMillis) - lastRecoveryAtMillis;
                  const wait = Duration.toMillis(MANAGED_TUNNEL_RECOVERY_COOLDOWN) - elapsed;
                  if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
                  lastRecoveryAtMillis = yield* Clock.currentTimeMillis;
                }).pipe(
                  Effect.andThen(
                    recoverManagedCloudTunnel(localOrigin, config, {
                      retryRuntimeFailures: true,
                    }),
                  ),
                  Effect.retry({
                    while: (error) =>
                      shouldRetryCloudLink(error) &&
                      error._tag !== "CloudLinkEndpointUnavailableError",
                    schedule: Schedule.exponential("1 second").pipe(
                      Schedule.modifyDelay(({ duration }) =>
                        Effect.succeed(Duration.min(duration, Duration.seconds(30))),
                      ),
                      Schedule.jittered,
                    ),
                  }),
                  Effect.tap((recovered) =>
                    recovered ? Effect.logInfo("T3 Connect managed tunnel recovered") : Effect.void,
                  ),
                  Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                      ? Effect.interrupt
                      : Effect.logWarning("Failed to recover the T3 Connect managed tunnel", {
                          cause,
                        }),
                  ),
                ),
              );
            yield* endpointRuntime.recoveryRequests.pipe(
              Stream.runForEach(recoverManagedTunnel),
              Effect.forkScoped,
            );
            // No settling delay before the first attempt: routes are already
            // serving by the time activation opens this gate (the startup
            // sequence awaits routesReady), and the retry schedule below
            // covers anything this sleep used to hedge against. Every
            // millisecond here is dead time on the path to remote
            // reachability after a restart.
            const wantsCliLink = hasCloudPublicConfig
              ? yield* CloudCliState.readCliDesiredCloudLink.pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Failed to read the desired T3 Connect link", { cause }).pipe(
                      Effect.as(false),
                    ),
                  ),
                )
              : false;
            // A failed read must not end this fiber before it registers
            // recovery and starts consuming recovery requests. "managed" is
            // what a missing value means, so it is the safe fallback.
            const desiredCliLinkMode = wantsCliLink
              ? yield* CloudCliState.readCliDesiredLinkMode.pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Failed to read the desired T3 Connect link mode", {
                      cause,
                    }).pipe(Effect.as("managed" as const)),
                  ),
                )
              : null;
            // A publish-only link must not expose the host, even if a managed
            // config from an earlier link is still stored.
            const startedConfirmed =
              desiredCliLinkMode === "publish_only"
                ? false
                : yield* startManagedCloudTunnelIfOriginConfirmed(localOrigin).pipe(
                    Effect.catch((cause) =>
                      Effect.logWarning("Failed to start the confirmed T3 Connect tunnel", {
                        cause,
                      }).pipe(Effect.as(false)),
                    ),
                  );
            const startStoredManagedTunnel = startManagedCloudTunnelIfOriginConfirmed(localOrigin, {
              requireConfirmedOrigin: false,
            }).pipe(
              Effect.tap((started) =>
                started
                  ? Effect.logWarning(
                      "T3 Connect started the stored tunnel without relay confirmation",
                    )
                  : Effect.void,
              ),
              Effect.catch((cause) =>
                Effect.logWarning("Failed to start the stored T3 Connect tunnel", { cause }),
              ),
              Effect.asVoid,
            );
            const registerManagedTunnel = retryManagedTunnelRegistration(
              registerManagedCloudTunnelRecovery(localOrigin, {
                retryRuntimeFailures: true,
              }),
              (error) =>
                shouldRetryCloudLink(error) &&
                error._tag !== "CloudLinkEndpointUnavailableError",
              startedConfirmed ? Effect.void : startStoredManagedTunnel,
            ).pipe(
              Effect.tap((result) =>
                result.status === "ready"
                  ? Effect.logInfo("T3 Connect managed tunnel recovery registered")
                  : Effect.void,
              ),
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                  ? Effect.interrupt
                  : Effect.logWarning("Failed to register T3 Connect managed tunnel recovery", {
                      cause,
                    }).pipe(Effect.as({ status: "unavailable" as const })),
              ),
            );
            // A host without a confirmed marker is on its first boot after the
            // upgrade. Spread those registrations so an auto-update wave does
            // not hit the relay all at once.
            if (!startedConfirmed && desiredCliLinkMode !== "publish_only") {
              const jitter = yield* Random.nextIntBetween(
                0,
                Duration.toMillis(MANAGED_TUNNEL_FIRST_REGISTRATION_JITTER),
              );
              yield* Effect.sleep(Duration.millis(jitter));
            }
            const registration =
              desiredCliLinkMode === "publish_only"
                ? { status: "not_linked" as const }
                : yield* registerManagedTunnel;
            // A terminal registration failure also allows the stored config
            // to start. Transient outages use the fallback above and keep
            // registration retrying in this scoped startup fiber.
            if (registration.status === "unavailable" && !startedConfirmed) {
              yield* startStoredManagedTunnel;
            }
            const startupAction = managedTunnelStartupAction({ wantsCliLink, registration });
            if (startupAction.action === "request_recovery") {
              yield* endpointRuntime.requestRecovery(startupAction.config);
            }
            if (startupAction.action === "reconcile_link") {
              const reconciledMode = yield* reconcileDesiredCloudLinkIfStillDesired(
                localOrigin,
              ).pipe(
                Effect.retry({
                  while: shouldRetryCloudLink,
                  schedule: Schedule.exponential("1 second").pipe(
                    Schedule.modifyDelay(({ duration }) =>
                      Effect.succeed(Duration.min(duration, Duration.seconds(30))),
                    ),
                    Schedule.upTo({ duration: "10 minutes" }),
                  ),
                }),
                Effect.tap((mode) =>
                  mode === null
                    ? Effect.void
                    : Effect.logInfo("T3 Connect desired link reconciled on startup"),
                ),
                Effect.catch((cause) =>
                  Effect.logWarning("Failed to reconcile T3 Connect desired link on startup", {
                    cause,
                  }).pipe(Effect.as(null)),
                ),
              );
              if (reconciledMode === "managed") {
                const afterReconcile = yield* registerManagedTunnel;
                if (afterReconcile.status === "recovery_required") {
                  yield* endpointRuntime.requestRecovery(afterReconcile.config);
                }
              }
            }
          }),
        );
        yield* Deferred.succeed(cloudLinkParked, undefined).pipe(Effect.orDie);
      }),
    );

    const runtimeServicesLive = ServerRuntimeStartup.layerWithOptions({
      activate: Deferred.succeed(activation, undefined).pipe(Effect.asVoid),
      abort: (error) => Deferred.die(activation, error).pipe(Effect.asVoid),
      awaitAuxiliaryParked: Effect.all(
        [
          Deferred.await(runtimeStateParked),
          Deferred.await(cloudLinkParked),
          Deferred.await(routesReady),
          ...(config.tailscaleServeEnabled ? [Deferred.await(tailscaleParked)] : []),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.asVoid),
    }).pipe(Layer.provideMerge(RuntimeDependenciesLive), Layer.provide(launcherLayer));

    const routesLayer = HttpRouter.serve(makeRoutesLayer.pipe(Layer.provide(launcherLayer)), {
      disableLogger: !config.logWebSocketEvents,
      routerConfig: HTTP_ROUTER_CONFIG,
    }).pipe(
      withUntracedRequests,
      Layer.tap(() => Deferred.succeed(routesReady, undefined).pipe(Effect.orDie)),
    );
    const serverApplicationLayer = Layer.mergeAll(
      routesLayer,
      httpListeningLayer,
      runtimeStateLayer.pipe(Layer.provide(launcherLayer)),
      tailscaleServeLayer,
      cloudDesiredLinkReconcileLayer,
      HeapSnapshot.layer,
    );

    return serverApplicationLayer.pipe(
      // The connect routes and the startup/shutdown link work share one instance.
      Layer.provide(CloudLink.layer),
      Layer.provideMerge(runtimeServicesLive),
      Layer.provideMerge(
        McpSessionRegistry.layer.pipe(
          Layer.provide(ServerEnvironment.layer.pipe(Layer.provide(ServerSecretStore.layer))),
        ),
      ),
      Layer.provide(activationLayer),
      Layer.provideMerge(serverRelayBrokerTracingLayer),
      Layer.provideMerge(HttpServerLive),
      Layer.provide(ApplicationObservabilityLive),
      Layer.provideMerge(FetchHttpClient.layer),
      // PR reads, Git operations, and WebSocket discovery share one process limiter.
      Layer.provide(VcsProcess.layer),
      // Every agent and terminal spawn reads this, so it sits below everything.
      Layer.provideMerge(AgentScopeLive.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

// The CLI supplies configuration.
export const runServer = Layer.launch(makeServerLayer);
