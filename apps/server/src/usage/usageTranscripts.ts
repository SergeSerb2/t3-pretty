/**
 * Pure parsers for the provider CLIs' on-disk session transcripts.
 *
 * Both parsers are line-at-a-time reducers so callers can stream large files
 * without materialising them. Neither touches the filesystem.
 *
 * @module usageTranscripts
 */
import {
  USAGE_MODEL_MAX_LENGTH,
  type UsageProviderKind,
  type UsageTokenTotals,
} from "@t3tools/contracts";

export interface UsageRecord {
  readonly provider: UsageProviderKind;
  readonly timestampMs: number;
  readonly model: string;
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly reportedCostUsd: number | null;
  /**
   * Key for cross-file de-duplication, or `null` when the record is inherently
   * unique and needs no dedup.
   */
  readonly dedupeKey: string | null;
}

const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

const USAGE_SESSION_ID_MAX_LENGTH = 1_024;
const USAGE_DEDUPE_PART_MAX_LENGTH = 1_024;
const USAGE_TOKEN_FIELD_MAX = 10_000_000_000;
const REPORTED_COST_USD_MAX = 1_000_000;

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), USAGE_TOKEN_FIELD_MAX)
    : 0;
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function reportedCost(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= REPORTED_COST_USD_MAX
    ? value
    : null;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function addTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export function totalTokens(totals: UsageTokenTotals): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

/**
 * Cheap substring gate applied before `JSON.parse`.
 *
 * Transcripts are mostly tool output; only a minority of lines carry usage. On
 * a 30-day window this skips roughly half the lines outright and is worth about
 * an order of magnitude.
 */
export function mightCarryUsage(line: string, provider: UsageProviderKind): boolean {
  switch (provider) {
    case "claude":
      return line.includes('"usage"');
    case "codex":
      return line.includes('"token_count"');
    case "grok":
      return line.includes('"turn_completed"');
    case "kimi":
      return line.includes('"usage.record"');
    case "cursor":
      // Cursor's ACP session store does not persist token usage today.
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Claude Code                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses one line of a Claude Code transcript.
 *
 * T3 Code writes one record per assistant *content block*, and every one of
 * those records repeats the same complete `usage` object for the parent
 * message. Summing them overcounts by roughly 2.4x on a real workload, so the
 * caller must drop repeats by `dedupeKey` and keep the first.
 */
export function parseClaudeLine(line: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["type"] !== "assistant") return null;

  const message = record["message"];
  if (typeof message !== "object" || message === null) return null;
  const messageRecord = message as Record<string, unknown>;

  const usage = messageRecord["usage"];
  if (typeof usage !== "object" || usage === null) return null;
  const usageRecord = usage as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  const model = boundedString(messageRecord["model"], USAGE_MODEL_MAX_LENGTH);
  if (model === null || model.length === 0) return null;

  const messageId = typeof messageRecord["id"] === "string" ? messageRecord["id"] : null;
  const requestId = typeof record["requestId"] === "string" ? record["requestId"] : null;
  if (
    (messageId !== null && messageId.length > USAGE_DEDUPE_PART_MAX_LENGTH) ||
    (requestId !== null && requestId.length > USAGE_DEDUPE_PART_MAX_LENGTH)
  ) {
    return null;
  }
  // Matches ccusage: prefer the message/request pair, fall back to whichever
  // half exists. Records with neither cannot be de-duplicated.
  const dedupeKey =
    messageId === null && requestId === null ? null : `${messageId ?? ""}:${requestId ?? ""}`;

  const sessionId =
    record["sessionId"] === undefined
      ? ""
      : boundedString(record["sessionId"], USAGE_SESSION_ID_MAX_LENGTH);
  if (sessionId === null) return null;

  return {
    provider: "claude",
    timestampMs,
    model,
    sessionId,
    totals: {
      uncachedInputTokens: int(usageRecord["input_tokens"]),
      cachedInputTokens: int(usageRecord["cache_read_input_tokens"]),
      cacheCreationTokens: int(usageRecord["cache_creation_input_tokens"]),
      outputTokens: int(usageRecord["output_tokens"]),
      // Anthropic folds thinking tokens into output and does not break them out.
      reasoningTokens: 0,
    },
    reportedCostUsd: reportedCost(record["costUSD"]),
    dedupeKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Codex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rolling state for a single Codex rollout file.
 *
 * Codex `token_count` events carry no model, so the model is carried forward
 * from the most recent `turn_context`. Sessions that switch models mid-run
 * attribute correctly from the switch onward.
 */
export interface CodexScanState {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  /** While true, leading usage events are re-stamped copies of parent history. */
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

/**
 * A forked or subagent rollout opens with the parent's full history copied in,
 * every line re-stamped to the fork instant. Those copies are written in one
 * synchronous burst (observed gaps 0-40ms), while the child's first genuine
 * usage event only lands after a real model turn (observed 5s+). One second of
 * separation splits the two cleanly; `ccusage` uses the same threshold.
 */
const FORK_COPY_MAX_GAP_MS = 1000;

/** Whether a `session_meta` payload marks the rollout as a fork or subagent. */
function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

/**
 * Feeds one line of a Codex rollout into `state`, returning a record when the
 * line was a usage event.
 *
 * Deltas come from `last_token_usage`. Summing those across a session
 * reconciles with the session's final `total_token_usage`, provided
 * consecutive duplicate events are dropped, which this does.
 */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    // Only the first meta describes this file's own session. A forked rollout
    // repeats the ancestors' metas right after it; letting those through would
    // reassign every subsequent record to an ancestor session.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") {
      state.sessionId = id.length <= USAGE_SESSION_ID_MAX_LENGTH ? id : "";
    }
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") {
      state.model =
        payloadRecord["model"].length <= USAGE_MODEL_MAX_LENGTH ? payloadRecord["model"] : "";
    }
    return null;
  }

  if (payloadType !== "token_count") return null;

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  const last = (info as Record<string, unknown>)["last_token_usage"];
  if (typeof last !== "object" || last === null) return null;
  const lastRecord = last as Record<string, unknown>;

  // Only an event that is otherwise eligible may consume the duplicate
  // signature. A token_count arriving before its turn_context (no model yet)
  // must not poison it, or the re-emitted copy after the model is known would
  // be skipped as a duplicate and those tokens never counted.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;
  if (state.model.length === 0) return null;

  // Codex re-emits an unchanged token_count on some stream boundaries. Summing
  // those would double count, so identical consecutive payloads are skipped.
  const signature = JSON.stringify(lastRecord);
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  // In a forked rollout the copied parent history was already counted from the
  // parent's own file. Drop the leading burst; the first usage event separated
  // from its predecessor by a real turn's worth of time ends it for good.
  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }

  const inputTokens = int(lastRecord["input_tokens"]);
  const cachedInputTokens = int(lastRecord["cached_input_tokens"]);
  const cacheCreationTokens = int(lastRecord["cache_write_input_tokens"]);
  const outputTokens = int(lastRecord["output_tokens"]);

  const totals: UsageTokenTotals = {
    // Codex reports `input_tokens` inclusive of the cached portion.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: Math.min(outputTokens, int(lastRecord["reasoning_output_tokens"])),
  };

  if (totalTokens(totals) === 0) return null;

  return {
    provider: "codex",
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    // Codex does not report cost in the rollout.
    reportedCostUsd: null,
    // Events surviving the fork-copy suppression above are unique to this
    // rollout, so they need no global dedup.
    dedupeKey: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Grok                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Grok reports cost in integer ticks. Observed values line up with dollars
 * at 1e-9 USD per tick (a ~20k-token turn lands around $0.27).
 */
const GROK_COST_TICKS_PER_USD = 1_000_000_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Grok's top-level `timestamp` is unix seconds; `_meta.agentTimestampMs` is
 * already milliseconds. Prefer the millisecond field when present.
 */
function grokTimestampMs(
  record: Record<string, unknown>,
  params: Record<string, unknown>,
): number | null {
  const meta = asRecord(params["_meta"]);
  const agentMs = meta?.["agentTimestampMs"];
  if (typeof agentMs === "number" && Number.isFinite(agentMs) && agentMs > 0) {
    return Math.trunc(agentMs);
  }
  const timestamp = record["timestamp"];
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp < 1e12 ? Math.trunc(timestamp * 1000) : Math.trunc(timestamp);
  }
  return parseTimestampMs(timestamp);
}

function grokModelFromUsage(usage: Record<string, unknown>): string {
  const modelUsage = asRecord(usage["modelUsage"]);
  if (modelUsage === null) return "";
  let best = "";
  let bestTokens = -1;
  for (const [name, raw] of Object.entries(modelUsage)) {
    if (name.length === 0 || name.length > USAGE_MODEL_MAX_LENGTH) continue;
    const entry = asRecord(raw);
    const tokens = entry === null ? 0 : int(entry["totalTokens"]);
    if (tokens > bestTokens) {
      best = name;
      bestTokens = tokens;
    }
  }
  return best;
}

function grokTotals(usage: Record<string, unknown>): UsageTokenTotals {
  const inputTokens = int(usage["inputTokens"]);
  const cachedInputTokens = int(usage["cachedReadTokens"]);
  const cacheCreationTokens = int(usage["cacheCreationTokens"] ?? usage["cachedWriteTokens"]);
  const outputTokens = int(usage["outputTokens"]);
  return {
    // Like Codex: inputTokens is inclusive of cache reads and writes.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(
      outputTokens,
      int(usage["reasoningTokens"] ?? usage["thoughtTokens"]),
    ),
  };
}

/**
 * Parses one line of a Grok `updates.jsonl`. Only `turn_completed` updates
 * carry a closed-out usage object; intermediate stream lines do not.
 */
export function parseGrokLine(line: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) return null;
  const params = asRecord(record["params"]);
  if (params === null) return null;
  const update = asRecord(params["update"]);
  if (update === null || update["sessionUpdate"] !== "turn_completed") return null;

  const usage = asRecord(update["usage"]);
  if (usage === null) return null;

  const model = grokModelFromUsage(usage);
  if (model.length === 0) return null;

  const timestampMs = grokTimestampMs(record, params);
  if (timestampMs === null) return null;

  const totals = grokTotals(usage);
  if (totalTokens(totals) === 0) return null;

  const sessionId =
    params["sessionId"] === undefined
      ? ""
      : boundedString(params["sessionId"], USAGE_SESSION_ID_MAX_LENGTH);
  const promptId =
    update["prompt_id"] === undefined
      ? ""
      : boundedString(update["prompt_id"], USAGE_DEDUPE_PART_MAX_LENGTH);
  if (sessionId === null || promptId === null) return null;
  const ticks = usage["costUsdTicks"];
  const costFromTicks =
    typeof ticks === "number" && Number.isFinite(ticks) && ticks > 0
      ? ticks / GROK_COST_TICKS_PER_USD
      : null;

  return {
    provider: "grok",
    timestampMs,
    model,
    sessionId,
    totals,
    reportedCostUsd: reportedCost(costFromTicks),
    // prompt_id repeats across turns in a session; pair it with the instant.
    dedupeKey: `${sessionId}:${promptId}:${timestampMs}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Kimi                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Parses one line of a Kimi `wire.jsonl`. Only `usage.record` events are
 * counted: the matching `step.end` loop event repeats the same totals.
 */
export function parseKimiLine(line: string, sessionId: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null || record["type"] !== "usage.record") return null;

  const model = boundedString(record["model"], USAGE_MODEL_MAX_LENGTH);
  if (model === null || model.length === 0) return null;
  if (sessionId.length > USAGE_SESSION_ID_MAX_LENGTH) return null;

  const usage = asRecord(record["usage"]);
  if (usage === null) return null;

  const time = record["time"];
  if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return null;
  const timestampMs = time < 1e12 ? Math.trunc(time * 1000) : Math.trunc(time);

  const totals: UsageTokenTotals = {
    uncachedInputTokens: int(usage["inputOther"]),
    cachedInputTokens: int(usage["inputCacheRead"]),
    cacheCreationTokens: int(usage["inputCacheCreation"]),
    outputTokens: int(usage["output"]),
    reasoningTokens: 0,
  };
  if (totalTokens(totals) === 0) return null;

  return {
    provider: "kimi",
    timestampMs,
    model,
    sessionId,
    totals,
    reportedCostUsd: null,
    dedupeKey: `${sessionId}:${timestampMs}:${model}`,
  };
}

/** Session folder name (`session_<uuid>`) from a Kimi `wire.jsonl` path. */
export function kimiSessionIdFromPath(filePath: string): string {
  const match = filePath.match(/session_[0-9a-fA-F-]{36}/);
  return match?.[0] ?? "";
}

export { EMPTY_TOTALS };
