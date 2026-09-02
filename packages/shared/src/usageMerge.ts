/**
 * Merges per-environment usage summaries into the single view the page renders.
 *
 * Pure, so the de-duplication and derivation rules can be tested without a
 * connected environment.
 *
 * @module usageMerge
 */
import {
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type UsageBucket,
  type UsageProviderKind,
  type UsageSourceFingerprint,
  type UsageSummary,
} from "@t3tools/contracts";

export interface EnvironmentUsage {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly summary: UsageSummary;
}

/** Prevent one usage-page render from multiplying a large summary by a fleet. */
export const USAGE_MERGE_MAX_ENVIRONMENTS = 32;
const USAGE_MERGE_MAX_COVERAGE_MESSAGES = 128;
const USAGE_MERGE_COVERAGE_MESSAGE_MAX_LENGTH = 1_024;

export interface ProviderTotals {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface HourlyTotals {
  readonly day: string;
  readonly hourStart: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface MergedUsage {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly hourly: readonly HourlyTotals[];
  readonly costQuality: CostQuality;
  /** Environments whose data was dropped as a duplicate of another's. */
  readonly duplicateSources: readonly string[];
  /** Partial or failed source diagnostics selected after de-duplication. */
  readonly sourceWarnings: readonly string[];
  /** Inputs beyond the bounded fleet fan-in. */
  readonly omittedEnvironmentCount: number;
  /** Additional duplicate/source diagnostics omitted from this render. */
  readonly coverageWarningsOmitted: number;
  readonly contributingEnvironments: readonly EnvironmentId[];
  readonly staleEnvironments: readonly EnvironmentId[];
}

/**
 * Two sources are the same physical transcript directory only when host,
 * provider, path and filesystem identity all agree.
 *
 * `volumeId` is what stops two machines that happen to share a hostname and a
 * home path, which is every Mac in a fleet, from collapsing into one source and
 * having one of them silently dropped.
 */
function fingerprintKey(fingerprint: UsageSourceFingerprint, environmentId: EnvironmentId): string {
  // Empty volume ids are explicitly allowed when filesystem identity cannot
  // be read. In that case de-duplicating across environments would guess that
  // two machines with the same hostname/path are one source and lose usage.
  const volumeIdentity =
    fingerprint.volumeId.length === 0
      ? `unknown:${environmentId}`
      : `volume:${fingerprint.volumeId}`;
  // JSON tuple encoding avoids collisions between host/path strings that
  // contain the delimiter used by the old space-joined key.
  return JSON.stringify([
    fingerprint.hostId,
    fingerprint.provider,
    fingerprint.resolvedHomePath,
    volumeIdentity,
  ]);
}

function boundedCoverageMessage(message: string): string {
  return message.length <= USAGE_MERGE_COVERAGE_MESSAGE_MAX_LENGTH
    ? message
    : `${message.slice(0, USAGE_MERGE_COVERAGE_MESSAGE_MAX_LENGTH - 1)}…`;
}

/**
 * Decides which environment owns each physical transcript directory.
 *
 * Several environments on one machine (worktree servers, for instance) resolve
 * the same provider home and would otherwise double count every token. The
 * A complete scan wins over a partial scan; ties use stable environment-id
 * order. The rest have that provider's buckets dropped, so an incomplete
 * lower-id environment cannot suppress a complete duplicate.
 */
function claimSources(environments: readonly EnvironmentUsage[]): {
  readonly ownerByFingerprint: ReadonlyMap<string, EnvironmentId>;
  readonly duplicates: readonly string[];
  readonly warningsOmitted: number;
} {
  const claims = new Map<
    string,
    {
      readonly environmentId: EnvironmentId;
      readonly label: string;
      readonly path: string;
      readonly quality: number;
    }
  >();
  const duplicates: string[] = [];
  let warningsOmitted = 0;

  const recordDuplicate = (label: string, path: string) => {
    if (duplicates.length < USAGE_MERGE_MAX_COVERAGE_MESSAGES) {
      duplicates.push(boundedCoverageMessage(`${label}: ${path}`));
    } else {
      warningsOmitted += 1;
    }
  };

  const ordered = [...environments].sort((a, b) => a.environmentId.localeCompare(b.environmentId));

  for (const environment of ordered) {
    for (const source of environment.summary.sources) {
      if (source.status === "missing" || source.status === "failed") continue;
      const key = fingerprintKey(source.fingerprint, environment.environmentId);
      const quality = source.status === "ok" ? 2 : 1;
      const current = claims.get(key);
      if (current === undefined) {
        claims.set(key, {
          environmentId: environment.environmentId,
          label: environment.label,
          path: source.fingerprint.resolvedHomePath,
          quality,
        });
        continue;
      }
      if (current.environmentId === environment.environmentId) {
        if (quality > current.quality) {
          claims.set(key, { ...current, quality });
        }
        continue;
      }
      if (quality > current.quality) {
        recordDuplicate(current.label, current.path);
        claims.set(key, {
          environmentId: environment.environmentId,
          label: environment.label,
          path: source.fingerprint.resolvedHomePath,
          quality,
        });
      } else {
        recordDuplicate(environment.label, source.fingerprint.resolvedHomePath);
      }
    }
  }

  return {
    ownerByFingerprint: new Map(
      [...claims].map(([key, claim]) => [key, claim.environmentId] as const),
    ),
    duplicates,
    warningsOmitted,
  };
}

/** Sources this environment owns after fingerprint claims, plus their buckets. */
function ownedContribution(
  environment: EnvironmentUsage,
  ownerByFingerprint: ReadonlyMap<string, EnvironmentId>,
): {
  readonly buckets: readonly UsageBucket[];
  readonly sessionsByProvider: ReadonlyMap<UsageProviderKind, number>;
} {
  const ownedProviders = new Set<UsageProviderKind>();
  const sessionsByProvider = new Map<UsageProviderKind, number>();
  for (const source of environment.summary.sources) {
    if (source.status === "missing" || source.status === "failed") continue;
    const key = fingerprintKey(source.fingerprint, environment.environmentId);
    if (ownerByFingerprint.get(key) === environment.environmentId) {
      const provider = source.fingerprint.provider;
      ownedProviders.add(provider);
      // Distinct within a directory. Summing per-bucket session counts instead
      // would count a session once per day and model it spans.
      sessionsByProvider.set(
        provider,
        (sessionsByProvider.get(provider) ?? 0) + source.distinctSessions,
      );
    }
  }
  return {
    buckets: environment.summary.buckets.filter((bucket) => ownedProviders.has(bucket.provider)),
    sessionsByProvider,
  };
}

function sourceCoverageWarnings(
  environments: readonly EnvironmentUsage[],
  ownerByFingerprint: ReadonlyMap<string, EnvironmentId>,
): { readonly warnings: readonly string[]; readonly omitted: number } {
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  let omitted = 0;
  const recordWarning = (message: string) => {
    const bounded = boundedCoverageMessage(message);
    if (seenWarnings.has(bounded)) return;
    seenWarnings.add(bounded);
    if (warnings.length < USAGE_MERGE_MAX_COVERAGE_MESSAGES) {
      warnings.push(bounded);
    } else {
      omitted += 1;
    }
  };

  for (const environment of environments) {
    for (const source of environment.summary.sources) {
      const key = fingerprintKey(source.fingerprint, environment.environmentId);
      const detail =
        source.message ??
        `${source.fingerprint.provider} transcript reporting is ${source.status}.`;
      if (
        source.status === "partial" &&
        ownerByFingerprint.get(key) === environment.environmentId
      ) {
        recordWarning(`${environment.label}: ${detail}`);
      } else if (source.status === "failed" && !ownerByFingerprint.has(key)) {
        recordWarning(`${environment.label}: ${detail}`);
      }
    }
  }
  return { warnings, omitted };
}

function bucketTokens(bucket: UsageBucket): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

function isCompatibleContractVersion(version: number, expected: number): boolean {
  return version >= USAGE_MERGE_COMPATIBLE_SINCE && version <= expected;
}

const EMPTY_MERGED: MergedUsage = {
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  models: [],
  daily: [],
  hourly: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
  duplicateSources: [],
  sourceWarnings: [],
  omittedEnvironmentCount: 0,
  coverageWarningsOmitted: 0,
  contributingEnvironments: [],
  staleEnvironments: [],
};

/**
 * Merges every connected environment's summary.
 *
 * `expectedContractVersion` guards against an environment running older server
 * code: rather than blocking the page, incompatible data is excluded and its
 * id is reported so the UI can say coverage is partial. Versions in
 * [{@link USAGE_MERGE_COMPATIBLE_SINCE}, expected] still merge, so an additive
 * provider expansion does not drop Claude/Codex totals from older servers.
 */
export function mergeUsage(
  environments: readonly EnvironmentUsage[],
  expectedContractVersion: number,
): MergedUsage {
  if (environments.length === 0) return EMPTY_MERGED;

  const retainedEnvironments = environments.slice(0, USAGE_MERGE_MAX_ENVIRONMENTS);
  const omittedEnvironmentCount = environments.length - retainedEnvironments.length;

  const current: EnvironmentUsage[] = [];
  const staleEnvironments: EnvironmentId[] = [];
  for (const environment of retainedEnvironments) {
    if (
      isCompatibleContractVersion(
        environment.summary.contractVersion,
        expectedContractVersion,
      )
    ) {
      current.push(environment);
    } else {
      staleEnvironments.push(environment.environmentId);
    }
  }

  const {
    ownerByFingerprint,
    duplicates,
    warningsOmitted: duplicateWarningsOmitted,
  } = claimSources(current);
  const { warnings: sourceWarnings, omitted: sourceWarningsOmitted } = sourceCoverageWarnings(
    current,
    ownerByFingerprint,
  );

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let sessions = 0;
  let cacheSavingsUsd = 0;
  let providerReportedRecords = 0;
  let unpricedRecords = 0;

  const providerAccumulator = new Map<
    UsageProviderKind,
    { costUsd: number; totalTokens: number; records: number; sessions: number }
  >();
  const modelAccumulator = new Map<
    string,
    { provider: UsageProviderKind; costUsd: number; totalTokens: number; records: number }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const hourlyAccumulator = new Map<
    string,
    {
      day: string;
      hourStart: string;
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const contributingEnvironments: EnvironmentId[] = [];

  for (const environment of current) {
    const { buckets, sessionsByProvider } = ownedContribution(environment, ownerByFingerprint);
    if (buckets.length > 0) contributingEnvironments.push(environment.environmentId);

    for (const [providerKind, providerSessions] of sessionsByProvider) {
      sessions += providerSessions;
      if (providerSessions === 0) continue;
      const provider = providerAccumulator.get(providerKind) ?? {
        costUsd: 0,
        totalTokens: 0,
        records: 0,
        sessions: 0,
      };
      provider.sessions += providerSessions;
      providerAccumulator.set(providerKind, provider);
    }

    for (const bucket of buckets) {
      const tokens = bucketTokens(bucket);

      costUsd += bucket.costUsd;
      cacheSavingsUsd += bucket.cacheSavingsUsd;
      uncachedInputTokens += bucket.totals.uncachedInputTokens;
      cachedInputTokens += bucket.totals.cachedInputTokens;
      cacheCreationTokens += bucket.totals.cacheCreationTokens;
      outputTokens += bucket.totals.outputTokens;
      reasoningTokens += bucket.totals.reasoningTokens;
      records += bucket.records;
      unpricedRecords += bucket.unpricedRecords;
      if (bucket.costSource === "providerReported") providerReportedRecords += bucket.records;

      const provider = providerAccumulator.get(bucket.provider) ?? {
        costUsd: 0,
        totalTokens: 0,
        records: 0,
        sessions: 0,
      };
      provider.costUsd += bucket.costUsd;
      provider.totalTokens += tokens;
      provider.records += bucket.records;
      providerAccumulator.set(bucket.provider, provider);

      const modelKey = `${bucket.provider} ${bucket.model}`;
      const model = modelAccumulator.get(modelKey) ?? {
        provider: bucket.provider,
        costUsd: 0,
        totalTokens: 0,
        records: 0,
      };
      model.costUsd += bucket.costUsd;
      model.totalTokens += tokens;
      model.records += bucket.records;
      modelAccumulator.set(modelKey, model);

      const day = dailyAccumulator.get(bucket.day) ?? {
        costUsd: 0,
        totalTokens: 0,
        byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
      };
      day.costUsd += bucket.costUsd;
      day.totalTokens += tokens;
      const dayProvider = day.byProvider.get(bucket.provider) ?? { costUsd: 0, totalTokens: 0 };
      dayProvider.costUsd += bucket.costUsd;
      dayProvider.totalTokens += tokens;
      day.byProvider.set(bucket.provider, dayProvider);
      dailyAccumulator.set(bucket.day, day);

      if (bucket.hourStart !== undefined) {
        const hour = hourlyAccumulator.get(bucket.hourStart) ?? {
          day: bucket.day,
          hourStart: bucket.hourStart,
          costUsd: 0,
          totalTokens: 0,
          byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
        };
        hour.costUsd += bucket.costUsd;
        hour.totalTokens += tokens;
        const hourProvider = hour.byProvider.get(bucket.provider) ?? {
          costUsd: 0,
          totalTokens: 0,
        };
        hourProvider.costUsd += bucket.costUsd;
        hourProvider.totalTokens += tokens;
        hour.byProvider.set(bucket.provider, hourProvider);
        hourlyAccumulator.set(bucket.hourStart, hour);
      }
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  const providers: ProviderTotals[] = [...providerAccumulator.entries()]
    .map(([provider, totals]) => ({
      provider,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      sessions: totals.sessions,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
      tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const models: ModelTotals[] = [...modelAccumulator.entries()]
    .map(([key, totals]) => ({
      model: key.slice(key.indexOf(" ") + 1),
      provider: totals.provider,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const daily: DailyTotals[] = [...dailyAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourly: HourlyTotals[] = [...hourlyAccumulator.values()].sort((a, b) =>
    a.hourStart.localeCompare(b.hourStart),
  );

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions,
    providers,
    models,
    daily,
    hourly,
    costQuality: {
      providerReportedShare: records === 0 ? 0 : providerReportedRecords / records,
      unpricedShare: records === 0 ? 0 : unpricedRecords / records,
      modelPricedShare:
        records === 0 ? 0 : (records - providerReportedRecords - unpricedRecords) / records,
      cacheSavingsUsd,
    },
    duplicateSources: duplicates,
    sourceWarnings,
    omittedEnvironmentCount,
    coverageWarningsOmitted: duplicateWarningsOmitted + sourceWarningsOmitted,
    contributingEnvironments,
    staleEnvironments,
  };
}
