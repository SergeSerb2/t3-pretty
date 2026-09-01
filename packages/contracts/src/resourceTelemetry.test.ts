import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT,
  RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH,
  RESOURCE_MONITOR_EXTERNAL_PROCESS_MAX_COUNT,
  RESOURCE_MONITOR_HISTORY_CHUNK_MAX_SNAPSHOTS,
  RESOURCE_MONITOR_PROTOCOL_VERSION,
  ResourceAttributionSnapshot,
  ResourceMonitorCommand,
  ResourceMonitorEvent,
} from "./resourceTelemetry.ts";

const decodeCommand = Schema.decodeUnknownSync(ResourceMonitorCommand);
const decodeEvent = Schema.decodeUnknownSync(ResourceMonitorEvent);
const decodeAttribution = Schema.decodeUnknownSync(ResourceAttributionSnapshot);

const emptySnapshot = {
  version: RESOURCE_MONITOR_PROTOCOL_VERSION,
  type: "snapshot",
  sequence: 1,
  sampledAtUnixMs: 1,
  collectionDurationMicros: 1,
  scannedProcessCount: 0,
  retainedProcessCount: 0,
  inaccessibleProcessCount: 0,
  processes: [],
} as const;

describe("resource monitor protocol bounds", () => {
  it("rejects oversized external-process command arrays", () => {
    expect(() =>
      decodeCommand({
        version: RESOURCE_MONITOR_PROTOCOL_VERSION,
        type: "setExternalProcesses",
        processes: Array.from(
          { length: RESOURCE_MONITOR_EXTERNAL_PROCESS_MAX_COUNT + 1 },
          (_, index) => ({ pid: index + 1 }),
        ),
      }),
    ).toThrow();
  });

  it("rejects history chunks larger than the native sidecar emits", () => {
    expect(() =>
      decodeEvent({
        version: RESOURCE_MONITOR_PROTOCOL_VERSION,
        type: "historyChunk",
        requestId: "history-1",
        done: true,
        snapshots: Array.from(
          { length: RESOURCE_MONITOR_HISTORY_CHUNK_MAX_SNAPSHOTS + 1 },
          () => emptySnapshot,
        ),
      }),
    ).toThrow();
  });
});

describe("resource telemetry output bounds", () => {
  const entry = {
    component: "server",
    operation: "append",
    logicalReadBytes: 0,
    logicalWriteBytes: 1,
    count: 1,
    durationMs: 0,
  } as const;

  it("rejects attribution snapshots larger than the retained-key budget", () => {
    expect(() =>
      decodeAttribution({
        readAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
        entries: Array.from({ length: RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT + 1 }, () => entry),
      }),
    ).toThrow();
  });

  it("rejects oversized attribution labels", () => {
    expect(() =>
      decodeAttribution({
        readAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
        entries: [
          {
            ...entry,
            component: "x".repeat(RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH + 1),
          },
        ],
      }),
    ).toThrow();
  });
});
