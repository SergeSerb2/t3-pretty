// @effect-diagnostics globalDate:off
/**
 * Folds parsed transcript records into `(day, hourStart?, provider, model)`
 * buckets.
 *
 * `Intl.DateTimeFormat` is the only reliable way to resolve a wall-clock day in
 * an arbitrary IANA zone, and it takes a `Date`. That is why the raw `Date`
 * construction is allowed here; nothing in this module reads the clock.
 *
 * Pure, so the bucketing and de-duplication rules are testable without touching
 * the filesystem or the network.
 *
 * @module usageAggregation
 */
import {
  USAGE_SUMMARY_MAX_BUCKETS_PER_PROVIDER,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageResolution,
  type UsageTokenTotals,
} from "@t3tools/contracts";

import { addTotals, EMPTY_TOTALS, type UsageRecord } from "./usageTranscripts.ts";
import { cacheSavingsUsd, priceUsage, type RateTable } from "./usagePricing.ts";

/**
 * Formats an instant as a `YYYY-MM-DD` day in `timeZone`.
 *
 * `en-CA` yields ISO-ordered parts, which is why it is used here rather than
 * assembling the day from `Date` getters (those are host-local only).
 */
export function makeDayFormatter(timeZone: string): (timestampMs: number) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // An unknown zone should degrade to UTC rather than fail the whole scan.
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return (timestampMs) => format.format(new Date(timestampMs));
}

export function isValidUsageTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_DEDUPE_KEYS_PER_PROVIDER = 50_000;
const MAX_SESSION_MEMBERSHIPS_PER_PROVIDER = 50_000;

interface MutableBucket {
  totals: UsageTokenTotals;
  costUsd: number;
  cacheSavingsUsd: number;
  records: number;
  unpricedRecords: number;
  providerReportedRecords: number;
  sessions: Set<string>;
}

export interface AggregateOptions {
  readonly timeZone: string;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly rates: RateTable;
  readonly resolution?: UsageResolution;
  readonly sinceTimeMs?: number;
  readonly untilTimeMs?: number;
  /** Test overrides; production uses the matching wire/resource ceilings. */
  readonly maxBucketsPerProvider?: number;
  readonly maxDedupeKeysPerProvider?: number;
  readonly maxSessionMembershipsPerProvider?: number;
}

export interface AggregateResult {
  readonly buckets: readonly UsageBucket[];
  /** Records dropped because an earlier record carried the same dedupe key. */
  readonly duplicatesDropped: number;
  /** Records whose day fell outside the requested window. */
  readonly outOfWindow: number;
  /** Records omitted because retaining another identity or bucket exceeded a ceiling. */
  readonly capacityDropped: number;
  /** Distinct-session memberships omitted while token/cost totals stayed complete. */
  readonly sessionMembershipsOmitted: number;
}

export interface UsageAggregateCapacity {
  readonly droppedRecords: number;
  readonly omittedSessionMemberships: number;
}

/**
 * Accumulates records across many files.
 *
 * De-duplication is global across the whole scan, not per file: Claude Code
 * copies a message's records forward when a session is resumed or forked, so
 * the same `dedupeKey` legitimately appears in several transcripts.
 */
export class UsageAggregator {
  readonly #buckets = new Map<string, MutableBucket>();
  readonly #seen = new Set<string>();
  readonly #bucketCounts = new Map<UsageProviderKind, number>();
  readonly #dedupeKeyCounts = new Map<UsageProviderKind, number>();
  readonly #sessionMembershipCounts = new Map<UsageProviderKind, number>();
  readonly #capacityDropped = new Map<UsageProviderKind, number>();
  readonly #sessionMembershipsOmitted = new Map<UsageProviderKind, number>();
  readonly #toDay: (timestampMs: number) => string;
  readonly #hourlyWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null;
  readonly #options: AggregateOptions;
  readonly #maxBucketsPerProvider: number;
  readonly #maxDedupeKeysPerProvider: number;
  readonly #maxSessionMembershipsPerProvider: number;
  #duplicatesDropped = 0;
  #outOfWindow = 0;

  constructor(options: AggregateOptions) {
    this.#options = options;
    this.#maxBucketsPerProvider =
      options.maxBucketsPerProvider ?? USAGE_SUMMARY_MAX_BUCKETS_PER_PROVIDER;
    this.#maxDedupeKeysPerProvider =
      options.maxDedupeKeysPerProvider ?? MAX_DEDUPE_KEYS_PER_PROVIDER;
    this.#maxSessionMembershipsPerProvider =
      options.maxSessionMembershipsPerProvider ?? MAX_SESSION_MEMBERSHIPS_PER_PROVIDER;
    for (const limit of [
      this.#maxBucketsPerProvider,
      this.#maxDedupeKeysPerProvider,
      this.#maxSessionMembershipsPerProvider,
    ]) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error("Usage aggregation limits must be positive safe integers");
      }
    }
    this.#toDay = makeDayFormatter(options.timeZone);
    if (options.resolution === "hour") {
      if (options.sinceTimeMs === undefined || options.untilTimeMs === undefined) {
        throw new Error("Hourly usage aggregation requires exact time bounds");
      }
      this.#hourlyWindow = {
        sinceTimeMs: options.sinceTimeMs,
        untilTimeMs: options.untilTimeMs,
      };
    } else {
      this.#hourlyWindow = null;
    }
  }

  /**
   * Folds one record in. Returns whether it actually contributed, so callers
   * can derive per-window facts (distinct sessions, for one) from the records
   * that landed rather than everything the mtime prefilter happened to admit.
   */
  add(record: UsageRecord): boolean {
    if (
      this.#hourlyWindow !== null &&
      (record.timestampMs < this.#hourlyWindow.sinceTimeMs ||
        record.timestampMs >= this.#hourlyWindow.untilTimeMs)
    ) {
      this.#outOfWindow += 1;
      return false;
    }

    const day = this.#toDay(record.timestampMs);
    if (
      this.#hourlyWindow === null &&
      (day < this.#options.sinceDay || day > this.#options.untilDay)
    ) {
      this.#outOfWindow += 1;
      return false;
    }

    // Out-of-window records must not consume the dedupe budget or suppress an
    // in-window copy of the same provider record encountered later.
    if (record.dedupeKey !== null) {
      const dedupeIdentity = `${record.provider}\u0000${record.dedupeKey}`;
      if (this.#seen.has(dedupeIdentity)) {
        this.#duplicatesDropped += 1;
        return false;
      }
      const dedupeKeyCount = this.#dedupeKeyCounts.get(record.provider) ?? 0;
      if (dedupeKeyCount >= this.#maxDedupeKeysPerProvider) {
        this.#recordCapacityDrop(record.provider);
        return false;
      }
      this.#seen.add(dedupeIdentity);
      this.#dedupeKeyCounts.set(record.provider, dedupeKeyCount + 1);
    }

    const hourStart =
      this.#hourlyWindow === null
        ? ""
        : new Date(
            this.#hourlyWindow.sinceTimeMs +
              Math.floor((record.timestampMs - this.#hourlyWindow.sinceTimeMs) / HOUR_MS) * HOUR_MS,
          ).toISOString();
    const key = `${day}\u0000${hourStart}\u0000${record.provider}\u0000${record.model}`;
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      const bucketCount = this.#bucketCounts.get(record.provider) ?? 0;
      if (bucketCount >= this.#maxBucketsPerProvider) {
        this.#recordCapacityDrop(record.provider);
        return false;
      }
      bucket = {
        totals: EMPTY_TOTALS,
        costUsd: 0,
        cacheSavingsUsd: 0,
        records: 0,
        unpricedRecords: 0,
        providerReportedRecords: 0,
        sessions: new Set<string>(),
      };
      this.#buckets.set(key, bucket);
      this.#bucketCounts.set(record.provider, bucketCount + 1);
    }

    const priced = priceUsage(
      this.#options.rates,
      record.model,
      record.totals,
      record.reportedCostUsd,
    );

    bucket.totals = addTotals(bucket.totals, record.totals);
    bucket.costUsd += priced.costUsd;
    bucket.cacheSavingsUsd += cacheSavingsUsd(this.#options.rates, record.model, record.totals);
    bucket.records += 1;
    if (priced.costSource === "unpriced") bucket.unpricedRecords += 1;
    if (priced.costSource === "providerReported") bucket.providerReportedRecords += 1;
    if (record.sessionId.length > 0 && !bucket.sessions.has(record.sessionId)) {
      const membershipCount = this.#sessionMembershipCounts.get(record.provider) ?? 0;
      if (membershipCount >= this.#maxSessionMembershipsPerProvider) {
        this.#sessionMembershipsOmitted.set(
          record.provider,
          (this.#sessionMembershipsOmitted.get(record.provider) ?? 0) + 1,
        );
      } else {
        bucket.sessions.add(record.sessionId);
        this.#sessionMembershipCounts.set(record.provider, membershipCount + 1);
      }
    }
    return true;
  }

  capacityForProvider(provider: UsageProviderKind): UsageAggregateCapacity {
    return {
      droppedRecords: this.#capacityDropped.get(provider) ?? 0,
      omittedSessionMemberships: this.#sessionMembershipsOmitted.get(provider) ?? 0,
    };
  }

  #recordCapacityDrop(provider: UsageProviderKind): void {
    this.#capacityDropped.set(provider, (this.#capacityDropped.get(provider) ?? 0) + 1);
  }

  finish(): AggregateResult {
    const buckets: UsageBucket[] = [];
    for (const [key, bucket] of this.#buckets) {
      const [day = "", hourStart = "", provider = "", model = ""] = key.split("\u0000");
      buckets.push({
        day: day as UsageDay,
        ...(hourStart === "" ? {} : { hourStart }),
        provider: provider as UsageBucket["provider"],
        model,
        totals: bucket.totals,
        costUsd: bucket.costUsd,
        cacheSavingsUsd: bucket.cacheSavingsUsd,
        costSource: resolveCostSource(bucket),
        records: bucket.records,
        unpricedRecords: bucket.unpricedRecords,
        sessions: bucket.sessions.size,
      });
    }
    // Stable ordering keeps payloads diffable and snapshot tests meaningful.
    buckets.sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        (a.hourStart ?? "").localeCompare(b.hourStart ?? "") ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );

    return {
      buckets,
      duplicatesDropped: this.#duplicatesDropped,
      outOfWindow: this.#outOfWindow,
      capacityDropped: [...this.#capacityDropped.values()].reduce((sum, count) => sum + count, 0),
      sessionMembershipsOmitted: [...this.#sessionMembershipsOmitted.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  }
}

/**
 * A bucket mixes records from one model, but their cost provenance can differ
 * when only some records carried a reported cost. The weakest provenance in the
 * bucket wins so the UI never overstates confidence.
 */
function resolveCostSource(bucket: MutableBucket): UsageBucket["costSource"] {
  if (bucket.unpricedRecords === bucket.records) return "unpriced";
  if (bucket.providerReportedRecords === bucket.records) return "providerReported";
  return "modelPriced";
}
