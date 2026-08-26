import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ExecutionEnvironmentDescriptor, ServerSelfUpdateMethod } from "./environment.ts";
import { ServerAuthDescriptor } from "./auth.ts";
import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  KeybindingCommand,
  KeybindingValue,
  KeybindingWhen,
  ResolvedKeybindingsConfig,
} from "./keybindings.ts";
import {
  EDITORS,
  EditorId,
  FileManagerRevealKind,
  REMOTE_OPEN_TARGET_MAX_COUNT,
  RemoteOpenTarget,
} from "./editor.ts";
import { ModelCapabilities, PROVIDER_MODEL_ID_MAX_LENGTH } from "./model.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH,
  RESOURCE_MONITOR_PROCESS_STATUS_MAX_LENGTH,
  RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH,
  RESOURCE_TELEMETRY_HISTORY_BUCKET_MAX_COUNT,
  RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT,
  RESOURCE_TELEMETRY_SNAPSHOT_PROCESS_MAX_COUNT,
} from "./resourceTelemetry.ts";
import { ServerSettings } from "./settings.ts";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_STATE_MAX_ITEMS,
} from "./skills.ts";

export const SERVER_PROVIDER_LABEL_MAX_LENGTH = 4_096;
export const SERVER_PROVIDER_TEXT_MAX_LENGTH = 64 * 1024;
export const SERVER_PROVIDER_PATH_MAX_LENGTH = 32 * 1024;
export const SERVER_PROVIDER_MODELS_MAX_ITEMS = 1_024;
export const SERVER_PROVIDER_SLASH_COMMANDS_MAX_ITEMS = 2_048;
export const SERVER_PROVIDERS_MAX_ITEMS = 256;
export const SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH = 4_096;
export const SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH = 32 * 1_024;
export const SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT = 101;
export const SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT = 10;
export const SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT = 20;
export const SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT = 64;
export const SERVER_PROCESS_DIAGNOSTIC_ELAPSED_MAX_LENGTH = 128;
export const SERVER_PROCESS_DIAGNOSTIC_MAX_COUNT = RESOURCE_TELEMETRY_SNAPSHOT_PROCESS_MAX_COUNT;

const ServerProviderLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SERVER_PROVIDER_LABEL_MAX_LENGTH),
);
const ServerProviderText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SERVER_PROVIDER_TEXT_MAX_LENGTH),
);
const ServerProviderTimestamp = IsoDateTime.check(Schema.isMaxLength(128));
const ServerTraceDiagnosticText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH),
);
const ServerTraceDiagnosticPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH),
);

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: ServerProviderText,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: ServerProviderText,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

// Issue kinds grow over time; older clients must not fail the whole config
// decode over a kind they cannot render.
const ServerConfigIssues = ForwardCompatibleArray(ServerConfigIssue).check(Schema.isMaxLength(256));

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(ServerProviderLabel),
  label: Schema.optional(ServerProviderLabel),
  email: Schema.optional(ServerProviderLabel),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_MODEL_ID_MAX_LENGTH)),
  name: ServerProviderLabel,
  shortName: Schema.optional(ServerProviderLabel),
  subProvider: Schema.optional(ServerProviderLabel),
  isCustom: Schema.Boolean,
  isDefault: Schema.optional(Schema.Boolean),
  isLegacy: Schema.optional(Schema.Boolean),
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProviderSlashCommandInput = Schema.Struct({
  hint: ServerProviderText,
});
export type ServerProviderSlashCommandInput = typeof ServerProviderSlashCommandInput.Type;

export const ServerProviderSlashCommand = Schema.Struct({
  name: ServerProviderLabel,
  description: Schema.optional(ServerProviderText),
  input: Schema.optional(ServerProviderSlashCommandInput),
});
export type ServerProviderSlashCommand = typeof ServerProviderSlashCommand.Type;

export const ServerProviderSkill = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_NAME_MAX_LENGTH)),
  description: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_DESCRIPTION_MAX_LENGTH)),
  ),
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(SERVER_PROVIDER_PATH_MAX_LENGTH)),
  scope: Schema.optional(ServerProviderLabel),
  enabled: Schema.Boolean,
  displayName: Schema.optional(ServerProviderLabel),
  shortDescription: Schema.optional(ServerProviderText),
});
export type ServerProviderSkill = typeof ServerProviderSkill.Type;

/**
 * Availability of a configured provider instance from the runtime's POV.
 *
 *  - `available` — the build ships this driver and an instance is wired
 *    up. Default for legacy snapshots produced from the closed
 *    `ServerSettings.providers` map.
 *  - `unavailable` — the user's `ServerSettings.providerInstances` (or a
 *    persisted thread / session binding) references a driver this build
 *    doesn't ship. Common after rolling back from a fork or PR branch
 *    that introduced a new driver. The snapshot is preserved so the UI
 *    can render "missing driver" affordances and so the data round-trips
 *    when the user moves back to the fork.
 *
 * Snapshots with `availability: "unavailable"` MUST set
 * `installed: false` and `enabled: false`; the runtime refuses turn
 * starts against them with a structured error.
 */
export const ServerProviderAvailability = Schema.Literals(["available", "unavailable"]);
export type ServerProviderAvailability = typeof ServerProviderAvailability.Type;

export const ServerProviderContinuation = Schema.Struct({
  groupKey: ServerProviderLabel,
});
export type ServerProviderContinuation = typeof ServerProviderContinuation.Type;

export const ServerProviderVersionAdvisoryStatus = Schema.Literals([
  "unknown",
  "current",
  "behind_latest",
]);
export type ServerProviderVersionAdvisoryStatus = typeof ServerProviderVersionAdvisoryStatus.Type;

export const ServerProviderVersionAdvisory = Schema.Struct({
  status: ServerProviderVersionAdvisoryStatus,
  currentVersion: Schema.NullOr(ServerProviderLabel),
  latestVersion: Schema.NullOr(ServerProviderLabel),
  updateCommand: Schema.NullOr(ServerProviderText),
  canUpdate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  checkedAt: Schema.NullOr(ServerProviderTimestamp),
  message: Schema.NullOr(ServerProviderText),
});
export type ServerProviderVersionAdvisory = typeof ServerProviderVersionAdvisory.Type;

export const ServerProviderUpdateStatus = Schema.Literals([
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
  "unchanged",
]);
export type ServerProviderUpdateStatus = typeof ServerProviderUpdateStatus.Type;

export const ServerProviderUpdateState = Schema.Struct({
  status: ServerProviderUpdateStatus,
  startedAt: Schema.NullOr(ServerProviderTimestamp),
  finishedAt: Schema.NullOr(ServerProviderTimestamp),
  message: Schema.NullOr(ServerProviderText),
  output: Schema.NullOr(Schema.String.check(Schema.isMaxLength(10_000))),
});
export type ServerProviderUpdateState = typeof ServerProviderUpdateState.Type;

export const ServerProvider = Schema.Struct({
  // Routing key for the configured instance this snapshot represents. This
  // is the only stable identity consumers may use for provider routing.
  instanceId: ProviderInstanceId,
  // Open driver kind slug that selects the implementation handling this
  // instance. It is metadata/capability context, not a routing key.
  driver: ProviderDriverKind,
  displayName: Schema.optional(ServerProviderLabel),
  accentColor: Schema.optional(ServerProviderLabel),
  badgeLabel: Schema.optional(ServerProviderLabel),
  continuation: Schema.optional(ServerProviderContinuation),
  showInteractionModeToggle: Schema.optional(Schema.Boolean),
  requiresNewThreadForModelChange: Schema.optional(Schema.Boolean),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(ServerProviderLabel),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: ServerProviderTimestamp,
  message: Schema.optional(ServerProviderText),
  // Optional for back-compat: every legacy producer omits this field and
  // an absent value is interpreted as `"available"` by consumers (see
  // `isProviderAvailable`). New `ProviderInstanceRegistry` outputs set it
  // explicitly so the UI can render unavailable shadows from
  // `ServerSettings.providerInstances`.
  availability: Schema.optional(ServerProviderAvailability),
  // Human-readable reason populated when `availability === "unavailable"`.
  // Surfaces in the UI alongside the missing-driver affordance.
  unavailableReason: Schema.optional(ServerProviderText),
  models: Schema.Array(ServerProviderModel).check(
    Schema.isMaxLength(SERVER_PROVIDER_MODELS_MAX_ITEMS),
  ),
  slashCommands: Schema.Array(ServerProviderSlashCommand)
    .check(Schema.isMaxLength(SERVER_PROVIDER_SLASH_COMMANDS_MAX_ITEMS))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  skills: Schema.Array(ServerProviderSkill)
    .check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  versionAdvisory: Schema.optionalKey(ServerProviderVersionAdvisory),
  updateState: Schema.optionalKey(ServerProviderUpdateState),
});
export type ServerProvider = typeof ServerProvider.Type;

// Provider status kinds grow over time (ServerProviderState,
// ServerProviderAuthStatus, ServerProviderVersionAdvisoryStatus,
// ServerProviderUpdateStatus); an older client must not fail the whole config
// decode over one provider it cannot render.
export const ServerProviders = ForwardCompatibleArray(ServerProvider).check(
  Schema.isMaxLength(SERVER_PROVIDERS_MAX_ITEMS),
);
export type ServerProviders = typeof ServerProviders.Type;

/**
 * Treat the optional `availability` as "available" when absent. This is
 * the rule legacy producers (which omit the field) and new producers
 * (which set it explicitly) agree on so consumers never have to thread
 * `?? "available"` defaults through their code paths.
 */
export const isProviderAvailable = (snapshot: ServerProvider): boolean =>
  snapshot.availability !== "unavailable";

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: ServerTraceDiagnosticPath,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(ServerProviderText),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(ServerProviderText),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerTraceDiagnosticsErrorKind = Schema.Literals([
  "trace-file-not-found",
  "trace-file-read-failed",
]);
export type ServerTraceDiagnosticsErrorKind = typeof ServerTraceDiagnosticsErrorKind.Type;

export const ServerTraceDiagnosticsSpanSummary = Schema.Struct({
  name: ServerTraceDiagnosticText,
  count: NonNegativeInt,
  failureCount: NonNegativeInt,
  totalDurationMs: Schema.Number,
  averageDurationMs: Schema.Number,
  maxDurationMs: Schema.Number,
});
export type ServerTraceDiagnosticsSpanSummary = typeof ServerTraceDiagnosticsSpanSummary.Type;

export const ServerTraceDiagnosticsFailureSummary = Schema.Struct({
  name: ServerTraceDiagnosticText,
  cause: ServerTraceDiagnosticText,
  count: NonNegativeInt,
  lastSeenAt: Schema.DateTimeUtc,
  traceId: ServerTraceDiagnosticText,
  spanId: ServerTraceDiagnosticText,
});
export type ServerTraceDiagnosticsFailureSummary = typeof ServerTraceDiagnosticsFailureSummary.Type;

export const ServerTraceDiagnosticsRecentFailure = Schema.Struct({
  name: ServerTraceDiagnosticText,
  cause: ServerTraceDiagnosticText,
  durationMs: Schema.Number,
  endedAt: Schema.DateTimeUtc,
  traceId: ServerTraceDiagnosticText,
  spanId: ServerTraceDiagnosticText,
});
export type ServerTraceDiagnosticsRecentFailure = typeof ServerTraceDiagnosticsRecentFailure.Type;

export const ServerTraceDiagnosticsSpanOccurrence = Schema.Struct({
  name: ServerTraceDiagnosticText,
  durationMs: Schema.Number,
  endedAt: Schema.DateTimeUtc,
  traceId: ServerTraceDiagnosticText,
  spanId: ServerTraceDiagnosticText,
});
export type ServerTraceDiagnosticsSpanOccurrence = typeof ServerTraceDiagnosticsSpanOccurrence.Type;

export const ServerTraceDiagnosticsLogEvent = Schema.Struct({
  spanName: ServerTraceDiagnosticText,
  level: ServerTraceDiagnosticText,
  message: ServerTraceDiagnosticText,
  seenAt: Schema.DateTimeUtc,
  traceId: ServerTraceDiagnosticText,
  spanId: ServerTraceDiagnosticText,
});
export type ServerTraceDiagnosticsLogEvent = typeof ServerTraceDiagnosticsLogEvent.Type;

export const ServerTraceDiagnosticsResult = Schema.Struct({
  traceFilePath: ServerTraceDiagnosticPath,
  scannedFilePaths: Schema.Array(ServerTraceDiagnosticPath).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT),
  ),
  readAt: Schema.DateTimeUtc,
  recordCount: NonNegativeInt,
  parseErrorCount: NonNegativeInt,
  firstSpanAt: Schema.Option(Schema.DateTimeUtc),
  lastSpanAt: Schema.Option(Schema.DateTimeUtc),
  failureCount: NonNegativeInt,
  interruptionCount: NonNegativeInt,
  slowSpanThresholdMs: NonNegativeInt,
  slowSpanCount: NonNegativeInt,
  logLevelCounts: Schema.Record(ServerTraceDiagnosticText, NonNegativeInt).check(
    Schema.isMaxProperties(SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT),
  ),
  topSpansByCount: Schema.Array(ServerTraceDiagnosticsSpanSummary).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT),
  ),
  slowestSpans: Schema.Array(ServerTraceDiagnosticsSpanOccurrence).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT),
  ),
  commonFailures: Schema.Array(ServerTraceDiagnosticsFailureSummary).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT),
  ),
  latestFailures: Schema.Array(ServerTraceDiagnosticsRecentFailure).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT),
  ),
  latestWarningAndErrorLogs: Schema.Array(ServerTraceDiagnosticsLogEvent).check(
    Schema.isMaxLength(SERVER_TRACE_DIAGNOSTIC_RECENT_MAX_COUNT),
  ),
  partialFailure: Schema.Option(Schema.Boolean),
  error: Schema.Option(
    Schema.Struct({
      kind: ServerTraceDiagnosticsErrorKind,
      message: ServerTraceDiagnosticText,
    }),
  ),
});
export type ServerTraceDiagnosticsResult = typeof ServerTraceDiagnosticsResult.Type;

export const ServerProcessSignal = Schema.Literals(["SIGINT", "SIGKILL"]);
export type ServerProcessSignal = typeof ServerProcessSignal.Type;

export const ServerProcessDiagnosticsEntry = Schema.Struct({
  pid: PositiveInt,
  startTimeMs: NonNegativeInt,
  ppid: NonNegativeInt,
  pgid: Schema.Option(Schema.Int),
  status: TrimmedNonEmptyString.check(
    Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_STATUS_MAX_LENGTH),
  ),
  cpuPercent: Schema.Number,
  rssBytes: NonNegativeInt,
  elapsed: TrimmedNonEmptyString.check(
    Schema.isMaxLength(SERVER_PROCESS_DIAGNOSTIC_ELAPSED_MAX_LENGTH),
  ),
  command: TrimmedNonEmptyString.check(
    Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH),
  ),
  depth: NonNegativeInt,
  childPids: Schema.Array(PositiveInt).check(
    Schema.isMaxLength(SERVER_PROCESS_DIAGNOSTIC_MAX_COUNT),
  ),
});
export type ServerProcessDiagnosticsEntry = typeof ServerProcessDiagnosticsEntry.Type;

export const ServerProcessDiagnosticsResult = Schema.Struct({
  serverPid: PositiveInt,
  readAt: Schema.DateTimeUtc,
  processCount: NonNegativeInt,
  totalRssBytes: NonNegativeInt,
  totalCpuPercent: Schema.Number,
  processes: Schema.Array(ServerProcessDiagnosticsEntry).check(
    Schema.isMaxLength(SERVER_PROCESS_DIAGNOSTIC_MAX_COUNT),
  ),
  error: Schema.Option(
    Schema.Struct({
      message: TrimmedNonEmptyString.check(
        Schema.isMaxLength(RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH),
      ),
    }),
  ),
});
export type ServerProcessDiagnosticsResult = typeof ServerProcessDiagnosticsResult.Type;

export const ServerProcessResourceHistoryInput = Schema.Struct({
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
});
export type ServerProcessResourceHistoryInput = typeof ServerProcessResourceHistoryInput.Type;

export const ServerProcessResourceHistoryBucket = Schema.Struct({
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  maxRssBytes: NonNegativeInt,
  maxProcessCount: NonNegativeInt,
});
export type ServerProcessResourceHistoryBucket = typeof ServerProcessResourceHistoryBucket.Type;

export const ServerProcessResourceHistorySummary = Schema.Struct({
  processKey: TrimmedNonEmptyString,
  pid: PositiveInt,
  ppid: NonNegativeInt,
  command: TrimmedNonEmptyString.check(
    Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH),
  ),
  depth: NonNegativeInt,
  isServerRoot: Schema.Boolean,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
  currentCpuPercent: Schema.Number,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  cpuSecondsApprox: Schema.Number,
  currentRssBytes: NonNegativeInt,
  maxRssBytes: NonNegativeInt,
  sampleCount: NonNegativeInt,
});
export type ServerProcessResourceHistorySummary = typeof ServerProcessResourceHistorySummary.Type;

export const ServerProcessResourceHistoryFailureTag = Schema.Literals([
  "ProcessDiagnosticsQueryTimeoutError",
  "ProcessDiagnosticsQueryFailedError",
  "ProcessDiagnosticsServerProcessSignalError",
  "ProcessDiagnosticsNotDescendantError",
  "ProcessDiagnosticsSignalFailedError",
]);
export type ServerProcessResourceHistoryFailureTag =
  typeof ServerProcessResourceHistoryFailureTag.Type;

export const ServerProcessResourceHistoryResult = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
  sampleIntervalMs: NonNegativeInt,
  retainedSampleCount: NonNegativeInt,
  totalCpuSecondsApprox: Schema.Number,
  buckets: Schema.Array(ServerProcessResourceHistoryBucket).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_HISTORY_BUCKET_MAX_COUNT),
  ),
  topProcesses: Schema.Array(ServerProcessResourceHistorySummary).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT),
  ),
  topProcessesTruncated: Schema.optionalKey(Schema.Boolean),
  error: Schema.Option(
    Schema.Struct({
      failureTag: ServerProcessResourceHistoryFailureTag,
      message: TrimmedNonEmptyString.check(
        Schema.isMaxLength(RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH),
      ),
    }),
  ),
});
export type ServerProcessResourceHistoryResult = typeof ServerProcessResourceHistoryResult.Type;

export const ServerSignalProcessInput = Schema.Struct({
  pid: PositiveInt,
  startTimeMs: NonNegativeInt,
  signal: ServerProcessSignal,
});
export type ServerSignalProcessInput = typeof ServerSignalProcessInput.Type;

export const ServerSignalProcessResult = Schema.Struct({
  pid: PositiveInt,
  signal: ServerProcessSignal,
  signaled: Schema.Boolean,
  message: Schema.Option(
    TrimmedNonEmptyString.check(Schema.isMaxLength(RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH)),
  ),
});
export type ServerSignalProcessResult = typeof ServerSignalProcessResult.Type;

export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  // Editor ids grow over time; drop ones this build does not know rather than
  // failing the whole config decode.
  availableEditors: ForwardCompatibleArray(EditorId).check(Schema.isMaxLength(EDITORS.length)),
  /**
   * SSH hosts this environment advertises for remote open-in-editor links.
   * Absent on servers that predate the feature; empty when the machine has no
   * sshd or no advertisable name.
   */
  remoteOpenTargets: Schema.optionalKey(
    ForwardCompatibleArray(RemoteOpenTarget).check(
      Schema.isMaxLength(REMOTE_OPEN_TARGET_MAX_COUNT),
    ),
  ),
  observability: ServerObservability,
  settings: ServerSettings,
  /** Whether shell subscriptions can emit an opt-in catch-up completion marker. */
  shellResumeCompletionMarker: Schema.optionalKey(Schema.Boolean),
  /** Whether shell.openInEditor honors `LaunchEditorInput.reveal` for the
      file-manager editor. */
  shellRevealInFileManager: Schema.optionalKey(Schema.Boolean),
  /** File-manager wording clients should use for reveal actions. */
  shellRevealInFileManagerKind: Schema.optionalKey(FileManagerRevealKind),
  /** Whether thread subscriptions can emit an opt-in catch-up completion marker. */
  threadResumeCompletionMarker: Schema.optionalKey(Schema.Boolean),
  /**
   * Whether thread detail reads accept a turn window (`turnLimit`/
   * `beforeCursor`) and return `page` metadata. Clients must not send window
   * fields to servers that don't advertise this.
   */
  threadSnapshotPagination: Schema.optionalKey(Schema.Boolean),
});
export type ServerConfig = typeof ServerConfig.Type;

const ServerUpsertKeybindingReplaceTarget = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
});

export const ServerUpsertKeybindingInput = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
  replace: Schema.optional(ServerUpsertKeybindingReplaceTarget),
});
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerRemoveKeybindingInput = ServerUpsertKeybindingReplaceTarget;
export type ServerRemoveKeybindingInput = typeof ServerRemoveKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerRemoveKeybindingResult = ServerUpsertKeybindingResult;
export type ServerRemoveKeybindingResult = typeof ServerRemoveKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

/** Terminal selection recorded by the service launcher for one update. */
export const ServerSelfUpdateOutcome = Schema.Struct({
  id: TrimmedNonEmptyString,
  fromVersion: TrimmedNonEmptyString,
  targetVersion: TrimmedNonEmptyString,
  status: Schema.Literals(["committed", "rolled-back", "failed"]),
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ServerSelfUpdateOutcome = typeof ServerSelfUpdateOutcome.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
  environment: ExecutionEnvironmentDescriptor,
  /** Present when this process resumed a launcher-managed update. */
  updateOutcome: Schema.optionalKey(ServerSelfUpdateOutcome),
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const ServerProviderUpdateInput = Schema.Struct({
  provider: ProviderDriverKind,
  instanceId: Schema.optionalKey(ProviderInstanceId),
});
export type ServerProviderUpdateInput = typeof ServerProviderUpdateInput.Type;

export class ServerProviderUpdateError extends Schema.TaggedErrorClass<ServerProviderUpdateError>()(
  "ServerProviderUpdateError",
  {
    provider: ProviderDriverKind,
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Provider update failed for ${this.provider}: ${this.reason}`;
  }
}

export const ServerSelfUpdateInput = Schema.Struct({
  /** Exact npm version of the `t3` package to install (never a dist-tag, so
      the server and the acknowledging client agree on what was requested). */
  targetVersion: TrimmedNonEmptyString,
});
export type ServerSelfUpdateInput = typeof ServerSelfUpdateInput.Type;

/** Acknowledgement that the update artifact is installed and the server is
    about to restart into it — the connection will drop moments later. */
export const ServerSelfUpdateResult = Schema.Struct({
  targetVersion: TrimmedNonEmptyString,
  method: ServerSelfUpdateMethod,
  /** Launcher-generated correlation ID. Absent when talking to older servers. */
  updateId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ServerSelfUpdateResult = typeof ServerSelfUpdateResult.Type;

export const ServerSelfUpdateProgressStage = Schema.Literals(["downloading", "installing"]);
export type ServerSelfUpdateProgressStage = typeof ServerSelfUpdateProgressStage.Type;

export const ServerSelfUpdateProgressEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: ServerSelfUpdateProgressStage,
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    result: ServerSelfUpdateResult,
  }),
]);
export type ServerSelfUpdateProgressEvent = typeof ServerSelfUpdateProgressEvent.Type;

export class ServerSelfUpdateError extends Schema.TaggedErrorClass<ServerSelfUpdateError>()(
  "ServerSelfUpdateError",
  {
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Server update failed: ${this.reason}`;
  }
}
