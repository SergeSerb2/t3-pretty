import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as References from "effect/References";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Stream from "effect/Stream";

import { outcomeFromExit } from "./Attributes.ts";
import { metricAttributes, rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * The `rpc.aggregate` span attribute of every WebSocket RPC. Trace queries and dashboards group by
 * these labels, so they keep their historical values even where they differ from the method
 * prefix. Adding an RPC to `WsRpcGroup` without a label is a type error.
 */
const RPC_AGGREGATES = {
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getTurnDiff]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreads]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThread]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.launchThread]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: "orchestrationV2",
  [WS_METHODS.projectsMutate]: "orchestration",
  [WS_METHODS.serverProbe]: "server",
  [WS_METHODS.serverGetConfig]: "server",
  [WS_METHODS.serverRefreshProviders]: "server",
  [WS_METHODS.serverUpdateProvider]: "server",
  [WS_METHODS.providerAuthStart]: "provider",
  [WS_METHODS.providerConsumeResetCredit]: "provider",
  [WS_METHODS.providerAuthComplete]: "provider",
  [WS_METHODS.chatGptReconnectProfile]: "provider",
  [WS_METHODS.chatGptImportProfile]: "provider",
  [WS_METHODS.chatGptHandoffSubscribe]: "provider",
  [WS_METHODS.codexAuthCallbackSubscribe]: "provider",
  [WS_METHODS.providerAuthRespond]: "provider",
  [WS_METHODS.providerAuthCancel]: "provider",
  [WS_METHODS.providerAuthLogout]: "provider",
  [WS_METHODS.providerAuthSubscribe]: "provider",
  [WS_METHODS.providerInstallStart]: "provider",
  [WS_METHODS.providerInstallCancel]: "provider",
  [WS_METHODS.providerInstallSubscribe]: "provider",
  [WS_METHODS.providerInstallRemove]: "provider",
  [WS_METHODS.serverUpdateServer]: "server",
  [WS_METHODS.serverUpdateServerWithProgress]: "server",
  [WS_METHODS.serverCommitDesktopUpdate]: "server",
  [WS_METHODS.serverUpsertKeybinding]: "server",
  [WS_METHODS.serverRemoveKeybinding]: "server",
  [WS_METHODS.serverRunStorageCleanup]: "server",
  [WS_METHODS.serverGetStorageCleanupReport]: "server",
  [WS_METHODS.serverGetSettings]: "server",
  [WS_METHODS.serverUpdateSettings]: "server",
  [WS_METHODS.serverSearchAcpRegistry]: "server",
  [WS_METHODS.serverPrepareAcpRegistryAgent]: "server",
  [WS_METHODS.serverUninstallAcpRegistryManagedBinary]: "server",
  [WS_METHODS.serverAcceptAcpRegistryUrlAuth]: "server",
  [WS_METHODS.serverListAcpRegistrySessions]: "server",
  [WS_METHODS.serverImportAcpRegistrySession]: "server",
  [WS_METHODS.serverDeleteAcpRegistrySession]: "server",
  [WS_METHODS.serverListAcpRegistryProviders]: "server",
  [WS_METHODS.serverSetAcpRegistryProvider]: "server",
  [WS_METHODS.serverDisableAcpRegistryProvider]: "server",
  [WS_METHODS.serverLogoutAcpRegistry]: "server",
  [WS_METHODS.serverDiscoverSourceControl]: "server",
  [WS_METHODS.serverGetTraceDiagnostics]: "server",
  [WS_METHODS.serverGetProcessDiagnostics]: "server",
  [WS_METHODS.serverGetHostResources]: "server",
  [WS_METHODS.serverGetProcessResourceHistory]: "server",
  [WS_METHODS.serverGetResourceTelemetryHistory]: "server",
  [WS_METHODS.serverRetryResourceTelemetry]: "server",
  [WS_METHODS.serverGetUsageSummary]: "server",
  [WS_METHODS.serverRefreshUsageRates]: "server",
  [WS_METHODS.serverSignalProcess]: "server",
  [WS_METHODS.serverReportClientActivity]: "server",
  [WS_METHODS.serverReportHostPowerState]: "server",
  [WS_METHODS.serverGetBackgroundPolicy]: "server",
  [WS_METHODS.scheduledTasksList]: "scheduledTasks",
  [WS_METHODS.scheduledTasksSubscribe]: "scheduledTasks",
  [WS_METHODS.scheduledTasksUpsert]: "scheduledTasks",
  [WS_METHODS.scheduledTasksSetEnabled]: "scheduledTasks",
  [WS_METHODS.scheduledTasksDelete]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRunNow]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRotateWebhookToken]: "scheduledTasks",
  [WS_METHODS.scheduledTasksListWebhookDeliveries]: "scheduledTasks",
  [WS_METHODS.scheduledTasksGetWebhookDelivery]: "scheduledTasks",
  [WS_METHODS.secretsAnswerRequest]: "secrets",
  [WS_METHODS.cloudGetRelayClientStatus]: "cloud",
  [WS_METHODS.cloudInstallRelayClient]: "cloud",
  [WS_METHODS.pullRequestsList]: "pull-requests",
  [WS_METHODS.pullRequestsListStats]: "pull-requests",
  [WS_METHODS.pullRequestsSummary]: "pull-requests",
  [WS_METHODS.pullRequestsRouting]: "pull-requests",
  [WS_METHODS.pullRequestsRoutingIdentity]: "pull-requests",
  [WS_METHODS.pullRequestsStack]: "pull-requests",
  [WS_METHODS.pullRequestsLinkedThreads]: "pull-requests",
  [WS_METHODS.pullRequestsDetail]: "pull-requests",
  [WS_METHODS.pullRequestsPreview]: "pull-requests",
  [WS_METHODS.pullRequestsChecks]: "pull-requests",
  [WS_METHODS.pullRequestsActivity]: "pull-requests",
  [WS_METHODS.pullRequestsThreadComments]: "pull-requests",
  [WS_METHODS.pullRequestsDiffFileContents]: "pull-requests",
  [WS_METHODS.pullRequestsFilesViewed]: "pull-requests",
  [WS_METHODS.pullRequestsRunAction]: "pull-requests",
  [WS_METHODS.pullRequestsUpdate]: "pull-requests",
  [WS_METHODS.pullRequestsComment]: "pull-requests",
  [WS_METHODS.pullRequestsUpdateComment]: "pull-requests",
  [WS_METHODS.pullRequestsSubmitReview]: "pull-requests",
  [WS_METHODS.pullRequestsReplyToThread]: "pull-requests",
  [WS_METHODS.pullRequestsSetThreadResolution]: "pull-requests",
  [WS_METHODS.pullRequestsSetReaction]: "pull-requests",
  [WS_METHODS.pullRequestsSetFilesViewed]: "pull-requests",
  [WS_METHODS.pullRequestsInvalidate]: "pull-requests",
  [WS_METHODS.pullRequestsReportState]: "pull-requests",
  [WS_METHODS.pullRequestsSubscribeRefreshes]: "pull-requests",
  [WS_METHODS.pullRequestsReviewerCandidates]: "pull-requests",
  [WS_METHODS.pullRequestsRequestReviewers]: "pull-requests",
  [WS_METHODS.pullRequestsLabelCandidates]: "pull-requests",
  [WS_METHODS.pullRequestsSetLabels]: "pull-requests",
  [WS_METHODS.sourceControlLookupRepository]: "source-control",
  [WS_METHODS.sourceControlCloneRepository]: "source-control",
  [WS_METHODS.sourceControlPublishRepository]: "source-control",
  [WS_METHODS.projectCloneStart]: "source-control",
  [WS_METHODS.projectCloneCancel]: "source-control",
  [WS_METHODS.projectCloneRetry]: "source-control",
  [WS_METHODS.subscribeProjectClones]: "source-control",
  [WS_METHODS.projectsListEntries]: "workspace",
  [WS_METHODS.projectsReadFile]: "workspace",
  [WS_METHODS.projectsSearchContents]: "workspace",
  [WS_METHODS.projectsSearchEntries]: "workspace",
  [WS_METHODS.projectsWriteFile]: "workspace",
  [WS_METHODS.projectsEnsureScratch]: "orchestration",
  [WS_METHODS.projectsCreateNew]: "orchestration",
  [WS_METHODS.shellOpenInEditor]: "workspace",
  [WS_METHODS.filesystemBrowse]: "workspace",
  [WS_METHODS.filesystemGetMetadata]: "workspace",
  [WS_METHODS.agentSessionsScan]: "workspace",
  [WS_METHODS.agentSessionsImport]: "workspace",
  [WS_METHODS.assetsCreateUrl]: "workspace",
  [WS_METHODS.assetsPersistChatAttachments]: "orchestration",
  [WS_METHODS.attachmentsCreateUploadUrl]: "workspace",
  [WS_METHODS.attachmentsDelete]: "workspace",
  [WS_METHODS.providerUploadFeedback]: "provider",
  [WS_METHODS.mcpAppsCallTool]: "provider",
  [WS_METHODS.mcpAppsToolInfo]: "provider",
  [WS_METHODS.mcpAppsUpdateModelContext]: "provider",
  [WS_METHODS.mcpAppsReadResource]: "provider",
  [WS_METHODS.subscribeVcsStatus]: "vcs",
  [WS_METHODS.subscribeWorktreeSetup]: "vcs",
  [WS_METHODS.worktreeSetupCancel]: "vcs",
  [WS_METHODS.subscribeResourceTelemetry]: "server",
  [WS_METHODS.vcsRefreshStatus]: "vcs",
  [WS_METHODS.vcsPull]: "git",
  [WS_METHODS.gitRunStackedAction]: "vcs",
  [WS_METHODS.gitResolvePullRequest]: "git",
  [WS_METHODS.gitPreparePullRequestThread]: "git",
  [WS_METHODS.vcsListRefs]: "vcs",
  [WS_METHODS.vcsCreateWorktree]: "vcs",
  [WS_METHODS.vcsRemoveWorktree]: "vcs",
  [WS_METHODS.vcsCreateRef]: "vcs",
  [WS_METHODS.vcsSwitchRef]: "vcs",
  [WS_METHODS.vcsInit]: "vcs",
  [WS_METHODS.reviewGetDiffPreview]: "review",
  [WS_METHODS.reviewGetDiffFileContents]: "review",
  [WS_METHODS.terminalOpen]: "terminal",
  [WS_METHODS.terminalAttach]: "terminal",
  [WS_METHODS.terminalObserve]: "terminal",
  [WS_METHODS.terminalWrite]: "terminal",
  [WS_METHODS.terminalResize]: "terminal",
  [WS_METHODS.terminalClear]: "terminal",
  [WS_METHODS.terminalRestart]: "terminal",
  [WS_METHODS.terminalClose]: "terminal",
  [WS_METHODS.subscribeTerminalEvents]: "terminal",
  [WS_METHODS.subscribeTerminalMetadata]: "terminal",
  [WS_METHODS.previewOpen]: "preview",
  [WS_METHODS.previewNavigate]: "preview",
  [WS_METHODS.previewResize]: "preview",
  [WS_METHODS.previewAdjust]: "preview",
  [WS_METHODS.previewRefresh]: "preview",
  [WS_METHODS.previewClose]: "preview",
  [WS_METHODS.previewList]: "preview",
  [WS_METHODS.previewClearProfile]: "preview",
  [WS_METHODS.previewReportProfiles]: "preview",
  [WS_METHODS.previewReportStatus]: "preview",
  [WS_METHODS.subscribePreviewEvents]: "preview",
  [WS_METHODS.subscribeDiscoveredLocalServers]: "preview",
  [WS_METHODS.deviceConfigure]: "device",
  [WS_METHODS.deviceTestHost]: "device",
  [WS_METHODS.deviceList]: "device",
  [WS_METHODS.deviceOpen]: "device",
  [WS_METHODS.deviceClose]: "device",
  [WS_METHODS.deviceShutdown]: "device",
  [WS_METHODS.deviceDetail]: "device",
  [WS_METHODS.deviceAction]: "device",
  [WS_METHODS.subscribeDeviceState]: "device",
  [WS_METHODS.subscribeServerConfig]: "server",
  [WS_METHODS.subscribeServerLifecycle]: "server",
  [WS_METHODS.subscribeAuthAccess]: "auth",
  [WS_METHODS.subscribeBackgroundPolicy]: "server",
  [WS_METHODS.projectsImportFavicon]: "orchestration",
  [WS_METHODS.projectTransfersInspect]: "orchestration",
  [WS_METHODS.projectTransfersPrepare]: "orchestration",
  [WS_METHODS.projectTransfersSend]: "orchestration",
  [WS_METHODS.projectTransfersCancel]: "orchestration",
  [WS_METHODS.agentInstructionsList]: "agentInstructions",
  [WS_METHODS.agentInstructionsRead]: "agentInstructions",
  [WS_METHODS.agentInstructionsWrite]: "agentInstructions",
  [WS_METHODS.automationsSubscribe]: "automations",
  [WS_METHODS.automationsDispatch]: "automations",
  [WS_METHODS.automationsListRuns]: "automations",
  [WS_METHODS.automationsGetRun]: "automations",
  [WS_METHODS.storageGetInventory]: "storage",
  [WS_METHODS.storageStreamInventory]: "storage",
  [WS_METHODS.storageRemoveOrphan]: "storage",
  [WS_METHODS.skillsGetState]: "skills",
  [WS_METHODS.skillsInstall]: "skills",
  [WS_METHODS.skillsUninstall]: "skills",
  [WS_METHODS.skillsListMarketplace]: "skills",
  [WS_METHODS.skillsRefreshMarketplace]: "skills",
  [WS_METHODS.skillsSetLocationEnabled]: "skills",
  [WS_METHODS.appsUpsert]: "apps",
  [WS_METHODS.appsRemove]: "apps",
  [WS_METHODS.appsAuthorize]: "apps",
  [WS_METHODS.appsSetToken]: "apps",
  [WS_METHODS.appsSetOAuthClient]: "apps",
  [WS_METHODS.appsDisconnect]: "apps",
  [WS_METHODS.appsTest]: "apps",
  [WS_METHODS.previewAutomationConnect]: "preview",
  [WS_METHODS.previewAutomationRespond]: "preview",
  [WS_METHODS.previewAutomationFocusHost]: "preview",
  [WS_METHODS.serverExportGlobalEnvironment]: "server",
  [WS_METHODS.threadSecretRequestRespond]: "orchestration",
  [WS_METHODS.serverGetAgentMonitoringStatus]: "server",
  [WS_METHODS.homeSuggestionsGet]: "homeSuggestions",
  [WS_METHODS.homeSuggestionsRefresh]: "homeSuggestions",
  [WS_METHODS.homeSuggestionsDismiss]: "homeSuggestions",
  [WS_METHODS.subscribeHomeSuggestions]: "homeSuggestions",
} as const satisfies Readonly<Record<WsRpcMethod, string>>;

const RPC_SPAN_PREFIX = "ws.rpc";
const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;
const RPC_METHODS_WITH_TRACING_DISABLED: ReadonlySet<string> = new Set([
  WS_METHODS.serverGetTraceDiagnostics,
  WS_METHODS.serverGetProcessDiagnostics,
  WS_METHODS.serverGetProcessResourceHistory,
  WS_METHODS.serverSignalProcess,
]);

/**
 * Records each WebSocket RPC's span and request metrics. `ws.ts` adds it to the server's group
 * after `RpcScopeAuthorization`, so it wraps authorization and also records rejected calls.
 */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "t3/server/RpcInstrumentation",
) {}

/**
 * Wraps each WebSocket RPC call in its `ws.rpc.<method>` span and records its request counter and
 * duration. For a stream RPC, the middleware receives the whole stream run, so the span and the
 * metrics cover the subscription until it ends, fails, or is interrupted. Methods in
 * `RPC_METHODS_WITH_TRACING_DISABLED` record metrics but no spans, for the call or anything it runs.
 */
export const rpcInstrumentationLayer = Layer.succeed(RpcInstrumentation)((effect, { rpc }) => {
  const method = rpc._tag;
  const measured = effect.pipe(
    withMetrics({ counter: rpcRequestsTotal, timer: rpcRequestDuration, attributes: { method } }),
  );

  if (RPC_METHODS_WITH_TRACING_DISABLED.has(method)) {
    return measured.pipe(Effect.provideService(References.TracerEnabled, false));
  }
  return measured.pipe(
    Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: {
        ...DEFAULT_RPC_SPAN_ATTRIBUTES,
        "rpc.method": method,
        "rpc.aggregate": RPC_AGGREGATES[method as WsRpcMethod],
      },
    }),
  );
});

function shouldTraceRpc(method: string): boolean {
  return !RPC_METHODS_WITH_TRACING_DISABLED.has(method);
}

const rpcSpanAttributes = (
  method: string,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Record<string, unknown> => ({
  ...DEFAULT_RPC_SPAN_ATTRIBUTES,
  "rpc.method": method,
  ...traceAttributes,
});

const withRpcEffectTracing = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> =>
  shouldTraceRpc(method)
    ? effect.pipe(
        Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
          attributes: rpcSpanAttributes(method, traceAttributes),
        }),
      )
    : effect.pipe(Effect.provideService(References.TracerEnabled, false));

const withRpcStreamTracing = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, E, R> =>
  shouldTraceRpc(method)
    ? stream.pipe(
        Stream.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
          attributes: rpcSpanAttributes(method, traceAttributes),
        }),
      )
    : stream.pipe(Stream.provideService(References.TracerEnabled, false));

const recordRpcStreamMetrics = <E>(
  method: string,
  startedAt: bigint,
  exit: Exit.Exit<unknown, E>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Metric.update(
      Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })),
      Duration.nanos((yield* Clock.monotonicTimeNanos) - startedAt),
    );
    yield* Metric.update(
      Metric.withAttributes(
        rpcRequestsTotal,
        metricAttributes({
          method,
          outcome: outcomeFromExit(exit),
        }),
      ),
      1,
    );
  });

/** Pretty ws.ts still wraps individual handlers; 2787 also records via middleware. */
export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> => {
  const instrumented = effect.pipe(
    withMetrics({
      counter: rpcRequestsTotal,
      timer: rpcRequestDuration,
      attributes: { method },
    }),
  );
  return withRpcEffectTracing(method, instrumented, traceAttributes);
};

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, E, R> => {
  const instrumented = Stream.unwrap(
    Effect.gen(function* () {
      const startedAt = yield* Clock.monotonicTimeNanos;
      return stream.pipe(Stream.onExit((exit) => recordRpcStreamMetrics(method, startedAt, exit)));
    }),
  );
  return withRpcStreamTracing(method, instrumented, traceAttributes);
};

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, StreamError | EffectError, StreamContext | EffectContext> => {
  const instrumented = Stream.unwrap(
    Effect.gen(function* () {
      const startedAt = yield* Clock.monotonicTimeNanos;
      const stream = yield* effect.pipe(
        Effect.onError((cause) => recordRpcStreamMetrics(method, startedAt, Exit.failCause(cause))),
      );
      return stream.pipe(
        Stream.onExit((streamExit) => recordRpcStreamMetrics(method, startedAt, streamExit)),
      );
    }),
  );
  return withRpcStreamTracing(method, instrumented, traceAttributes);
};
