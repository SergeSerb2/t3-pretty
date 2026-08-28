import {
  RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT,
  type DesktopHostTelemetrySnapshot,
  type ResourceMonitorSnapshotEvent,
  type ResourceTelemetryHealth,
  type ResourceTelemetryHistory,
  type ResourceTelemetryHistoryBucket,
  type ResourceTelemetryProcess,
  type ResourceTelemetryProcessSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  emptyTelemetryCounters,
  mergeProcesses,
  processIdentityKey,
  type ProcessState,
  type TelemetryCounters,
} from "./Model.ts";

const MAX_HISTORY_WINDOW_MS = 60 * 60_000;

export function normalizeResourceTelemetryHistoryInput(input: {
  readonly windowMs: number;
  readonly bucketMs: number;
}): { readonly windowMs: number; readonly bucketMs: number } {
  const windowMs = Math.max(1_000, Math.min(MAX_HISTORY_WINDOW_MS, input.windowMs));
  return {
    windowMs,
    bucketMs: Math.max(1_000, Math.min(windowMs, input.bucketMs)),
  };
}

interface AggregateSample {
  readonly sampledAtMs: number;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly processCount: number;
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
}

interface ProcessSample {
  readonly sampledAtMs: number;
  readonly process: ResourceTelemetryProcess;
  readonly cpuTimeMs: number;
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
}

interface ProcessSummaryAccumulator {
  readonly first: ProcessSample;
  readonly latest: ProcessSample;
  readonly cpuPercentTotal: number;
  readonly maxCpuPercent: number;
  readonly cpuTimeMs: number;
  readonly peakRssBytes: number;
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
  readonly sampleCount: number;
}

export interface BuildResourceTelemetryHistoryInput {
  readonly readAt: DateTime.Utc;
  readonly windowMs: number;
  readonly bucketMs: number;
  readonly sampleIntervalMs: number;
  readonly serverPid: number;
  readonly sidecarPid: Option.Option<number>;
  readonly desktopSnapshot: Option.Option<DesktopHostTelemetrySnapshot>;
  readonly snapshots: ReadonlyArray<ResourceMonitorSnapshotEvent>;
  readonly health: ResourceTelemetryHealth;
}

export type ResourceTelemetryHistoryWithLegacyBuckets = ResourceTelemetryHistory & {
  readonly legacyBackendBuckets?: ReadonlyArray<ResourceTelemetryHistoryBucket>;
};

function summarizeProcesses(samples: ReadonlyArray<ProcessSample>): {
  readonly processes: ReadonlyArray<ResourceTelemetryProcessSummary>;
  readonly truncated: boolean;
} {
  const groups = new Map<string, ProcessSummaryAccumulator>();
  for (const sample of samples) {
    const identityKey = processIdentityKey(
      sample.process.identity.pid,
      sample.process.identity.startTimeMs,
    );
    const current = groups.get(identityKey);
    groups.set(
      identityKey,
      current === undefined
        ? {
            first: sample,
            latest: sample,
            cpuPercentTotal: sample.process.cpuPercent,
            maxCpuPercent: sample.process.cpuPercent,
            cpuTimeMs: sample.cpuTimeMs,
            peakRssBytes: sample.process.residentBytes,
            ioReadBytes: sample.ioReadBytes,
            ioWriteBytes: sample.ioWriteBytes,
            sampleCount: 1,
          }
        : {
            ...current,
            latest: sample,
            cpuPercentTotal: saturatingFiniteAdd(
              current.cpuPercentTotal,
              sample.process.cpuPercent,
            ),
            maxCpuPercent: Math.max(current.maxCpuPercent, sample.process.cpuPercent),
            cpuTimeMs: saturatingIntegerAdd(current.cpuTimeMs, sample.cpuTimeMs),
            peakRssBytes: Math.max(current.peakRssBytes, sample.process.residentBytes),
            ioReadBytes: saturatingIntegerAdd(current.ioReadBytes, sample.ioReadBytes),
            ioWriteBytes: saturatingIntegerAdd(current.ioWriteBytes, sample.ioWriteBytes),
            sampleCount: saturatingIntegerAdd(current.sampleCount, 1),
          },
    );
  }

  const ranked = [...groups.values()]
    .map((summary): ResourceTelemetryProcessSummary => {
      const { first, latest } = summary;
      return {
        identity: latest.process.identity,
        ppid: latest.process.ppid,
        depth: latest.process.depth,
        name: latest.process.name,
        command: latest.process.command,
        category: latest.process.category,
        firstSeenAt: first.process.firstSeenAt,
        lastSeenAt: latest.process.lastSeenAt,
        currentCpuPercent: latest.process.cpuPercent,
        avgCpuPercent: summary.cpuPercentTotal / summary.sampleCount,
        maxCpuPercent: summary.maxCpuPercent,
        cpuTimeMs: summary.cpuTimeMs,
        currentRssBytes: latest.process.residentBytes,
        peakRssBytes: summary.peakRssBytes,
        ioReadBytes: summary.ioReadBytes,
        ioWriteBytes: summary.ioWriteBytes,
        ioSemantics: latest.process.ioSemantics,
        sampleCount: summary.sampleCount,
      };
    })
    .toSorted(
      (left, right) => right.cpuTimeMs - left.cpuTimeMs || right.peakRssBytes - left.peakRssBytes,
    );
  return {
    processes: ranked.slice(0, RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT),
    truncated: ranked.length > RESOURCE_TELEMETRY_HISTORY_TOP_PROCESS_MAX_COUNT,
  };
}

function saturatingIntegerAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function saturatingFiniteAdd(left: number, right: number): number {
  return Math.min(Number.MAX_VALUE, left + right);
}

function buildBuckets(input: {
  readonly samples: ReadonlyArray<AggregateSample>;
  readonly nowMs: number;
  readonly windowMs: number;
  readonly bucketMs: number;
}): ReadonlyArray<ResourceTelemetryHistoryBucket> {
  const windowStartMs = input.nowMs - input.windowMs;
  const buckets: ResourceTelemetryHistoryBucket[] = [];
  let sampleIndex = 0;
  for (let startedAtMs = windowStartMs; startedAtMs < input.nowMs; startedAtMs += input.bucketMs) {
    const endedAtMs = Math.min(input.nowMs, startedAtMs + input.bucketMs);
    const isFinalBucket = endedAtMs === input.nowMs;
    while (
      sampleIndex < input.samples.length &&
      input.samples[sampleIndex]!.sampledAtMs < startedAtMs
    ) {
      sampleIndex += 1;
    }
    let sampleCount = 0;
    let cpuTotal = 0;
    let maxCpuPercent = 0;
    let maxRssBytes = 0;
    let ioReadBytes = 0;
    let ioWriteBytes = 0;
    let maxProcessCount = 0;
    while (sampleIndex < input.samples.length) {
      const sample = input.samples[sampleIndex]!;
      if (sample.sampledAtMs > endedAtMs || (!isFinalBucket && sample.sampledAtMs === endedAtMs)) {
        break;
      }
      sampleCount += 1;
      cpuTotal = saturatingFiniteAdd(cpuTotal, sample.cpuPercent);
      maxCpuPercent = Math.max(maxCpuPercent, sample.cpuPercent);
      maxRssBytes = Math.max(maxRssBytes, sample.rssBytes);
      ioReadBytes = saturatingIntegerAdd(ioReadBytes, sample.ioReadBytes);
      ioWriteBytes = saturatingIntegerAdd(ioWriteBytes, sample.ioWriteBytes);
      maxProcessCount = Math.max(maxProcessCount, sample.processCount);
      sampleIndex += 1;
    }
    buckets.push({
      startedAt: DateTime.makeUnsafe(startedAtMs),
      endedAt: DateTime.makeUnsafe(endedAtMs),
      avgCpuPercent: sampleCount === 0 ? 0 : cpuTotal / sampleCount,
      maxCpuPercent,
      maxRssBytes,
      ioReadBytes,
      ioWriteBytes,
      maxProcessCount,
    });
  }
  return buckets;
}

export function buildResourceTelemetryHistory(
  input: BuildResourceTelemetryHistoryInput,
): ResourceTelemetryHistoryWithLegacyBuckets & {
  readonly legacyBackendBuckets: ReadonlyArray<ResourceTelemetryHistoryBucket>;
} {
  const readAtMs = DateTime.toEpochMillis(input.readAt);
  const { windowMs, bucketMs } = normalizeResourceTelemetryHistoryInput(input);
  const windowStartMs = readAtMs - windowMs;
  const eligibleSnapshots = input.snapshots
    .filter((snapshot) => snapshot.sampledAtUnixMs <= readAtMs)
    .toSorted((left, right) => left.sampledAtUnixMs - right.sampledAtUnixMs);
  const snapshotsInWindow = eligibleSnapshots.filter(
    (snapshot) => snapshot.sampledAtUnixMs >= windowStartMs,
  );
  const precedingSnapshot = eligibleSnapshots.findLast(
    (snapshot) => snapshot.sampledAtUnixMs < windowStartMs,
  );
  const snapshots = precedingSnapshot
    ? [precedingSnapshot, ...snapshotsInWindow]
    : snapshotsInWindow;
  const aggregateSamples: AggregateSample[] = [];
  const legacyBackendAggregateSamples: AggregateSample[] = [];
  const processSamples: ProcessSample[] = [];
  let previous: ReadonlyMap<string, ProcessState> = new Map();
  let counters: TelemetryCounters = emptyTelemetryCounters();
  let previousSnapshotAtMs: number | undefined;

  for (const snapshot of snapshots) {
    const deltaWindowFraction =
      previousSnapshotAtMs !== undefined &&
      previousSnapshotAtMs < windowStartMs &&
      snapshot.sampledAtUnixMs > previousSnapshotAtMs
        ? Math.max(
            0,
            Math.min(
              1,
              (snapshot.sampledAtUnixMs - windowStartMs) /
                (snapshot.sampledAtUnixMs - previousSnapshotAtMs),
            ),
          )
        : 1;
    previousSnapshotAtMs = snapshot.sampledAtUnixMs;
    const recordedExternalProcesses =
      snapshot.externalProcesses ??
      Option.match(input.desktopSnapshot, {
        onNone: () => [],
        onSome: (desktopSnapshot) => [
          {
            pid: desktopSnapshot.electronPid,
            startTimeMs: desktopSnapshot.electronProcesses.find(
              (metric) => metric.pid === desktopSnapshot.electronPid,
            )?.creationTimeMs,
          },
        ],
      });
    const electronRootPids = new Set(recordedExternalProcesses.map((process) => process.pid));
    const electronRootStartTimes = new Map(
      recordedExternalProcesses.flatMap((process) =>
        process.startTimeMs === undefined ? [] : [[process.pid, process.startTimeMs] as const],
      ),
    );
    const merged = mergeProcesses({
      serverPid: input.serverPid,
      sidecarPid: input.sidecarPid,
      fallbackSampledAtMs: snapshot.sampledAtUnixMs,
      nativeSnapshot: Option.some(snapshot),
      desktopSnapshot: Option.none(),
      electronRootPids,
      electronRootStartTimes,
      previous,
      counters,
      updatePrevious: true,
    });
    previous = new Map([...previous, ...merged.previous]);
    counters = merged.counters;
    if (snapshot.sampledAtUnixMs < windowStartMs) {
      continue;
    }
    const deltas =
      deltaWindowFraction === 1
        ? merged.deltas
        : merged.deltas.map((delta) => ({
            ...delta,
            cpuTimeMs: Math.round(delta.cpuTimeMs * deltaWindowFraction),
            ioReadBytes: Math.round(delta.ioReadBytes * deltaWindowFraction),
            ioWriteBytes: Math.round(delta.ioWriteBytes * deltaWindowFraction),
          }));
    const deltasByIdentity = new Map(
      deltas.map((processDelta) => [processDelta.identityKey, processDelta]),
    );
    aggregateSamples.push({
      sampledAtMs: snapshot.sampledAtUnixMs,
      cpuPercent: merged.groups.allT3.currentCpuPercent,
      rssBytes: merged.groups.allT3.currentRssBytes,
      processCount: merged.groups.allT3.processCount,
      ioReadBytes: deltas.reduce(
        (total, process) => saturatingIntegerAdd(total, process.ioReadBytes),
        0,
      ),
      ioWriteBytes: deltas.reduce(
        (total, process) => saturatingIntegerAdd(total, process.ioWriteBytes),
        0,
      ),
    });
    const backendDeltas = deltas.filter(
      (processDelta) =>
        processDelta.category === "server" ||
        processDelta.category === "server-child" ||
        processDelta.category === "provider-root" ||
        processDelta.category === "terminal-root",
    );
    legacyBackendAggregateSamples.push({
      sampledAtMs: snapshot.sampledAtUnixMs,
      cpuPercent: merged.groups.backend.currentCpuPercent,
      rssBytes: merged.groups.backend.currentRssBytes,
      processCount: merged.groups.backend.processCount,
      ioReadBytes: backendDeltas.reduce(
        (total, process) => saturatingIntegerAdd(total, process.ioReadBytes),
        0,
      ),
      ioWriteBytes: backendDeltas.reduce(
        (total, process) => saturatingIntegerAdd(total, process.ioWriteBytes),
        0,
      ),
    });
    for (const process of merged.processes) {
      const processDelta = deltasByIdentity.get(
        processIdentityKey(process.identity.pid, process.identity.startTimeMs),
      );
      processSamples.push({
        sampledAtMs: snapshot.sampledAtUnixMs,
        process,
        cpuTimeMs: processDelta?.cpuTimeMs ?? 0,
        ioReadBytes: processDelta?.ioReadBytes ?? 0,
        ioWriteBytes: processDelta?.ioWriteBytes ?? 0,
      });
    }
  }

  const summarizedProcesses = summarizeProcesses(processSamples);
  const sourceTruncated = snapshots.some(
    (snapshot) => snapshot.retainedProcessCount > snapshot.processes.length,
  );
  return {
    readAt: input.readAt,
    windowMs,
    bucketMs,
    sampleIntervalMs: input.sampleIntervalMs,
    retainedSampleCount: saturatingIntegerAdd(aggregateSamples.length, processSamples.length),
    buckets: buildBuckets({ samples: aggregateSamples, nowMs: readAtMs, windowMs, bucketMs }),
    legacyBackendBuckets: buildBuckets({
      samples: legacyBackendAggregateSamples,
      nowMs: readAtMs,
      windowMs,
      bucketMs,
    }),
    topProcesses: summarizedProcesses.processes,
    ...(summarizedProcesses.truncated || sourceTruncated ? { topProcessesTruncated: true } : {}),
    health: input.health,
  };
}
