import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { HostPowerSnapshot } from "./background.ts";

export const RESOURCE_MONITOR_PROTOCOL_VERSION = 2 as const;
export const RESOURCE_MONITOR_EXTERNAL_PROCESS_MAX_COUNT = 256;
export const RESOURCE_MONITOR_PROCESS_MAX_COUNT = 20_000;
export const RESOURCE_MONITOR_HISTORY_CHUNK_MAX_SNAPSHOTS = 32;
export const RESOURCE_MONITOR_HISTORY_MAX_SNAPSHOTS = 3_600;
export const RESOURCE_MONITOR_HISTORY_MAX_RETAINED_ENTRIES = 20_000;
export const RESOURCE_MONITOR_PROCESS_NAME_MAX_LENGTH = 1_024;
export const RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH = 16 * 1_024;
export const RESOURCE_MONITOR_PROCESS_STATUS_MAX_LENGTH = 256;
export const RESOURCE_MONITOR_REQUEST_ID_MAX_LENGTH = 128;
export const RESOURCE_MONITOR_ERROR_CODE_MAX_LENGTH = 128;
export const RESOURCE_MONITOR_ERROR_MESSAGE_MAX_LENGTH = 4_096;
const ResourceMonitorRequestId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(RESOURCE_MONITOR_REQUEST_ID_MAX_LENGTH),
);

export const ResourceTelemetryIoSemantics = Schema.Literals([
  "storage",
  "logical",
  "all-io",
  "unavailable",
]);
export type ResourceTelemetryIoSemantics = typeof ResourceTelemetryIoSemantics.Type;

export const ResourceTelemetryProcessCategory = Schema.Literals([
  "server",
  "server-child",
  "provider-root",
  "terminal-root",
  "electron-main",
  "electron-renderer",
  "electron-gpu",
  "electron-utility",
  "resource-monitor",
  "unknown-t3",
]);
export type ResourceTelemetryProcessCategory = typeof ResourceTelemetryProcessCategory.Type;

export const ResourceTelemetrySourceStatus = Schema.Literals([
  "starting",
  "healthy",
  "degraded",
  "unavailable",
  "stopped",
]);
export type ResourceTelemetrySourceStatus = typeof ResourceTelemetrySourceStatus.Type;

export const ResourceTelemetryProcessIdentity = Schema.Struct({
  pid: PositiveInt,
  startTimeMs: NonNegativeInt,
});
export type ResourceTelemetryProcessIdentity = typeof ResourceTelemetryProcessIdentity.Type;

export const ResourceMonitorExternalProcess = Schema.Struct({
  pid: PositiveInt,
  startTimeMs: Schema.optionalKey(NonNegativeInt),
});
export type ResourceMonitorExternalProcess = typeof ResourceMonitorExternalProcess.Type;

const ResourceMonitorExternalProcesses = Schema.Array(ResourceMonitorExternalProcess).check(
  Schema.isMaxLength(RESOURCE_MONITOR_EXTERNAL_PROCESS_MAX_COUNT),
);

export const ResourceMonitorCapabilities = Schema.Struct({
  cumulativeCpuTime: Schema.Boolean,
  currentCpuPercent: Schema.Boolean,
  residentMemory: Schema.Boolean,
  virtualMemory: Schema.Boolean,
  ioBytes: Schema.Boolean,
  processStartTime: Schema.Boolean,
  processTree: Schema.Boolean,
});
export type ResourceMonitorCapabilities = typeof ResourceMonitorCapabilities.Type;

export const ResourceMonitorProcessSample = Schema.Struct({
  pid: PositiveInt,
  ppid: NonNegativeInt,
  startTimeMs: NonNegativeInt,
  runTimeMs: NonNegativeInt,
  name: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_NAME_MAX_LENGTH)),
  command: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH)),
  status: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_STATUS_MAX_LENGTH)),
  cpuPercent: Schema.Finite,
  cpuTimeMs: NonNegativeInt,
  residentBytes: NonNegativeInt,
  virtualBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioSemantics: Schema.Literals(["storage", "all-io"]),
});
export type ResourceMonitorProcessSample = typeof ResourceMonitorProcessSample.Type;

export const ResourceMonitorConfigureCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("configure"),
  rootPid: PositiveInt,
  sampleIntervalMs: NonNegativeInt,
  externalProcesses: ResourceMonitorExternalProcesses,
});
export type ResourceMonitorConfigureCommand = typeof ResourceMonitorConfigureCommand.Type;

export const ResourceMonitorSetExternalProcessesCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("setExternalProcesses"),
  processes: ResourceMonitorExternalProcesses,
});
export type ResourceMonitorSetExternalProcessesCommand =
  typeof ResourceMonitorSetExternalProcessesCommand.Type;

export const ResourceMonitorSampleNowCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("sampleNow"),
  requestId: ResourceMonitorRequestId,
});
export type ResourceMonitorSampleNowCommand = typeof ResourceMonitorSampleNowCommand.Type;

export const ResourceMonitorSetSampleIntervalCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("setSampleInterval"),
  sampleIntervalMs: NonNegativeInt,
});
export type ResourceMonitorSetSampleIntervalCommand =
  typeof ResourceMonitorSetSampleIntervalCommand.Type;

export const ResourceMonitorSetStreamingCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("setStreaming"),
  enabled: Schema.Boolean,
});
export type ResourceMonitorSetStreamingCommand = typeof ResourceMonitorSetStreamingCommand.Type;

export const ResourceMonitorReadHistoryCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("readHistory"),
  requestId: ResourceMonitorRequestId,
  windowMs: NonNegativeInt,
});
export type ResourceMonitorReadHistoryCommand = typeof ResourceMonitorReadHistoryCommand.Type;

export const ResourceMonitorShutdownCommand = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("shutdown"),
});
export type ResourceMonitorShutdownCommand = typeof ResourceMonitorShutdownCommand.Type;

export const ResourceMonitorCommand = Schema.Union([
  ResourceMonitorConfigureCommand,
  ResourceMonitorSetExternalProcessesCommand,
  ResourceMonitorSetSampleIntervalCommand,
  ResourceMonitorSetStreamingCommand,
  ResourceMonitorSampleNowCommand,
  ResourceMonitorReadHistoryCommand,
  ResourceMonitorShutdownCommand,
]);
export type ResourceMonitorCommand = typeof ResourceMonitorCommand.Type;

export const ResourceMonitorHelloEvent = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("hello"),
  sidecarVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  sidecarPid: PositiveInt,
  platform: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  arch: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  capabilities: ResourceMonitorCapabilities,
});
export type ResourceMonitorHelloEvent = typeof ResourceMonitorHelloEvent.Type;

export const ResourceMonitorSnapshotEvent = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("snapshot"),
  sequence: NonNegativeInt,
  sampledAtUnixMs: NonNegativeInt,
  collectionDurationMicros: NonNegativeInt,
  scannedProcessCount: NonNegativeInt,
  retainedProcessCount: NonNegativeInt,
  inaccessibleProcessCount: NonNegativeInt,
  requestId: Schema.optionalKey(ResourceMonitorRequestId),
  externalProcesses: Schema.optionalKey(ResourceMonitorExternalProcesses),
  processes: Schema.Array(ResourceMonitorProcessSample).check(
    Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_MAX_COUNT),
  ),
});
export type ResourceMonitorSnapshotEvent = typeof ResourceMonitorSnapshotEvent.Type;

export const ResourceMonitorHistoryChunkEvent = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("historyChunk"),
  requestId: ResourceMonitorRequestId,
  done: Schema.Boolean,
  snapshots: Schema.Array(ResourceMonitorSnapshotEvent).check(
    Schema.isMaxLength(RESOURCE_MONITOR_HISTORY_CHUNK_MAX_SNAPSHOTS),
  ),
});
export type ResourceMonitorHistoryChunkEvent = typeof ResourceMonitorHistoryChunkEvent.Type;

export const ResourceMonitorErrorEvent = Schema.Struct({
  version: Schema.Literal(RESOURCE_MONITOR_PROTOCOL_VERSION),
  type: Schema.Literal("error"),
  code: TrimmedNonEmptyString.check(Schema.isMaxLength(RESOURCE_MONITOR_ERROR_CODE_MAX_LENGTH)),
  message: TrimmedNonEmptyString.check(
    Schema.isMaxLength(RESOURCE_MONITOR_ERROR_MESSAGE_MAX_LENGTH),
  ),
  recoverable: Schema.Boolean,
});
export type ResourceMonitorErrorEvent = typeof ResourceMonitorErrorEvent.Type;

export const ResourceMonitorEvent = Schema.Union([
  ResourceMonitorHelloEvent,
  ResourceMonitorSnapshotEvent,
  ResourceMonitorHistoryChunkEvent,
  ResourceMonitorErrorEvent,
]);
export type ResourceMonitorEvent = typeof ResourceMonitorEvent.Type;

export const DesktopElectronProcessType = Schema.Literals([
  "Browser",
  "Tab",
  "Utility",
  "Zygote",
  "Sandbox helper",
  "GPU",
  "Pepper Plugin",
  "Pepper Plugin Broker",
  "Unknown",
]);
export type DesktopElectronProcessType = typeof DesktopElectronProcessType.Type;

export const DESKTOP_ELECTRON_PROCESS_MAX_COUNT = 256;
export const DESKTOP_ELECTRON_PROCESS_NAME_MAX_LENGTH = 512;
export const DesktopSpeedLimitPercent = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

export const DesktopElectronProcessMetric = Schema.Struct({
  pid: PositiveInt,
  creationTimeMs: NonNegativeInt,
  type: DesktopElectronProcessType,
  name: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(DESKTOP_ELECTRON_PROCESS_NAME_MAX_LENGTH)),
  ),
  serviceName: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(DESKTOP_ELECTRON_PROCESS_NAME_MAX_LENGTH)),
  ),
  cpuPercent: Schema.Finite,
  cumulativeCpuSeconds: Schema.optionalKey(Schema.Finite),
  idleWakeupsPerSecond: Schema.Finite,
  workingSetBytes: NonNegativeInt,
  peakWorkingSetBytes: NonNegativeInt,
});
export type DesktopElectronProcessMetric = typeof DesktopElectronProcessMetric.Type;

const DesktopHostPowerSnapshot = Schema.Struct({
  ...HostPowerSnapshot.fields,
  updatedAt: Schema.DateTimeUtcFromString,
});

export const DesktopHostTelemetrySnapshot = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetry"),
  sequence: NonNegativeInt,
  sampledAtUnixMs: NonNegativeInt,
  electronPid: PositiveInt,
  power: DesktopHostPowerSnapshot,
  speedLimitPercent: Schema.OptionFromNullOr(DesktopSpeedLimitPercent),
  electronProcessesTruncated: Schema.optionalKey(Schema.Boolean),
  electronProcesses: Schema.Array(DesktopElectronProcessMetric).check(
    Schema.isMaxLength(DESKTOP_ELECTRON_PROCESS_MAX_COUNT),
  ),
});
export type DesktopHostTelemetrySnapshot = typeof DesktopHostTelemetrySnapshot.Type;

export const DesktopHostTelemetryHello = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetryHello"),
  electronPid: PositiveInt,
});
export type DesktopHostTelemetryHello = typeof DesktopHostTelemetryHello.Type;

export const DesktopHostTelemetryMessage = Schema.Union([
  DesktopHostTelemetryHello,
  DesktopHostTelemetrySnapshot,
]);
export type DesktopHostTelemetryMessage = typeof DesktopHostTelemetryMessage.Type;

export const DesktopTelemetrySetDiagnosticsDemand = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("setDiagnosticsDemand"),
  enabled: Schema.Boolean,
});
export type DesktopTelemetrySetDiagnosticsDemand = typeof DesktopTelemetrySetDiagnosticsDemand.Type;

export const DesktopTelemetrySetHostPowerIntervals = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("setHostPowerIntervals"),
  activeIntervalMs: PositiveInt,
  idleIntervalMs: PositiveInt,
});
export type DesktopTelemetrySetHostPowerIntervals =
  typeof DesktopTelemetrySetHostPowerIntervals.Type;

export const DesktopTelemetryControlMessage = Schema.Union([
  DesktopTelemetrySetDiagnosticsDemand,
  DesktopTelemetrySetHostPowerIntervals,
]);
export type DesktopTelemetryControlMessage = typeof DesktopTelemetryControlMessage.Type;

export const RESOURCE_TELEMETRY_SNAPSHOT_PROCESS_MAX_COUNT =
  RESOURCE_MONITOR_PROCESS_MAX_COUNT + DESKTOP_ELECTRON_PROCESS_MAX_COUNT;
export const RESOURCE_TELEMETRY_HISTORY_BUCKET_MAX_COUNT = 3_600;
export const RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT = 512;
export const RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT = 256;
export const RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH = 128;
export const RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH = 4_096;

const FiniteNonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const ResourceTelemetryProcess = Schema.Struct({
  identity: ResourceTelemetryProcessIdentity,
  ppid: NonNegativeInt,
  childPids: Schema.Array(PositiveInt).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_SNAPSHOT_PROCESS_MAX_COUNT),
  ),
  depth: NonNegativeInt,
  name: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_NAME_MAX_LENGTH)),
  command: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH)),
  status: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_STATUS_MAX_LENGTH)),
  category: ResourceTelemetryProcessCategory,
  electronType: Schema.optionalKey(DesktopElectronProcessType),
  electronServiceName: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(DESKTOP_ELECTRON_PROCESS_NAME_MAX_LENGTH)),
  ),
  cpuPercent: FiniteNonNegativeNumber,
  cpuTimeMs: NonNegativeInt,
  residentBytes: NonNegativeInt,
  peakResidentBytes: NonNegativeInt,
  virtualBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioReadBytesPerSecond: FiniteNonNegativeNumber,
  ioWriteBytesPerSecond: FiniteNonNegativeNumber,
  ioSemantics: ResourceTelemetryIoSemantics,
  idleWakeupsPerSecond: Schema.optionalKey(FiniteNonNegativeNumber),
  runTimeMs: NonNegativeInt,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
});
export type ResourceTelemetryProcess = typeof ResourceTelemetryProcess.Type;

export const ResourceTelemetryAggregate = Schema.Struct({
  processCount: NonNegativeInt,
  currentCpuPercent: FiniteNonNegativeNumber,
  cpuTimeMs: NonNegativeInt,
  currentRssBytes: NonNegativeInt,
  peakRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioReadBytesPerSecond: FiniteNonNegativeNumber,
  ioWriteBytesPerSecond: FiniteNonNegativeNumber,
  processStarts: NonNegativeInt,
  processExits: NonNegativeInt,
});
export type ResourceTelemetryAggregate = typeof ResourceTelemetryAggregate.Type;

export const ResourceTelemetryGroups = Schema.Struct({
  backend: ResourceTelemetryAggregate,
  electron: ResourceTelemetryAggregate,
  monitor: ResourceTelemetryAggregate,
  allT3: ResourceTelemetryAggregate,
});
export type ResourceTelemetryGroups = typeof ResourceTelemetryGroups.Type;

export const ResourceTelemetrySourceHealth = Schema.Struct({
  status: ResourceTelemetrySourceStatus,
  lastSampleAt: Schema.Option(Schema.DateTimeUtc),
  lastError: Schema.Option(
    TrimmedNonEmptyString.check(Schema.isMaxLength(RESOURCE_TELEMETRY_HEALTH_ERROR_MAX_LENGTH)),
  ),
});
export type ResourceTelemetrySourceHealth = typeof ResourceTelemetrySourceHealth.Type;

export const ResourceTelemetryHealth = Schema.Struct({
  native: ResourceTelemetrySourceHealth,
  desktop: ResourceTelemetrySourceHealth,
  sidecarVersion: Schema.Option(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  sidecarPid: Schema.Option(PositiveInt),
  restartCount: NonNegativeInt,
  collectionDurationMicros: NonNegativeInt,
  scannedProcessCount: NonNegativeInt,
  retainedProcessCount: NonNegativeInt,
  inaccessibleProcessCount: NonNegativeInt,
});
export type ResourceTelemetryHealth = typeof ResourceTelemetryHealth.Type;

export const ResourceAttributionEntry = Schema.Struct({
  component: TrimmedNonEmptyString.check(Schema.isMaxLength(RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH)),
  operation: TrimmedNonEmptyString.check(Schema.isMaxLength(RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH)),
  logicalReadBytes: NonNegativeInt,
  logicalWriteBytes: NonNegativeInt,
  count: NonNegativeInt,
  durationMs: NonNegativeInt,
});
export type ResourceAttributionEntry = typeof ResourceAttributionEntry.Type;

export const ResourceAttributionSnapshot = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  entries: Schema.Array(ResourceAttributionEntry).check(
    Schema.isMaxLength(RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT),
  ),
  entriesTruncated: Schema.optionalKey(Schema.Boolean),
});
export type ResourceAttributionSnapshot = typeof ResourceAttributionSnapshot.Type;

export const ResourceTelemetrySnapshot = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  sampleIntervalMs: NonNegativeInt,
  processes: Schema.Array(ResourceTelemetryProcess).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_SNAPSHOT_PROCESS_MAX_COUNT),
  ),
  processesTruncated: Schema.optionalKey(Schema.Boolean),
  groups: ResourceTelemetryGroups,
  power: HostPowerSnapshot,
  speedLimitPercent: Schema.Option(DesktopSpeedLimitPercent),
  attribution: ResourceAttributionSnapshot,
  health: ResourceTelemetryHealth,
});
export type ResourceTelemetrySnapshot = typeof ResourceTelemetrySnapshot.Type;

export const ResourceTelemetryHistoryInput = Schema.Struct({
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
});
export type ResourceTelemetryHistoryInput = typeof ResourceTelemetryHistoryInput.Type;

export const ResourceTelemetryHistoryBucket = Schema.Struct({
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
  avgCpuPercent: FiniteNonNegativeNumber,
  maxCpuPercent: FiniteNonNegativeNumber,
  maxRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  maxProcessCount: NonNegativeInt,
});
export type ResourceTelemetryHistoryBucket = typeof ResourceTelemetryHistoryBucket.Type;

export const ResourceTelemetryProcessSummary = Schema.Struct({
  identity: ResourceTelemetryProcessIdentity,
  ppid: NonNegativeInt,
  depth: NonNegativeInt,
  name: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_NAME_MAX_LENGTH)),
  command: Schema.String.check(Schema.isMaxLength(RESOURCE_MONITOR_PROCESS_COMMAND_MAX_LENGTH)),
  category: ResourceTelemetryProcessCategory,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
  currentCpuPercent: FiniteNonNegativeNumber,
  avgCpuPercent: FiniteNonNegativeNumber,
  maxCpuPercent: FiniteNonNegativeNumber,
  cpuTimeMs: NonNegativeInt,
  currentRssBytes: NonNegativeInt,
  peakRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioSemantics: ResourceTelemetryIoSemantics,
  sampleCount: NonNegativeInt,
});
export type ResourceTelemetryProcessSummary = typeof ResourceTelemetryProcessSummary.Type;

export const ResourceTelemetryHistory = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
  sampleIntervalMs: NonNegativeInt,
  retainedSampleCount: NonNegativeInt,
  buckets: Schema.Array(ResourceTelemetryHistoryBucket).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_HISTORY_BUCKET_MAX_COUNT),
  ),
  topProcesses: Schema.Array(ResourceTelemetryProcessSummary).check(
    Schema.isMaxLength(RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT),
  ),
  topProcessesTruncated: Schema.optionalKey(Schema.Boolean),
  health: ResourceTelemetryHealth,
});
export type ResourceTelemetryHistory = typeof ResourceTelemetryHistory.Type;

export const ResourceTelemetryRetryResult = Schema.Struct({
  accepted: Schema.Boolean,
  snapshot: ResourceTelemetrySnapshot,
});
export type ResourceTelemetryRetryResult = typeof ResourceTelemetryRetryResult.Type;
