/**
 * Usage reporting contract.
 *
 * Each environment scans the provider CLIs' own on-disk session transcripts
 * (`~/.claude/projects/**\/*.jsonl`, `~/.codex/sessions/**\/*.jsonl`,
 * `~/.grok/sessions/**\/updates.jsonl`, `~/.kimi-code/sessions/**\/wire.jsonl`,
 * `~/.cursor/acp-sessions`) rather than relying on T3 Code's own orchestration
 * projections, so usage stays complete even for turns that were never driven
 * through T3 Code. This mirrors the approach `ccusage` takes. Cursor's local
 * session store does not currently persist token usage, so that source is
 * reported empty until it does.
 *
 * Environments return pre-aggregated `(day, hourStart?, provider, model)`
 * buckets. Raw transcript records never cross the wire.
 *
 * @module usage
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Bumped whenever the shape of {@link UsageSummary} changes incompatibly. The
 * client renders partial coverage when an environment reports an older version
 * rather than failing the whole page.
 */
export const USAGE_CONTRACT_VERSION = 5 as const;

export const USAGE_PROVIDER_KINDS = ["claude", "codex", "cursor", "grok", "kimi"] as const;

export const USAGE_MODEL_MAX_LENGTH = 512;
export const USAGE_TIME_ZONE_MAX_LENGTH = 128;
export const USAGE_SUMMARY_MAX_BUCKETS_PER_PROVIDER = 4_096;
export const USAGE_SUMMARY_MAX_BUCKETS =
  USAGE_PROVIDER_KINDS.length * USAGE_SUMMARY_MAX_BUCKETS_PER_PROVIDER;
export const USAGE_SUMMARY_MAX_SOURCES = USAGE_PROVIDER_KINDS.length;

export const UsageProviderKind = Schema.Literals(USAGE_PROVIDER_KINDS);
export type UsageProviderKind = typeof UsageProviderKind.Type;

export function isUsageProviderKind(value: unknown): value is UsageProviderKind {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "grok" ||
    value === "kimi"
  );
}

/**
 * A calendar day in the reporting time zone, formatted `YYYY-MM-DD`.
 *
 * Days are bucketed server-side so that a turn always lands on the day the user
 * experienced it, not the UTC day.
 */
const USAGE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const UsageDay = TrimmedNonEmptyString.check(Schema.isPattern(USAGE_DAY_PATTERN)).pipe(
  Schema.brand("UsageDay"),
);
export type UsageDay = typeof UsageDay.Type;

export const UsageResolution = Schema.Literals(["day", "hour"]);
export type UsageResolution = typeof UsageResolution.Type;

/**
 * Why a bucket's cost is what it is.
 *
 * - `providerReported` - the transcript carried an explicit cost figure.
 * - `modelPriced` - we matched the model against a known API rate.
 * - `unpriced` - tokens are known, rates are not. Counted in totals, excluded
 *   from cost.
 */
export const UsageCostSource = Schema.Literals(["providerReported", "modelPriced", "unpriced"]);
export type UsageCostSource = typeof UsageCostSource.Type;

const UsageModel = TrimmedNonEmptyString.check(Schema.isMaxLength(USAGE_MODEL_MAX_LENGTH));
const UsageTimestamp = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
const UsageFiniteNonNegativeNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

/**
 * Token counts for a bucket.
 *
 * `cachedInputTokens` and `cacheCreationTokens` are disjoint from
 * `uncachedInputTokens`; summing all three gives total input. `reasoningTokens`
 * is a *subset* of `outputTokens` (Codex reports it that way, and Anthropic
 * folds thinking into output), so it must never be added on top.
 */
export const UsageTokenTotals = Schema.Struct({
  uncachedInputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheCreationTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
});
export type UsageTokenTotals = typeof UsageTokenTotals.Type;

/**
 * One `(day, hourStart?, provider, model)` cell. `hourStart` is the UTC start
 * instant of a rolling bucket and is present only for hourly requests.
 *
 * `costUsd` is the raw API-equivalent cost of these tokens. It is not money
 * spent: subscription plans bill separately. `unpricedRecords` counts records
 * whose tokens are included in the token totals but which contributed nothing
 * to `costUsd`.
 */
const UsageBucketFields = Schema.Struct({
  day: UsageDay,
  hourStart: Schema.optional(UsageTimestamp),
  provider: UsageProviderKind,
  model: UsageModel,
  totals: UsageTokenTotals,
  costUsd: UsageFiniteNonNegativeNumber,
  /**
   * What the cached input would have cost at full input rates minus what it
   * actually cost. Requires the rate table, so it is computed alongside cost
   * rather than derived on the client.
   */
  cacheSavingsUsd: UsageFiniteNonNegativeNumber,
  costSource: UsageCostSource,
  /** Distinct assistant responses, after de-duplication. */
  records: NonNegativeInt,
  unpricedRecords: NonNegativeInt,
  /** Distinct transcript sessions that contributed to this cell. */
  sessions: NonNegativeInt,
});
export const UsageBucket = UsageBucketFields.check(
  Schema.makeFilter((bucket) => {
    if (bucket.totals.reasoningTokens > bucket.totals.outputTokens) {
      return "Usage reasoning tokens must be a subset of output tokens.";
    }
    if (bucket.unpricedRecords > bucket.records) {
      return "Usage unpriced records must not exceed total records.";
    }
    if (bucket.sessions > bucket.records) {
      return "Usage sessions must not exceed contributing records.";
    }
    return true;
  }),
);
export type UsageBucket = typeof UsageBucket.Type;

/**
 * Identifies the physical transcript directory a source read from.
 *
 * Two environments on the same machine (worktree servers, for example) resolve
 * the same provider home and would otherwise double count. The client drops
 * duplicate fingerprints before merging.
 */
export const UsageSourceFingerprint = Schema.Struct({
  hostId: TrimmedNonEmptyString.check(Schema.isMaxLength(253)),
  provider: UsageProviderKind,
  resolvedHomePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  /**
   * Filesystem identity of the transcript directory, as `device:inode`.
   *
   * Hostname and path alone are not enough: every Mac in a fleet resolves
   * `/Users/<user>/.claude`, so two machines that happen to share a hostname
   * would look like one source and have their usage silently dropped. The
   * device/inode pair is stable for two servers reading the same directory and
   * effectively never collides across machines. Empty when it cannot be read.
   */
  volumeId: Schema.String.check(Schema.isMaxLength(256)),
});
export type UsageSourceFingerprint = typeof UsageSourceFingerprint.Type;

export const UsageSourceStatus = Schema.Literals(["ok", "missing", "partial", "failed"]);
export type UsageSourceStatus = typeof UsageSourceStatus.Type;

export const UsageSource = Schema.Struct({
  fingerprint: UsageSourceFingerprint,
  status: UsageSourceStatus,
  scannedFiles: NonNegativeInt,
  skippedFiles: NonNegativeInt,
  /** Records that parsed but carried no recognisable usage payload. */
  malformedRecords: NonNegativeInt,
  /**
   * Distinct transcript sessions seen under this directory. Buckets also carry
   * per-bucket session counts, but a session spans days and models, so summing
   * those overcounts; this is the figure clients should total.
   */
  distinctSessions: NonNegativeInt,
  message: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
});
export type UsageSource = typeof UsageSource.Type;

const UsageSources = Schema.Array(UsageSource).check(
  Schema.isMaxLength(USAGE_SUMMARY_MAX_SOURCES),
  Schema.makeFilter((sources) => {
    const providers = new Set<UsageProviderKind>();
    for (const source of sources) {
      if (providers.has(source.fingerprint.provider)) {
        return `Usage summary source provider '${source.fingerprint.provider}' must be unique.`;
      }
      providers.add(source.fingerprint.provider);
    }
    return true;
  }),
);

export const UsagePricingStatus = Schema.Literals(["fresh", "cached", "unavailable"]);
export type UsagePricingStatus = typeof UsagePricingStatus.Type;

/**
 * Provenance for the rate table, so the UI can be honest about how good the
 * cost figures are.
 */
export const UsagePricing = Schema.Struct({
  status: UsagePricingStatus,
  source: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  fetchedAt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  knownModels: NonNegativeInt,
});
export type UsagePricing = typeof UsagePricing.Type;

export const UsageSummaryInput = Schema.Struct({
  /** Inclusive first day of the window, in `timeZone`. */
  sinceDay: UsageDay,
  /** Inclusive last day of the window, in `timeZone`. */
  untilDay: UsageDay,
  /**
   * IANA zone the client wants days bucketed in. An offset would be wrong for
   * any window that crosses a DST boundary.
   */
  timeZone: TrimmedNonEmptyString.check(Schema.isMaxLength(USAGE_TIME_ZONE_MAX_LENGTH)),
  /** Defaults to daily for older clients. */
  resolution: Schema.optional(UsageResolution),
  /** Inclusive UTC instant for an hourly rolling window. */
  sinceTime: Schema.optional(UsageTimestamp),
  /** Exclusive UTC instant for an hourly rolling window. */
  untilTime: Schema.optional(UsageTimestamp),
});
export type UsageSummaryInput = typeof UsageSummaryInput.Type;

export const UsageSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: Schema.String.check(Schema.isMaxLength(64)),
  timeZone: TrimmedNonEmptyString.check(Schema.isMaxLength(USAGE_TIME_ZONE_MAX_LENGTH)),
  sinceDay: UsageDay,
  untilDay: UsageDay,
  buckets: Schema.Array(UsageBucket).check(Schema.isMaxLength(USAGE_SUMMARY_MAX_BUCKETS)),
  sources: UsageSources,
  pricing: UsagePricing,
  /** Wall-clock cost of the scan, surfaced in diagnostics. */
  scanDurationMs: NonNegativeInt,
});
export type UsageSummary = typeof UsageSummary.Type;

export class UsageReadError extends Schema.TaggedErrorClass<UsageReadError>()("UsageReadError", {
  reason: Schema.Literals(["scanFailed", "invalidWindow"]),
  /** Stable, bounded description. The underlying failure travels in `cause`. */
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Usage read failed (${this.reason}): ${this.detail}`;
  }
}
