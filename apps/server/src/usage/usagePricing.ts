/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the same
 * table `ccusage` prices against. Kimi Code transcripts use CLI ids that
 * LiteLLM does not list (`k3`, `kimi-code/k3`, `kimi-for-coding`), so those
 * fall back to first-party Kimi API rates. Everything here is pure: fetching
 * and caching the table lives in `UsageService`.
 *
 * @module usagePricing
 */
import {
  USAGE_MODEL_MAX_LENGTH,
  type UsageCostSource,
  type UsageTokenTotals,
} from "@t3tools/contracts";

/**
 * The subset of a LiteLLM entry we price against. All values are USD per token.
 *
 * LiteLLM also publishes tiered variants (`*_above_272k_tokens`, `*_flex`,
 * `*_priority`, `*_batches`). We deliberately price at the base tier: the
 * transcripts don't record which tier served a request, so anything else would
 * be a guess dressed up as precision.
 */
export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/** Raw shape of one LiteLLM entry, narrowed to the fields we read. */
interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
}

const RATE_TABLE_MAX_MODELS = 50_000;
// One USD per token is orders of magnitude above real model pricing while
// keeping a hostile rate document from overflowing aggregate arithmetic.
const RATE_USD_PER_TOKEN_MAX = 1;

function boundedRate(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= RATE_USD_PER_TOKEN_MAX
    ? value
    : null;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries without both an input and an output rate are dropped: a half-priced
 * model would silently under-report cost, which is worse than reporting the
 * model as unpriced.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (table.size >= RATE_TABLE_MAX_MODELS) break;
    if (typeof raw !== "object" || raw === null) continue;
    const normalizedName = normalizeModelName(name);
    if (normalizedName.length === 0 || normalizedName.length > USAGE_MODEL_MAX_LENGTH) continue;
    const entry = raw as LiteLlmEntry;
    const input = boundedRate(entry.input_cost_per_token);
    const output = boundedRate(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    table.set(normalizedName, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Anthropic bills cache reads at a discount and cache writes at a
      // premium. When a model omits them, cached input is priced as plain
      // input rather than as free.
      cacheReadCostPerToken: boundedRate(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: boundedRate(entry.cache_creation_input_token_cost) ?? input,
    });
  }
  return table;
}

/**
 * Canonicalises a model name for lookup.
 *
 * Strips a `provider/` prefix (LiteLLM publishes both `claude-opus-5` and
 * `anthropic/claude-opus-5`) and lowercases, since transcripts are inconsistent
 * about casing.
 */
export function normalizeModelName(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * Models we never price, regardless of the table.
 *
 * `<synthetic>` marks locally generated messages that were never billed. Bare
 * family names ("opus", "sonnet") are genuinely ambiguous across generations,
 * so we report them as unpriced instead of guessing a generation.
 */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

/**
 * Official Kimi Open Platform rates, USD per token.
 *
 * Cache hits are discounted; cache writes are billed at the cache-miss input
 * rate. Sources: https://platform.kimi.ai/docs/pricing/chat-k3,
 * https://platform.kimi.ai/docs/pricing/chat-k27-code,
 * https://platform.kimi.ai/docs/pricing/chat-k26,
 * https://platform.kimi.ai/docs/pricing/chat-k25.
 */
function kimiRate(
  inputCostPerToken: number,
  cacheReadCostPerToken: number,
  outputCostPerToken: number,
): ModelRate {
  return {
    inputCostPerToken,
    outputCostPerToken,
    cacheReadCostPerToken,
    cacheCreationCostPerToken: inputCostPerToken,
  };
}

const KIMI_API_RATES: Readonly<Record<string, ModelRate>> = {
  "kimi-k3": kimiRate(3e-6, 3e-7, 1.5e-5),
  "kimi-k2.7-code": kimiRate(9.5e-7, 1.9e-7, 4e-6),
  "kimi-k2.7-code-highspeed": kimiRate(1.9e-6, 3.8e-7, 8e-6),
  "kimi-k2.6": kimiRate(9.5e-7, 1.6e-7, 4e-6),
  "kimi-k2.5": kimiRate(6e-7, 1e-7, 3e-6),
};

/**
 * Kimi Code CLI / transcript names → the API model id they bill as.
 *
 * `k3-256k` is the same K3 model with a smaller context cap, not a different
 * API price.
 */
const KIMI_MODEL_ALIASES: Readonly<Record<string, string>> = {
  k3: "kimi-k3",
  "k3-256k": "kimi-k3",
  "kimi-k3-256k": "kimi-k3",
  "kimi-for-coding": "kimi-k2.7-code",
  "k2.7": "kimi-k2.7-code",
  "k2.7-code": "kimi-k2.7-code",
  "kimi-for-coding-highspeed": "kimi-k2.7-code-highspeed",
  "k2.7-highspeed": "kimi-k2.7-code-highspeed",
  "k2.6": "kimi-k2.6",
  "k2.5": "kimi-k2.5",
};

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const normalized = normalizeModelName(model);
  if (normalized.length === 0 || UNPRICEABLE_MODELS.has(normalized)) return null;
  const canonical = KIMI_MODEL_ALIASES[normalized] ?? normalized;
  return (
    table.get(normalized) ??
    table.get(canonical) ??
    KIMI_API_RATES[canonical] ??
    KIMI_API_RATES[normalized] ??
    null
  );
}

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
}

/**
 * Prices a bucket's tokens.
 *
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
): PricedUsage {
  if (reportedCostUsd !== null && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  const costUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
    totals.outputTokens * rate.outputCostPerToken;

  return Number.isFinite(costUsd)
    ? { costUsd, costSource: "modelPriced" }
    : { costUsd: 0, costSource: "unpriced" };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Drives the "cache savings" figure.
 */
export function cacheSavingsUsd(table: RateTable, model: string, totals: UsageTokenTotals): number {
  const rate = lookupRate(table, model);
  if (rate === null) return 0;
  const savings = totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken);
  return Number.isFinite(savings) && savings > 0 ? savings : 0;
}
