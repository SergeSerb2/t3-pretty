import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  USAGE_CONTRACT_VERSION,
  USAGE_MODEL_MAX_LENGTH,
  USAGE_SUMMARY_MAX_BUCKETS,
  USAGE_SUMMARY_MAX_SOURCES,
  USAGE_TIME_ZONE_MAX_LENGTH,
  UsageSummary,
  UsageSummaryInput,
} from "./usage.ts";

const decodeSummary = Schema.decodeUnknownSync(UsageSummary);
const decodeInput = Schema.decodeUnknownSync(UsageSummaryInput);

const bucket = {
  day: "2026-08-23",
  provider: "codex",
  model: "gpt-5.6-sol",
  totals: {
    uncachedInputTokens: 1,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
  },
  costUsd: 0,
  cacheSavingsUsd: 0,
  costSource: "unpriced",
  records: 1,
  unpricedRecords: 1,
  sessions: 1,
} as const;

const source = {
  fingerprint: {
    hostId: "host",
    provider: "codex",
    resolvedHomePath: "/tmp/codex",
    volumeId: "1:2",
  },
  status: "ok",
  scannedFiles: 1,
  skippedFiles: 0,
  malformedRecords: 0,
  distinctSessions: 1,
  message: null,
} as const;

const summary = {
  contractVersion: USAGE_CONTRACT_VERSION,
  readAt: "2026-08-23T00:00:00.000Z",
  timeZone: "UTC",
  sinceDay: "2026-08-23",
  untilDay: "2026-08-23",
  buckets: [bucket],
  sources: [source],
  pricing: {
    status: "unavailable",
    source: "local",
    fetchedAt: null,
    knownModels: 0,
  },
  scanDurationMs: 1,
} as const;

describe("usage contract resource bounds", () => {
  it("rejects oversized summary collections", () => {
    expect(() =>
      decodeSummary({
        ...summary,
        buckets: Array.from({ length: USAGE_SUMMARY_MAX_BUCKETS + 1 }, () => bucket),
      }),
    ).toThrow();
    expect(() =>
      decodeSummary({
        ...summary,
        sources: Array.from({ length: USAGE_SUMMARY_MAX_SOURCES + 1 }, () => source),
      }),
    ).toThrow();
  });

  it("rejects duplicate per-provider sources that cannot be attributed to buckets", () => {
    expect(() =>
      decodeSummary({
        ...summary,
        sources: [source, { ...source, fingerprint: { ...source.fingerprint, volumeId: "2:3" } }],
      }),
    ).toThrow();
  });

  it("rejects oversized identifiers and time zones", () => {
    expect(() =>
      decodeSummary({
        ...summary,
        buckets: [{ ...bucket, model: "x".repeat(USAGE_MODEL_MAX_LENGTH + 1) }],
      }),
    ).toThrow();
    expect(() =>
      decodeInput({
        sinceDay: "2026-08-23",
        untilDay: "2026-08-23",
        timeZone: "x".repeat(USAGE_TIME_ZONE_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid usage cost %s",
    (costUsd) => {
      expect(() =>
        decodeSummary({
          ...summary,
          buckets: [{ ...bucket, costUsd }],
        }),
      ).toThrow();
    },
  );

  it("rejects inconsistent bucket counters", () => {
    expect(() =>
      decodeSummary({
        ...summary,
        buckets: [{ ...bucket, unpricedRecords: bucket.records + 1 }],
      }),
    ).toThrow();
    expect(() =>
      decodeSummary({
        ...summary,
        buckets: [{ ...bucket, sessions: bucket.records + 1 }],
      }),
    ).toThrow();
    expect(() =>
      decodeSummary({
        ...summary,
        buckets: [
          {
            ...bucket,
            totals: { ...bucket.totals, reasoningTokens: bucket.totals.outputTokens + 1 },
          },
        ],
      }),
    ).toThrow();
  });
});
