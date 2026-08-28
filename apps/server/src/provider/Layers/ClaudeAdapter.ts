/**
 * ClaudeAdapterLive - Scoped live implementation for the Claude Agent provider adapter.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
 * provider adapter contract and emits canonical runtime events.
 *
 * @module ClaudeAdapterLive
 */
import {
  type CanUseTool,
  query,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type SDKControlGetContextUsageResponse,
  type SDKResultMessage,
  type SettingSource,
  type SDKUserMessage,
  type ModelUsage,
} from "@anthropic-ai/claude-agent-sdk";
import { parseCliArgs } from "@t3tools/shared/cliArgs";
import {
  ApprovalRequestId,
  ENTITY_ID_MAX_LENGTH,
  type CanonicalItemType,
  type CanonicalRequestType,
  type ClaudeSettings,
  EventId,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  normalizeProviderSessionError,
  ProviderItemId,
  type ProviderRuntimeEvent,
  type ProviderRuntimeTurnStatus,
  PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH,
  PROVIDER_RUNTIME_MAX_PERSISTED_FILES,
  PROVIDER_RUNTIME_MAX_PLAN_STEPS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS,
  PROVIDER_RUNTIME_PATH_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_HEADER_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_MAX_TOTAL_CHARS,
  PROVIDER_RUNTIME_USER_INPUT_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH,
  type ProviderSendTurnInput,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderSession,
  type ThreadTokenUsageSnapshot,
  type ProviderUserInputAnswers,
  type RuntimeContentStreamKind,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  type RuntimeTaskStatus,
  type RuntimeTaskUsage,
  type TaskAgentLinkage,
  type TaskRunHandles,
  ThreadId,
  TurnId,
  type UserInputQuestion,
  CLAUDE_SUBAGENT_MODEL_ENV,
  type ResolvedSubagentPolicy,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { classifyImageToolItemType } from "@t3tools/shared/imageTool";
import { classifySkillLoadItemType, resolveSkillToolName } from "@t3tools/shared/skillTool";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { readFilePrefix } from "../../boundedFileRead.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { resolveClaudeSdkExecutablePath } from "../Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import {
  getClaudeModelCapabilities,
  isClaudeUltracodeEffort,
  normalizeClaudeCliEffort,
  resolveClaudeApiModelId,
  resolveClaudeContextWindow,
  resolveClaudeEffort,
} from "./ClaudeProvider.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const decodeUnknownJsonStringExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const PROVIDER = ProviderDriverKind.make("claudeAgent");
type ClaudeTextStreamKind = Extract<RuntimeContentStreamKind, "assistant_text" | "reasoning_text">;
type ClaudeToolResultStreamKind = Extract<
  RuntimeContentStreamKind,
  "command_output" | "file_change_output"
>;
type ClaudeSdkEffort = NonNullable<ClaudeQueryOptions["effort"]>;
const CLAUDE_DIAGNOSTIC_FIELD_LIMIT = 8;
const CLAUDE_DIAGNOSTIC_KEY_MAX_CHARS = 64;
const CLAUDE_TOOL_DETAIL_MAX_CHARS = 400;
const CLAUDE_TOOL_NAME_MAX_CHARS = 96;
const CLAUDE_RUNTIME_EVENT_QUEUE_CAPACITY = 512;
const CLAUDE_PROMPT_QUEUE_CAPACITY = 32;
const CLAUDE_PLAN_STEP_MAX_CHARS = 4 * 1024;
const CLAUDE_WORKFLOW_TEXT_MAX_CHARS = 4 * 1024;
const CLAUDE_WORKFLOW_PROGRESS_SCAN_CAP = 1024;
const CLAUDE_TASK_STATE_CAPACITY = 1024;
const CLAUDE_WORKFLOW_FINGERPRINT_CAPACITY = 4096;
const CLAUDE_RESULT_ERROR_SCAN_CAPACITY = 256;

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

function boundedClaudeDiagnosticText(value: string, maximumChars: number): string {
  const prefix = value.slice(0, maximumChars + 1).trim();
  return prefix.length > maximumChars ? `${prefix.slice(0, maximumChars - 1)}…` : prefix;
}

function previewClaudeDiagnosticValue(value: unknown, maximumChars: number): string | undefined {
  if (typeof value === "string") {
    return boundedClaudeDiagnosticText(value, maximumChars) || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  if (typeof value === "object") {
    return "{object}";
  }
  return undefined;
}

function previewClaudeDiagnosticRecord(
  input: Record<string, unknown>,
  maximumChars: number,
  ignoredKeys?: ReadonlySet<string>,
): string | undefined {
  const parts: Array<string> = [];
  let inspectedFields = 0;
  let retainedChars = 0;

  try {
    for (const key in input) {
      if (!Object.prototype.hasOwnProperty.call(input, key) || ignoredKeys?.has(key)) continue;
      inspectedFields += 1;
      if (inspectedFields > CLAUDE_DIAGNOSTIC_FIELD_LIMIT) break;

      const boundedKey = boundedClaudeDiagnosticText(key, CLAUDE_DIAGNOSTIC_KEY_MAX_CHARS);
      const remaining = maximumChars - retainedChars - boundedKey.length - 2;
      if (remaining <= 0) break;
      const value = previewClaudeDiagnosticValue(input[key], remaining);
      if (!value) continue;
      const part = `${boundedKey}: ${value}`;
      parts.push(part);
      retainedChars += part.length + (parts.length > 1 ? 3 : 0);
      if (retainedChars >= maximumChars) break;
    }
  } catch {
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }

  const preview = parts.join(" · ");
  return preview.length > maximumChars ? preview.slice(0, maximumChars) : preview || undefined;
}

type PromptQueueItem =
  | {
      readonly type: "message";
      readonly message: SDKUserMessage;
    }
  | {
      readonly type: "terminate";
    };

interface ClaudeResumeState {
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
}

interface ClaudeTurnState {
  readonly turnId: TurnId;
  readonly startedAt: string;
  /**
   * True for turns auto-started by assistant output arriving without an
   * active turn (background agent/subagent responses between user prompts).
   * Synthetic turns are auto-closed by the next sendTurn; real turns are
   * steered instead (the queued message continues the same turn).
   */
  readonly synthetic?: boolean;
  readonly items: Array<unknown>;
  readonly assistantTextBlocks: Map<number, AssistantTextBlockState>;
  readonly assistantTextBlockOrder: Array<AssistantTextBlockState>;
  readonly capturedProposedPlanKeys: Set<string>;
  nextSyntheticAssistantBlockIndex: number;
}

interface AssistantTextBlockState {
  readonly itemId: string;
  readonly blockIndex: number;
  emittedTextDelta: boolean;
  fallbackText: string;
  streamClosed: boolean;
  completionEmitted: boolean;
}

interface PendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

/**
 * Permission updates applied for an "Always allow this session" decision.
 *
 * Claude Code's suggestions are reused when present but rescoped to
 * `destination: "session"` — echoing them verbatim would persist the
 * session-only choice as a permanent rule (suggestions typically target
 * `localSettings`, i.e. `.claude/settings.local.json`). When Claude Code
 * offers no suggestion — common for MCP tools — fall back to a whole-tool
 * session allow rule so the decision still sticks for the session instead of
 * silently degrading into a one-shot accept.
 */
function toSessionPermissionUpdates(
  toolName: string,
  suggestions: ReadonlyArray<PermissionUpdate> | undefined,
): Array<PermissionUpdate> {
  const sessionScoped = (suggestions ?? []).map(
    (suggestion): PermissionUpdate => ({ ...suggestion, destination: "session" }),
  );
  if (sessionScoped.length > 0) {
    return sessionScoped;
  }
  return [
    {
      type: "addRules",
      rules: [{ toolName }],
      behavior: "allow",
      destination: "session",
    },
  ];
}

interface PendingUserInput {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
  /** Unparks the waiting handler as cancelled. Session teardown must run it. */
  readonly cancel: Effect.Effect<void>;
}

export interface NormalizedClaudeUserInputRequest {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly providerQuestionById: ReadonlyMap<string, string>;
}

function boundedClaudeUserInputText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string" || value.length > maximumLength) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Preserves Claude's question-text answer keys while exposing bounded ids to
 * clients. Normal questions retain their historical text id; only a question
 * that cannot itself be a canonical id receives a deterministic index id.
 */
export function normalizeClaudeUserInputRequest(
  value: unknown,
): NormalizedClaudeUserInputRequest | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS
  ) {
    return undefined;
  }

  const questions: Array<UserInputQuestion> = [];
  const providerQuestionById = new Map<string, string>();
  const providerQuestions = new Set<string>();
  let totalChars = 0;

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const question = raw as Record<string, unknown>;
    const providerQuestion =
      typeof question.question === "string" &&
      question.question.length <= PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH
        ? question.question
        : undefined;
    const displayQuestion = providerQuestion?.trim();
    if (!providerQuestion || !displayQuestion || providerQuestions.has(providerQuestion)) {
      return undefined;
    }

    const header = boundedClaudeUserInputText(
      question.header,
      PROVIDER_RUNTIME_USER_INPUT_HEADER_MAX_LENGTH,
    );
    if (!header) {
      return undefined;
    }

    const rawOptions = question.options === undefined ? [] : question.options;
    if (!Array.isArray(rawOptions) || rawOptions.length > PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS) {
      return undefined;
    }
    const options: Array<UserInputQuestion["options"][number]> = [];
    for (const rawOption of rawOptions) {
      if (!rawOption || typeof rawOption !== "object") {
        return undefined;
      }
      const option = rawOption as Record<string, unknown>;
      const label = boundedClaudeUserInputText(
        option.label,
        PROVIDER_RUNTIME_USER_INPUT_OPTION_LABEL_MAX_LENGTH,
      );
      const description = boundedClaudeUserInputText(
        option.description,
        PROVIDER_RUNTIME_USER_INPUT_OPTION_DESCRIPTION_MAX_LENGTH,
      );
      if (!label || !description) {
        return undefined;
      }
      totalChars += label.length + description.length;
      if (totalChars > PROVIDER_RUNTIME_USER_INPUT_MAX_TOTAL_CHARS) {
        return undefined;
      }
      options.push({ label, description });
    }

    const canUseQuestionAsId =
      providerQuestion === displayQuestion &&
      providerQuestion.length <= PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH &&
      !providerQuestionById.has(providerQuestion);
    let id = canUseQuestionAsId ? providerQuestion : `claude-question-${index}`;
    let collision = 1;
    while (providerQuestionById.has(id)) {
      id = `claude-question-${index}-${collision}`;
      collision += 1;
    }
    totalChars += id.length + header.length + displayQuestion.length;
    if (totalChars > PROVIDER_RUNTIME_USER_INPUT_MAX_TOTAL_CHARS) {
      return undefined;
    }

    providerQuestions.add(providerQuestion);
    providerQuestionById.set(id, providerQuestion);
    questions.push({
      id,
      header,
      question: displayQuestion,
      options,
      multiSelect: question.multiSelect === true,
    });
  }

  return { questions, providerQuestionById };
}

export function toClaudeSdkUserInputAnswers(
  answers: ProviderUserInputAnswers,
  providerQuestionById: ReadonlyMap<string, string>,
): ProviderUserInputAnswers {
  const providerAnswers: Array<readonly [string, ProviderUserInputAnswers[string]]> = [];
  for (const [id, providerQuestion] of providerQuestionById) {
    if (Object.prototype.hasOwnProperty.call(answers, id)) {
      providerAnswers.push([providerQuestion, answers[id]]);
    }
  }
  return Object.fromEntries(providerAnswers) as ProviderUserInputAnswers;
}

interface ToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  readonly input: Record<string, unknown>;
  readonly partialInputJson: string;
  readonly lastEmittedInputFingerprint?: string;
  /** Owning agent when this tool ran inside a subagent (see attribution note). */
  readonly agentId?: string;
  readonly parentToolUseId?: string;
}

interface ClaudeTaskState {
  readonly id: string;
  subject: string;
  status: PlanStep["status"];
  readonly blockedBy: Set<string>;
}

/**
 * Agent identity captured from task_started and repeated on every subsequent
 * task.* payload, so client folds can reconstruct an agent even when its
 * start row aged out of activity retention.
 */
interface ClaudeTaskAgentState {
  readonly taskId: string;
  toolUseId: string | undefined;
  description: string | undefined;
  subagentType: string | undefined;
  taskType: string | undefined;
  workflowName: string | undefined;
  skipTranscript: boolean;
  runHandles: TaskRunHandles | undefined;
  /** Set when this task was launched from inside a subagent. */
  owningAgentId: string | undefined;
  /** Seeded from the launching tool's input; refined by the subagent's own
   * assistant snapshots (authoritative API model). */
  model: string | undefined;
  effort: string | undefined;
}

/**
 * How many racing snapshot models to buffer per session. A snapshot whose
 * task_started never arrives would otherwise pin its entry for the session's
 * lifetime; oldest entries evict first.
 */
const PENDING_TASK_MODEL_CAP = 64;

/**
 * Buffers a subagent snapshot's authoritative model under its
 * parent_tool_use_id, for snapshots that beat their task_started to the
 * stream. task_started consumes the entry when it registers the task.
 */
function rememberPendingTaskModel(
  pending: Map<string, string>,
  parentToolUseId: string,
  model: string,
): void {
  pending.set(parentToolUseId, model);
  if (pending.size > PENDING_TASK_MODEL_CAP) {
    const oldest = pending.keys().next();
    if (!oldest.done) {
      pending.delete(oldest.value);
    }
  }
}

interface ClaudeSessionContext {
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  readonly startedAt: string;
  readonly basePermissionMode: PermissionMode | undefined;
  currentApiModelId: string | undefined;
  /** Effective effort for the session's turns; subagents without an explicit
   * effort override inherit this. */
  currentEffort: string | undefined;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  readonly claudeTasks: Map<string, ClaudeTaskState>;
  readonly taskAgents: Map<string, ClaudeTaskAgentState>;
  /**
   * Authoritative subagent models from assistant snapshots that arrived before
   * their task_started registered the task, keyed by parent_tool_use_id.
   * Written through `rememberPendingTaskModel`, consumed by task_started.
   */
  readonly pendingTaskModels: Map<string, string>;
  /**
   * Last emitted workflow-member fingerprint per member slot. A coordinator
   * task_progress repeats the FULL member array every tick; without a
   * material-transition filter one provider tick fans out into up to 100
   * runtime events (event-log writes, queue pressure, client reducer work)
   * even when nothing changed for most members.
   */
  readonly workflowMemberFingerprints: Map<string, string>;
  /** Task ids that have started and not yet reached a terminal state. */
  readonly liveTaskIds: Set<string>;
  turnState: ClaudeTurnState | undefined;
  lastKnownContextWindow: number | undefined;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  lastKnownTotalProcessedTokens: number | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;
  stopped: boolean;
}

interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly getContextUsage?: () => Promise<SDKControlGetContextUsageResponse>;
  readonly close: () => void;
}

export interface ClaudeAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeQueryRuntime;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

function hasDurableClaudeSessionId(message: SDKMessage): boolean {
  if (message.type !== "system") {
    return true;
  }

  return (
    message.subtype !== "hook_started" &&
    message.subtype !== "hook_progress" &&
    message.subtype !== "hook_response"
  );
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function normalizeClaudeStreamMessages(
  cause: Cause.Cause<ProviderAdapterProcessError>,
): ReadonlyArray<string> {
  const errors: Array<string> = [];
  for (const error of Cause.prettyErrors(cause)) {
    const message = error.message.trim();
    if (message.length > 0) {
      errors.push(message);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const squashed = toMessage(Cause.squash(cause), "").trim();
  return squashed.length > 0 ? [squashed] : [];
}

function getEffectiveClaudeAgentEffort(
  effort: string | null | undefined,
  model: string | null | undefined,
): ClaudeSdkEffort | null {
  const normalized = normalizeClaudeCliEffort(effort, model);
  return normalized ? (normalized as ClaudeSdkEffort) : null;
}

function isClaudeInterruptedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("all fibers interrupted without error") ||
    normalized.includes("request was aborted") ||
    normalized.includes("interrupted by user")
  );
}

function isClaudeInterruptedCause(cause: Cause.Cause<ProviderAdapterProcessError>): boolean {
  return (
    Cause.hasInterruptsOnly(cause) ||
    normalizeClaudeStreamMessages(cause).some(isClaudeInterruptedMessage) ||
    cause.reasons.some(
      (reason) =>
        Cause.isFailReason(reason) && isClaudeInterruptedMessage(toMessage(reason.error.cause, "")),
    )
  );
}

function resultErrorsText(result: SDKResultMessage): string {
  if (!("errors" in result) || !Array.isArray(result.errors)) {
    return "";
  }
  let normalized = "";
  for (const error of result.errors.slice(0, CLAUDE_RESULT_ERROR_SCAN_CAPACITY)) {
    if (typeof error !== "string" || normalized.length >= PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH) {
      continue;
    }
    const remaining = PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH - normalized.length;
    normalized += `${normalized.length > 0 ? " " : ""}${error.slice(0, remaining).toLowerCase()}`;
  }
  return normalized.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH);
}

/**
 * First user-facing error from a non-success result. "[ede_diagnostic] ..."
 * entries are CLI-internal telemetry (the CLI hides them from its own UI too),
 * so they must never become the error banner.
 */
function resultUserFacingError(result: SDKResultMessage): string | undefined {
  if (result.subtype === "success" || !Array.isArray(result.errors)) {
    return undefined;
  }
  for (const error of result.errors.slice(0, CLAUDE_RESULT_ERROR_SCAN_CAPACITY)) {
    if (typeof error !== "string" || error.startsWith("[ede_diagnostic]")) {
      continue;
    }
    return trimmedString(error, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH);
  }
  return undefined;
}

function isInterruptedResult(result: SDKResultMessage): boolean {
  // The CLI stamps user aborts explicitly: interrupting mid-tool-call yields
  // "aborted_tools" (with an internal "[ede_diagnostic] ..." error and
  // is_error: true), interrupting mid-stream yields "aborted_streaming".
  if (
    result.terminal_reason === "aborted_tools" ||
    result.terminal_reason === "aborted_streaming"
  ) {
    return true;
  }

  const errors = resultErrorsText(result);
  if (errors.includes("interrupt")) {
    return true;
  }

  return (
    result.subtype === "error_during_execution" &&
    result.is_error === false &&
    (errors.includes("request was aborted") ||
      errors.includes("interrupted by user") ||
      errors.includes("aborted"))
  );
}

function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.make(value);
}

function maxClaudeContextWindowFromModelUsage(
  modelUsage: Record<string, ModelUsage> | undefined,
): number | undefined {
  if (!modelUsage) return undefined;

  let maxContextWindow: number | undefined;
  for (const value of Object.values(modelUsage)) {
    const contextWindow = value.contextWindow;
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
  }

  return maxContextWindow;
}

function selectedClaudeContextWindow(
  modelSelection: ModelSelection | undefined,
): number | undefined {
  switch (modelSelection?.model) {
    case "claude-opus-4-8":
    case "claude-opus-4-7":
      // Always 1M at the API; these models expose no contextWindow option.
      return 1_000_000;
  }

  switch (resolveClaudeContextWindow(modelSelection)) {
    case "1m":
      return 1_000_000;
    case "200k":
      return 200_000;
    default:
      return undefined;
  }
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function claudeUsageInputTokens(usage: Record<string, unknown>): number {
  return (
    (finiteNonNegativeInteger(usage.input_tokens) ?? 0) +
    (finiteNonNegativeInteger(usage.cache_creation_input_tokens) ?? 0) +
    (finiteNonNegativeInteger(usage.cache_read_input_tokens) ?? 0)
  );
}

function claudeUsageOutputTokens(usage: Record<string, unknown>): number {
  return finiteNonNegativeInteger(usage.output_tokens) ?? 0;
}

function lastClaudeUsageIteration(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const iterations = Array.isArray(value.iterations) ? value.iterations : [];
  return iterations.findLast(
    (iteration): iteration is Record<string, unknown> =>
      iteration !== null && typeof iteration === "object" && !Array.isArray(iteration),
  );
}

function claudeTotalProcessedTokens(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const explicitTotal = finiteNonNegativeInteger(usage.total_tokens);
  if (explicitTotal !== undefined && explicitTotal > 0) {
    return explicitTotal;
  }

  const total = claudeUsageInputTokens(usage) + claudeUsageOutputTokens(usage);
  return total > 0 ? total : undefined;
}

function makeClaudeTokenUsageSnapshot(input: {
  readonly activeTokens: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly contextWindow?: number;
  readonly totalProcessedTokens?: number;
  readonly lastUsedTokens?: number;
  readonly compactsAutomatically?: boolean;
  readonly autoCompactThreshold?: number;
}): ThreadTokenUsageSnapshot | undefined {
  const activeTokens = finiteNonNegativeInteger(input.activeTokens);
  if (activeTokens === undefined || activeTokens <= 0) {
    return undefined;
  }

  const maxTokens = finitePositiveInteger(input.contextWindow);
  const usedTokens = maxTokens !== undefined ? Math.min(activeTokens, maxTokens) : activeTokens;
  const lastUsedTokens =
    finiteNonNegativeInteger(input.lastUsedTokens) ??
    (maxTokens !== undefined ? Math.min(activeTokens, maxTokens) : activeTokens);
  const totalProcessedTokens = finiteNonNegativeInteger(input.totalProcessedTokens);
  const inputTokens = finiteNonNegativeInteger(input.inputTokens);
  const outputTokens = finiteNonNegativeInteger(input.outputTokens);

  return {
    usedTokens,
    lastUsedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(inputTokens !== undefined && inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens !== undefined && outputTokens > 0 ? { outputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(input.compactsAutomatically !== undefined
      ? { compactsAutomatically: input.compactsAutomatically }
      : {}),
    ...(input.autoCompactThreshold !== undefined
      ? { autoCompactThreshold: input.autoCompactThreshold }
      : {}),
  };
}

function normalizeClaudeActiveTokenUsage(
  value: unknown,
  contextWindow?: number,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const activeUsage = lastClaudeUsageIteration(usage) ?? usage;
  const inputTokens = claudeUsageInputTokens(activeUsage);
  const outputTokens = claudeUsageOutputTokens(activeUsage);
  const activeTokens = claudeTotalProcessedTokens(activeUsage) ?? inputTokens + outputTokens;
  if (activeTokens <= 0) {
    return undefined;
  }

  return makeClaudeTokenUsageSnapshot({
    activeTokens,
    inputTokens,
    outputTokens,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
  });
}

function normalizeClaudeContextUsageApiSnapshot(
  value: SDKControlGetContextUsageResponse,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot | undefined {
  const autoCompactThreshold = finitePositiveInteger(value.autoCompactThreshold);
  return makeClaudeTokenUsageSnapshot({
    activeTokens: value.totalTokens,
    contextWindow: value.maxTokens,
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
    compactsAutomatically: value.isAutoCompactEnabled,
    ...(autoCompactThreshold !== undefined ? { autoCompactThreshold } : {}),
  });
}

function compactBoundaryTokenUsageSnapshot(
  message: Record<string, unknown>,
  contextWindow?: number,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot | undefined {
  const metadata = message.compact_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const compactMetadata = metadata as Record<string, unknown>;
  const postTokens = finiteNonNegativeInteger(compactMetadata.post_tokens);
  if (postTokens === undefined || postTokens <= 0) {
    return undefined;
  }

  const preTokens = finiteNonNegativeInteger(compactMetadata.pre_tokens);
  return makeClaudeTokenUsageSnapshot({
    activeTokens: postTokens,
    ...(preTokens !== undefined ? { lastUsedTokens: preTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
  });
}

function normalizeClaudeTaskProgressTokenUsage(
  value: unknown,
  context: ClaudeSessionContext,
): ThreadTokenUsageSnapshot | undefined {
  const totalTokens = claudeTotalProcessedTokens(value);
  if (totalTokens === undefined || totalTokens <= 0) {
    return undefined;
  }

  const lastUsedTokens = context.lastKnownTokenUsage?.usedTokens;
  const activeTokens =
    lastUsedTokens !== undefined ? Math.max(totalTokens, lastUsedTokens) : totalTokens;
  if (lastUsedTokens !== undefined && activeTokens === lastUsedTokens) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const snapshot = makeClaudeTokenUsageSnapshot({
    activeTokens,
    ...(context.lastKnownContextWindow !== undefined
      ? { contextWindow: context.lastKnownContextWindow }
      : {}),
    totalProcessedTokens: Math.max(
      totalTokens,
      context.lastKnownTotalProcessedTokens ?? totalTokens,
    ),
  });
  if (!snapshot) {
    return undefined;
  }

  const toolUses = finiteNonNegativeInteger(usage.tool_uses);
  const durationMs = finiteNonNegativeInteger(usage.duration_ms);
  return {
    ...snapshot,
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function asCanonicalTurnId(value: TurnId): TurnId {
  return value;
}

function asRuntimeRequestId(value: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.make(value);
}

function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
  };

  const threadIdCandidate = boundedClaudeEntityId(cursor.threadId);
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.make(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt = boundedClaudeEntityId(cursor.resumeSessionAt);
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;

  return {
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnCountValue !== undefined && Number.isSafeInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
  };
}

function classifyToolItemType(toolName: string): CanonicalItemType {
  const skillItemType = classifySkillLoadItemType({ toolName });
  if (skillItemType) {
    return skillItemType;
  }
  const imageGenerationType = classifyImageToolItemType({ toolName });
  if (imageGenerationType === "image_generation") {
    return imageGenerationType;
  }
  const normalized = toolName.toLowerCase();
  if (normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (
    normalized === "task" ||
    normalized === "agent" ||
    normalized.includes("subagent") ||
    normalized.includes("sub-agent")
  ) {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("file") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("websearch") || normalized.includes("web search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}

function isReadOnlyToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "read" ||
    normalized === "skill" ||
    normalized.includes("read file") ||
    normalized.includes("view") ||
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search")
  );
}

function classifyRequestType(toolName: string): CanonicalRequestType {
  if (isReadOnlyToolName(toolName)) {
    return "file_read_approval";
  }
  const itemType = classifyToolItemType(toolName);
  return itemType === "command_execution"
    ? "command_execution_approval"
    : itemType === "file_change"
      ? "file_change_approval"
      : "dynamic_tool_call";
}

function isTodoTool(toolName: string): boolean {
  return toolName.toLowerCase().includes("todowrite");
}

type PlanStep = {
  step: string;
  status: "pending" | "inProgress" | "completed";
};

function extractPlanStepsFromTodoInput(input: Record<string, unknown>): PlanStep[] | null {
  // TodoWrite format: { todos: [{ content, status, activeForm? }] }
  const todos = input.todos;
  if (!Array.isArray(todos) || todos.length === 0) {
    return null;
  }
  return todos
    .slice(0, PROVIDER_RUNTIME_MAX_PLAN_STEPS)
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .map((todo) => ({
      step:
        typeof todo.content === "string" && todo.content.trim().length > 0
          ? (trimmedString(todo.content, CLAUDE_PLAN_STEP_MAX_CHARS) ?? "Task")
          : "Task",
      status:
        todo.status === "completed"
          ? "completed"
          : todo.status === "in_progress"
            ? "inProgress"
            : "pending",
    }));
}

function isClaudeTaskTool(toolName: string): boolean {
  return toolName === "TaskCreate" || toolName === "TaskUpdate" || toolName === "TaskList";
}

function mergeClaudeSubagentPolicyEnv(
  environment: NodeJS.ProcessEnv,
  policy: ResolvedSubagentPolicy | undefined,
): NodeJS.ProcessEnv {
  const existing = environment[CLAUDE_SUBAGENT_MODEL_ENV];
  if (typeof existing === "string" && existing.trim().length > 0) {
    return environment;
  }
  if (!policy?.enabled || policy.child == null || policy.child.model.length === 0) {
    return environment;
  }
  return {
    ...environment,
    [CLAUDE_SUBAGENT_MODEL_ENV]: policy.child.model,
  };
}

function normalizeClaudeTaskStatus(value: unknown): PlanStep["status"] {
  return value === "completed" ? "completed" : value === "in_progress" ? "inProgress" : "pending";
}

function readStringArray(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.slice(0, PROVIDER_RUNTIME_MAX_PLAN_STEPS).flatMap((entry) => {
        const bounded = trimmedString(entry, ENTITY_ID_MAX_LENGTH);
        return bounded ? [bounded] : [];
      })
    : [];
}

function readClaudeToolUseResult(message: SDKMessage): Record<string, unknown> | undefined {
  if (message.type !== "user") {
    return undefined;
  }
  const result = (message as { readonly tool_use_result?: unknown }).tool_use_result;
  return result !== null && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : undefined;
}

function readClaudeTaskFromResult(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const task = result?.task;
  return task !== null && typeof task === "object" && !Array.isArray(task)
    ? (task as Record<string, unknown>)
    : undefined;
}

function applyClaudeTaskToolResult(
  tasks: Map<string, ClaudeTaskState>,
  tool: ToolInFlight,
  result: Record<string, unknown> | undefined,
): boolean {
  if (!isClaudeTaskTool(tool.toolName)) {
    return false;
  }

  let changed = false;
  if (tool.toolName === "TaskList") {
    const resultTasks = result?.tasks;
    if (!Array.isArray(resultTasks)) {
      return false;
    }
    tasks.clear();
    for (const entry of resultTasks.slice(0, PROVIDER_RUNTIME_MAX_PLAN_STEPS)) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const task = entry as Record<string, unknown>;
      const id = trimmedString(task.id, ENTITY_ID_MAX_LENGTH);
      const subject = trimmedString(task.subject, CLAUDE_PLAN_STEP_MAX_CHARS);
      if (!id || !subject) {
        continue;
      }
      tasks.set(id, {
        id,
        subject,
        status: normalizeClaudeTaskStatus(task.status),
        blockedBy: new Set(readStringArray(task.blockedBy)),
      });
    }
    return tasks.size > 0;
  }

  if (tool.toolName === "TaskCreate") {
    const resultTask = readClaudeTaskFromResult(result);
    const id = trimmedString(resultTask?.id, ENTITY_ID_MAX_LENGTH);
    const subject =
      trimmedString(resultTask?.subject, CLAUDE_PLAN_STEP_MAX_CHARS) ??
      trimmedString(tool.input.subject, CLAUDE_PLAN_STEP_MAX_CHARS);
    if (!id || !subject) {
      return false;
    }
    if (!tasks.has(id) && tasks.size >= PROVIDER_RUNTIME_MAX_PLAN_STEPS) {
      return false;
    }
    tasks.set(id, {
      id,
      subject,
      status: normalizeClaudeTaskStatus(tool.input.status),
      blockedBy: new Set(readStringArray(tool.input.blockedBy)),
    });
    return true;
  }

  const taskId =
    trimmedString(tool.input.taskId, ENTITY_ID_MAX_LENGTH) ??
    trimmedString(result?.taskId, ENTITY_ID_MAX_LENGTH);
  if (!taskId) {
    return false;
  }
  const task = tasks.get(taskId);
  if (!task) {
    return false;
  }
  const subject = trimmedString(tool.input.subject, CLAUDE_PLAN_STEP_MAX_CHARS);
  if (subject && task.subject !== subject) {
    task.subject = subject;
    changed = true;
  }
  if (typeof tool.input.status === "string") {
    const status = normalizeClaudeTaskStatus(tool.input.status);
    if (task.status !== status) {
      task.status = status;
      changed = true;
    }
  }
  for (const dependency of readStringArray(tool.input.addBlockedBy)) {
    if (!task.blockedBy.has(dependency)) {
      task.blockedBy.add(dependency);
      changed = true;
    }
  }
  for (const dependency of readStringArray(tool.input.removeBlockedBy)) {
    if (task.blockedBy.delete(dependency)) {
      changed = true;
    }
  }
  return changed;
}

function planStepsFromClaudeTasks(tasks: Map<string, ClaudeTaskState>): PlanStep[] {
  return Array.from(tasks.values()).map((task) => {
    const blockedBy = Array.from(task.blockedBy);
    const blockedSuffix = blockedBy.length > 0 ? ` (blocked by #${blockedBy.join(", #")})` : "";
    return {
      step: `${task.subject}${blockedSuffix}`,
      status: task.status,
    };
  });
}

/** Only http/https survive; anything else (javascript:, file:, …) is dropped. */
function sanitizeSessionUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
}

function trimmedString(
  value: unknown,
  maximumChars = PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.slice(0, maximumChars + 1).trim();
  if (trimmed.length > maximumChars) {
    return trimmed.slice(0, maximumChars).trim();
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function boundedClaudeEntityId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > ENTITY_ID_MAX_LENGTH) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed === value ? value : undefined;
}

/**
 * SDK task usage ({total_tokens, tool_uses, duration_ms}, sometimes with
 * input/output/cache breakdowns) → the typed contract shape. Unknown or
 * malformed input yields undefined rather than a partial guess.
 */
function normalizeTaskUsage(usage: unknown): RuntimeTaskUsage | undefined {
  if (typeof usage !== "object" || usage === null) {
    return undefined;
  }
  const record = usage as Record<string, unknown>;
  const totalTokens = nonNegativeInt(record.total_tokens);
  if (totalTokens === undefined) {
    return undefined;
  }
  const inputTokens = nonNegativeInt(record.input_tokens);
  const cachedInputTokens = nonNegativeInt(record.cache_read_input_tokens);
  const outputTokens = nonNegativeInt(record.output_tokens);
  const toolUses = nonNegativeInt(record.tool_uses);
  const durationMs = nonNegativeInt(record.duration_ms);
  return {
    totalTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/** SDK task_updated patch status → the shared wire vocabulary. */
const CLAUDE_TASK_PATCH_STATUS: Record<string, RuntimeTaskStatus> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
  killed: "cancelled",
  paused: "idle",
};

/**
 * Resolves a stream message's parent_tool_use_id to the owning agent's
 * taskId. The Task tool's tool_use_id is remembered on task_started; any
 * subagent-forwarded block carries that id as its parent. Returns undefined
 * for parent-conversation traffic.
 */
function agentIdForParentToolUse(
  agents: Map<string, ClaudeTaskAgentState>,
  parentToolUseId: string | null | undefined,
): string | undefined {
  if (parentToolUseId === null || parentToolUseId === undefined) {
    return undefined;
  }
  for (const agent of agents.values()) {
    if (agent.toolUseId === parentToolUseId) {
      return agent.taskId;
    }
  }
  return undefined;
}

/**
 * Linkage bundle repeated on every task.* payload for `taskId`. Reads the
 * remembered identity (from task_started) so progress/terminal rows are
 * self-describing even when the start row ages out of activity retention.
 */
function taskLinkageFor(
  agents: Map<string, ClaudeTaskAgentState>,
  taskId: string,
): TaskAgentLinkage {
  const agent = agents.get(taskId);
  if (!agent) {
    return {};
  }
  return {
    ...(agent.taskType ? { taskType: agent.taskType } : {}),
    ...(agent.owningAgentId ? { agentId: agent.owningAgentId } : {}),
    ...(agent.description ? { title: agent.description } : {}),
    ...(agent.subagentType ? { role: agent.subagentType } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.effort ? { effort: agent.effort } : {}),
    ...(agent.toolUseId ? { toolUseId: agent.toolUseId } : {}),
    ...(agent.workflowName ? { workflowName: agent.workflowName } : {}),
    ...(agent.runHandles ? { runHandles: agent.runHandles } : {}),
  };
}

function forgetClaudeTaskRuntimeState(context: ClaudeSessionContext, taskId: string): void {
  context.taskAgents.delete(taskId);
  const memberPrefix = `${taskId}:wf:`;
  for (const memberTaskId of context.workflowMemberFingerprints.keys()) {
    if (memberTaskId.startsWith(memberPrefix)) {
      context.workflowMemberFingerprints.delete(memberTaskId);
    }
  }
}

function boundedClaudeTaskId(value: string): string {
  return value.slice(0, ENTITY_ID_MAX_LENGTH);
}

const WORKFLOW_PHASE_CAP = 64;
const WORKFLOW_AGENT_CAP = 100;

interface ClaudeWorkflowAgentEntry {
  readonly index: number;
  readonly state: string;
  readonly label: string | undefined;
  readonly phaseIndex: number | undefined;
  readonly phaseTitle: string | undefined;
  readonly model: string | undefined;
  readonly attempt: number | undefined;
  readonly lastToolName: string | undefined;
  readonly startedAt: string | undefined;
  readonly error: string | undefined;
  readonly tokens: number | undefined;
  readonly toolCalls: number | undefined;
}

interface ClaudeWorkflowProgress {
  readonly phases: ReadonlyArray<{ index: number; title: string }>;
  readonly agents: ReadonlyArray<ClaudeWorkflowAgentEntry>;
}

/**
 * Defensive parse of the SDK's undeclared-but-real workflow_progress array on
 * task_progress messages (wire-confirmed; absent from sdk.d.ts). Unknown
 * shapes are skipped per-entry; phases and agents dedupe by index before
 * caps; a vanished field never throws. If the array disappears upstream the
 * caller keeps the coordinator row and plain task lifecycle.
 */
function parseWorkflowProgress(value: unknown): ClaudeWorkflowProgress | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const phasesByIndex = new Map<number, string>();
  const agentsByIndex = new Map<number, ClaudeWorkflowAgentEntry>();
  for (const entry of value.slice(0, CLAUDE_WORKFLOW_PROGRESS_SCAN_CAP)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const entryType = trimmedString(record.type);
    if (entryType === "workflow_phase") {
      const index = nonNegativeInt(record.index);
      const title = trimmedString(record.title, CLAUDE_WORKFLOW_TEXT_MAX_CHARS);
      if (
        index !== undefined &&
        title &&
        !phasesByIndex.has(index) &&
        phasesByIndex.size < WORKFLOW_PHASE_CAP
      ) {
        phasesByIndex.set(index, title);
      }
      continue;
    }
    if (entryType !== "workflow_agent") {
      continue;
    }
    const index = nonNegativeInt(record.index);
    const state = trimmedString(record.state, CLAUDE_WORKFLOW_TEXT_MAX_CHARS);
    if (
      index === undefined ||
      !state ||
      agentsByIndex.has(index) ||
      agentsByIndex.size >= WORKFLOW_AGENT_CAP
    ) {
      continue;
    }
    agentsByIndex.set(index, {
      index,
      state,
      label: trimmedString(record.label, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      phaseIndex: nonNegativeInt(record.phaseIndex),
      phaseTitle: trimmedString(record.phaseTitle, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      model: trimmedString(record.model, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      attempt: nonNegativeInt(record.attempt),
      lastToolName: trimmedString(record.lastToolName, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      startedAt: trimmedString(record.startedAt, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      error: trimmedString(record.error, CLAUDE_WORKFLOW_TEXT_MAX_CHARS),
      tokens: nonNegativeInt(record.tokens),
      toolCalls: nonNegativeInt(record.toolCalls),
    });
  }
  if (phasesByIndex.size === 0 && agentsByIndex.size === 0) {
    return undefined;
  }
  const phases = Array.from(phasesByIndex.entries())
    .map(([index, title]) => ({ index, title }))
    .toSorted((a, b) => a.index - b.index)
    .slice(0, WORKFLOW_PHASE_CAP);
  const agents = Array.from(agentsByIndex.values())
    .toSorted((a, b) => a.index - b.index)
    .slice(0, WORKFLOW_AGENT_CAP);
  return { phases, agents };
}

/**
 * Workflow member states from workflow_progress → shared task status.
 * Unknown states read running after startedAt, pending before it.
 */
function workflowAgentStatus(entry: ClaudeWorkflowAgentEntry): RuntimeTaskStatus {
  switch (entry.state) {
    case "queued":
    case "pending":
      return "pending";
    case "start":
    case "running":
      return entry.startedAt === undefined ? "pending" : "running";
    case "done":
      return "completed";
    case "error":
      return "failed";
    default:
      return entry.startedAt === undefined ? "pending" : "running";
  }
}

export function summarizeClaudeToolRequestForDiagnostics(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const boundedToolName =
    boundedClaudeDiagnosticText(toolName, CLAUDE_TOOL_NAME_MAX_CHARS) || "Tool";
  const withToolName = (detail: string) =>
    boundedClaudeDiagnosticText(`${boundedToolName}: ${detail}`, CLAUDE_TOOL_DETAIL_MAX_CHARS);
  const commandValue = input.command ?? input.cmd;
  const command = typeof commandValue === "string" ? commandValue : undefined;
  if (command) {
    const preview = boundedClaudeDiagnosticText(command, CLAUDE_TOOL_DETAIL_MAX_CHARS);
    if (preview) return withToolName(preview);
  }

  const itemType = classifyToolItemType(toolName);
  if (itemType === "skill_load") {
    const skillName = resolveSkillToolName({ toolInput: input, title: toolName });
    return boundedClaudeDiagnosticText(skillName ?? boundedToolName, CLAUDE_TOOL_DETAIL_MAX_CHARS);
  }

  // For agent/subagent tools, prefer the human-readable description or prompt
  // over raw JSON. The structured subagent_type is carried separately on the
  // task.* payloads (role) — the label is display-only.
  if (itemType === "collab_agent_tool_call") {
    const description =
      typeof input.description === "string"
        ? boundedClaudeDiagnosticText(input.description, CLAUDE_TOOL_DETAIL_MAX_CHARS)
        : undefined;
    const prompt =
      typeof input.prompt === "string" ? boundedClaudeDiagnosticText(input.prompt, 200) : undefined;
    const label = description || prompt;
    if (label) {
      return label;
    }
  }

  // This is presentation-only. Never stringify an arbitrary SDK tool payload
  // just to retain a short label: doing so allocates the complete value before
  // the previous 400-character truncation and can invoke user-defined toJSON.
  const preview = previewClaudeDiagnosticRecord(input, CLAUDE_TOOL_DETAIL_MAX_CHARS);
  return preview ? withToolName(preview) : boundedToolName;
}

function titleForTool(itemType: CanonicalItemType): string {
  switch (itemType) {
    case "command_execution":
      return "Command run";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "image_generation":
      return "Generated image";
    case "skill_load":
      return "Skill";
    case "dynamic_tool_call":
      return "Tool call";
    default:
      return "Item";
  }
}

const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CLAUDE_SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

function buildPromptText(
  input: ProviderSendTurnInput,
  boundInstanceId: ProviderInstanceId,
): string {
  const rawEffort =
    input.modelSelection?.instanceId === boundInstanceId
      ? getModelSelectionStringOptionValue(input.modelSelection, "effort")
      : null;
  const claudeModel =
    input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection.model : undefined;
  const caps = getClaudeModelCapabilities(claudeModel);

  const promptEffort = resolvePromptInjectedEffort(caps, rawEffort);
  return applyClaudePromptEffortPrefix(input.input?.trim() ?? "", promptEffort);
}

function buildUserMessage(input: {
  readonly sdkContent: Array<Record<string, unknown>>;
}): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: input.sdkContent as unknown as SDKUserMessage["message"]["content"],
    },
  } as SDKUserMessage;
}

function buildClaudeImageContentBlock(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    },
  };
}

const buildUserMessageEffect = Effect.fn("buildUserMessageEffect")(function* (
  input: ProviderSendTurnInput,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly attachmentsDir: string;
    readonly boundInstanceId: ProviderInstanceId;
  },
) {
  const text = buildPromptText(input, dependencies.boundInstanceId);
  const sdkContent: Array<Record<string, unknown>> = [];

  if (text.length > 0) {
    sdkContent.push({ type: "text", text });
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "image") {
      continue;
    }

    if (!SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Unsupported Claude image attachment type '${attachment.mimeType}'.`,
      });
    }

    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: dependencies.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Invalid attachment id '${attachment.id}'.`,
      });
    }

    const bytes = yield* readFilePrefix(
      dependencies.fileSystem,
      attachmentPath,
      PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: "Failed to read attachment file.",
            cause,
          }),
      ),
    );
    if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: "Attachment file exceeds the 10 MiB image limit.",
      });
    }

    sdkContent.push(
      buildClaudeImageContentBlock({
        mimeType: attachment.mimeType,
        bytes,
      }),
    );
  }

  return buildUserMessage({ sdkContent });
});

function turnStatusFromResult(result: SDKResultMessage): ProviderRuntimeTurnStatus {
  if (result.subtype === "success") {
    return "completed";
  }

  const errors = resultErrorsText(result);
  if (isInterruptedResult(result)) {
    return "interrupted";
  }
  if (errors.includes("cancel")) {
    return "cancelled";
  }
  return "failed";
}

function streamKindFromDeltaType(deltaType: string): ClaudeTextStreamKind {
  return deltaType.includes("thinking") ? "reasoning_text" : "assistant_text";
}

function nativeProviderRefs(
  _context: ClaudeSessionContext,
  options?: {
    readonly providerItemId?: string | undefined;
  },
): NonNullable<ProviderRuntimeEvent["providerRefs"]> {
  if (options?.providerItemId) {
    return {
      providerItemId: ProviderItemId.make(options.providerItemId),
    };
  }
  return {};
}

function extractAssistantTextBlocks(message: SDKMessage): Array<string> {
  if (message.type !== "assistant") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const fragments: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown };
    if (
      candidate.type === "text" &&
      typeof candidate.text === "string" &&
      candidate.text.length > 0
    ) {
      fragments.push(candidate.text);
    }
  }

  return fragments;
}

function extractContentBlockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }

  const candidate = block as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractTextContent(entry)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof record.text === "string") {
    return record.text;
  }

  return extractTextContent(record.content);
}

function extractExitPlanModePlan(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as {
    plan?: unknown;
  };
  return typeof record.plan === "string" && record.plan.trim().length > 0
    ? record.plan.trim()
    : undefined;
}

function exitPlanCaptureKey(input: {
  readonly toolUseId?: string | undefined;
  readonly planMarkdown: string;
}): string {
  return input.toolUseId && input.toolUseId.length > 0
    ? `tool:${input.toolUseId}`
    : `plan:${input.planMarkdown}`;
}

function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  const result = decodeUnknownJsonStringExit(value);
  if (!Exit.isSuccess(result)) {
    return undefined;
  }
  const parsed = result.value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function toolInputFingerprint(input: Record<string, unknown>): string | undefined {
  return encodeJsonStringForDiagnostics(input);
}

function toolResultStreamKind(itemType: CanonicalItemType): ClaudeToolResultStreamKind | undefined {
  switch (itemType) {
    case "command_execution":
      return "command_output";
    case "file_change":
      return "file_change_output";
    default:
      return undefined;
  }
}

function toolResultBlocksFromUserMessage(message: SDKMessage): Array<{
  readonly toolUseId: string;
  readonly block: Record<string, unknown>;
  readonly text: string;
  readonly isError: boolean;
}> {
  if (message.type !== "user") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: Array<{
    readonly toolUseId: string;
    readonly block: Record<string, unknown>;
    readonly text: string;
    readonly isError: boolean;
  }> = [];

  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const block = entry as Record<string, unknown>;
    if (block.type !== "tool_result") {
      continue;
    }

    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
    if (!toolUseId) {
      continue;
    }

    blocks.push({
      toolUseId,
      block,
      text: extractTextContent(block.content),
      isError: block.is_error === true,
    });
  }

  return blocks;
}

function toSessionError(
  threadId: ThreadId,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();
  if (normalized.includes("unknown session") || normalized.includes("not found")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  if (normalized.includes("closed")) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

function toRequestError(threadId: ThreadId, method: string, cause: unknown): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `${method} failed`,
    cause,
  });
}

function sdkMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { type?: unknown };
  return typeof record.type === "string" ? record.type : undefined;
}

function sdkMessageSubtype(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { subtype?: unknown };
  return typeof record.subtype === "string" ? record.subtype : undefined;
}

function sdkNativeMethod(message: SDKMessage): string {
  const subtype = sdkMessageSubtype(message);
  if (subtype) {
    return `claude/${message.type}/${subtype}`;
  }

  if (message.type === "stream_event") {
    const streamType = sdkMessageType(message.event);
    if (streamType) {
      const deltaType =
        streamType === "content_block_delta"
          ? sdkMessageType((message.event as { delta?: unknown }).delta)
          : undefined;
      if (deltaType) {
        return `claude/${message.type}/${streamType}/${deltaType}`;
      }
      return `claude/${message.type}/${streamType}`;
    }
  }

  return `claude/${message.type}`;
}

// Discriminator/identity keys carry no human-readable content; everything else
// on an unmodeled SDK message is potentially worth surfacing in the work log.
const SDK_MESSAGE_NOISE_KEYS = new Set([
  "type",
  "subtype",
  "uuid",
  "parent_uuid",
  "session_id",
  "parent_tool_use_id",
  "request_id",
]);

// Pull the salient scalar content out of a message the adapter doesn't model
// yet, so the work-log row shows what actually arrived (e.g. a notification's
// text) instead of an opaque "unhandled subtype" placeholder. Nested structures
// are left to the full payload retained in the event's `detail`.
function previewUnknownSdkContent(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return previewClaudeDiagnosticRecord(
    message as Record<string, unknown>,
    280,
    SDK_MESSAGE_NOISE_KEYS,
  );
}

function describeUnknownSdkMessage(kind: string, message: unknown): string {
  const preview = previewUnknownSdkContent(message);
  return preview ? `${kind} — ${preview}` : `${kind} (no displayable text content)`;
}

function sdkNativeItemId(message: SDKMessage): string | undefined {
  if (message.type === "assistant") {
    const maybeId = (message.message as { id?: unknown }).id;
    return boundedClaudeEntityId(maybeId);
  }

  if (message.type === "user") {
    return boundedClaudeEntityId(toolResultBlocksFromUserMessage(message)[0]?.toolUseId);
  }

  if (message.type === "stream_event") {
    const event = message.event as {
      type?: unknown;
      content_block?: { id?: unknown };
    };
    if (event.type === "content_block_start" && typeof event.content_block?.id === "string") {
      return boundedClaudeEntityId(event.content_block.id);
    }
  }

  return undefined;
}

export const makeClaudeAdapter = Effect.fn("makeClaudeAdapter")(function* (
  claudeSettings: ClaudeSettings,
  options?: ClaudeAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("claudeAgent");
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, options?.environment).pipe(
    Effect.provideService(Path.Path, path),
  );
  const claudeSdkExecutablePath = yield* resolveClaudeSdkExecutablePath(
    claudeSettings.binaryPath,
    claudeEnvironment,
  );
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

  const createQuery =
    options?.createQuery ??
    ((input: {
      readonly prompt: AsyncIterable<SDKUserMessage>;
      readonly options: ClaudeQueryOptions;
    }) =>
      query({
        prompt: input.prompt,
        options: input.options,
      }) as ClaudeQueryRuntime);

  const sessions = new Map<ThreadId, ClaudeSessionContext>();
  const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
    CLAUDE_RUNTIME_EVENT_QUEUE_CAPACITY,
  );

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate Claude runtime identifier.",
          cause,
        }),
    ),
  );
  const nextEventId = Effect.map(randomUUIDv4, (id) => EventId.make(id));
  const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

  const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

  const logNativeSdkMessage = Effect.fnUntraced(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (!nativeEventLogger) {
      return;
    }

    const observedAt = yield* nowIso;
    const itemId = sdkNativeItemId(message);
    const messageId = "uuid" in message ? boundedClaudeEntityId(message.uuid) : undefined;
    const providerThreadId = boundedClaudeEntityId(message.session_id);

    yield* nativeEventLogger.write(
      {
        observedAt,
        event: {
          id: messageId ?? (yield* randomUUIDv4),
          kind: "notification",
          provider: PROVIDER,
          createdAt: observedAt,
          method: sdkNativeMethod(message),
          ...(providerThreadId ? { providerThreadId } : {}),
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          ...(itemId ? { itemId: ProviderItemId.make(itemId) } : {}),
          payload: message,
        },
      },
      context.session.threadId,
    );
  });

  const snapshotThread = Effect.fn("snapshotThread")(function* (context: ClaudeSessionContext) {
    const threadId = context.session.threadId;
    if (!threadId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "readThread",
        issue: "Session thread id is not initialized yet.",
      });
    }
    return {
      threadId,
      turns: context.turns.map((turn) => ({
        id: turn.id,
        items: [...turn.items],
      })),
    };
  });

  const updateResumeCursor = Effect.fn("updateResumeCursor")(function* (
    context: ClaudeSessionContext,
  ) {
    const threadId = context.session.threadId;
    if (!threadId) return;

    const resumeCursor = {
      threadId,
      ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
      ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
      turnCount: context.turns.length,
    };

    context.session = {
      ...context.session,
      resumeCursor,
      updatedAt: yield* nowIso,
    };
  });

  const ensureAssistantTextBlock = Effect.fn("ensureAssistantTextBlock")(function* (
    context: ClaudeSessionContext,
    blockIndex: number,
    options?: {
      readonly fallbackText?: string;
      readonly streamClosed?: boolean;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState) {
      return undefined;
    }

    const existing = turnState.assistantTextBlocks.get(blockIndex);
    if (existing && !existing.completionEmitted) {
      if (existing.fallbackText.length === 0 && options?.fallbackText) {
        existing.fallbackText = options.fallbackText;
      }
      if (options?.streamClosed) {
        existing.streamClosed = true;
      }
      return { blockIndex, block: existing };
    }

    const block: AssistantTextBlockState = {
      itemId: yield* randomUUIDv4,
      blockIndex,
      emittedTextDelta: false,
      fallbackText: options?.fallbackText ?? "",
      streamClosed: options?.streamClosed ?? false,
      completionEmitted: false,
    };
    turnState.assistantTextBlocks.set(blockIndex, block);
    turnState.assistantTextBlockOrder.push(block);
    return { blockIndex, block };
  });

  const createSyntheticAssistantTextBlock = Effect.fn("createSyntheticAssistantTextBlock")(
    function* (context: ClaudeSessionContext, fallbackText: string) {
      const turnState = context.turnState;
      if (!turnState) {
        return undefined;
      }

      const blockIndex = turnState.nextSyntheticAssistantBlockIndex;
      turnState.nextSyntheticAssistantBlockIndex -= 1;
      return yield* ensureAssistantTextBlock(context, blockIndex, {
        fallbackText,
        streamClosed: true,
      });
    },
  );

  const completeAssistantTextBlock = Effect.fn("completeAssistantTextBlock")(function* (
    context: ClaudeSessionContext,
    block: AssistantTextBlockState,
    options?: {
      readonly force?: boolean;
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState || block.completionEmitted) {
      return;
    }

    if (!options?.force && !block.streamClosed) {
      return;
    }

    if (!block.emittedTextDelta && block.fallbackText.length > 0) {
      const deltaStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "content.delta",
        eventId: deltaStamp.eventId,
        provider: PROVIDER,
        createdAt: deltaStamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        itemId: asRuntimeItemId(block.itemId),
        payload: {
          streamKind: "assistant_text",
          delta: block.fallbackText,
        },
        providerRefs: nativeProviderRefs(context),
        ...(options?.rawMethod || options?.rawPayload
          ? {
              raw: {
                source: "claude.sdk.message" as const,
                ...(options.rawMethod ? { method: options.rawMethod } : {}),
                payload: options?.rawPayload,
              },
            }
          : {}),
      });
    }

    block.completionEmitted = true;
    if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
      turnState.assistantTextBlocks.delete(block.blockIndex);
    }

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "item.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      itemId: asRuntimeItemId(block.itemId),
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        itemType: "assistant_message",
        status: "completed",
        title: "Assistant message",
        ...(block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}),
      },
      providerRefs: nativeProviderRefs(context),
      ...(options?.rawMethod || options?.rawPayload
        ? {
            raw: {
              source: "claude.sdk.message" as const,
              ...(options.rawMethod ? { method: options.rawMethod } : {}),
              payload: options?.rawPayload,
            },
          }
        : {}),
    });
  });

  const backfillAssistantTextBlocksFromSnapshot = Effect.fn(
    "backfillAssistantTextBlocksFromSnapshot",
  )(function* (context: ClaudeSessionContext, message: SDKMessage) {
    const turnState = context.turnState;
    if (!turnState) {
      return;
    }

    const snapshotTextBlocks = extractAssistantTextBlocks(message);
    if (snapshotTextBlocks.length === 0) {
      return;
    }

    const orderedBlocks = turnState.assistantTextBlockOrder.map((block) => ({
      blockIndex: block.blockIndex,
      block,
    }));

    for (const [position, text] of snapshotTextBlocks.entries()) {
      const existingEntry = orderedBlocks[position];
      const entry =
        existingEntry ??
        (yield* createSyntheticAssistantTextBlock(context, text).pipe(
          Effect.map((created) => {
            if (!created) {
              return undefined;
            }
            orderedBlocks.push(created);
            return created;
          }),
        ));
      if (!entry) {
        continue;
      }

      if (entry.block.fallbackText.length === 0) {
        entry.block.fallbackText = text;
      }

      if (entry.block.streamClosed && !entry.block.completionEmitted) {
        yield* completeAssistantTextBlock(context, entry.block, {
          rawMethod: "claude/assistant",
          rawPayload: message,
        });
      }
    }
  });

  const ensureThreadId = Effect.fn("ensureThreadId")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    const nextThreadId = boundedClaudeEntityId(message.session_id);
    if (!nextThreadId) return;
    if (!hasDurableClaudeSessionId(message)) {
      return;
    }
    context.resumeSessionId = nextThreadId;
    yield* updateResumeCursor(context);

    if (context.lastThreadStartedId !== nextThreadId) {
      context.lastThreadStartedId = nextThreadId;
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "thread.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: {
          providerThreadId: nextThreadId,
        },
        providerRefs: {},
        raw: {
          source: "claude.sdk.message",
          method: "claude/thread/started",
          payload: {
            session_id: message.session_id,
          },
        },
      });
    }
  });

  const emitRuntimeError = Effect.fn("emitRuntimeError")(function* (
    context: ClaudeSessionContext,
    message: string,
    cause?: unknown,
  ) {
    if (cause !== undefined) {
      void cause;
    }
    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "runtime.error",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
      payload: {
        message,
        class: "provider_error",
        ...(cause !== undefined ? { detail: cause } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });
  });

  const emitRuntimeWarning = Effect.fn("emitRuntimeWarning")(function* (
    context: ClaudeSessionContext,
    message: string,
    detail?: unknown,
  ) {
    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "runtime.warning",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
      payload: {
        message,
        ...(detail !== undefined ? { detail } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });
  });

  const emitThreadTokenUsage = Effect.fn("emitThreadTokenUsage")(function* (
    context: ClaudeSessionContext,
    usage: ThreadTokenUsageSnapshot | undefined,
    options?: {
      readonly rawMethod?: string;
      readonly rawPayload?: unknown;
    },
  ) {
    if (!usage) {
      return;
    }

    context.lastKnownTokenUsage = usage;
    context.lastKnownTotalProcessedTokens =
      usage.totalProcessedTokens ?? context.lastKnownTotalProcessedTokens;

    const turnState = context.turnState;
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "thread.token-usage.updated",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(turnState ? { turnId: turnState.turnId } : {}),
      payload: {
        usage,
      },
      providerRefs: nativeProviderRefs(context),
      ...(options?.rawMethod || options?.rawPayload
        ? {
            raw: {
              source: "claude.sdk.message" as const,
              ...(options.rawMethod ? { method: options.rawMethod } : {}),
              payload: options.rawPayload,
            },
          }
        : {}),
    });
  });

  const queryCurrentContextUsage = Effect.fn("queryCurrentContextUsage")(function* (
    context: ClaudeSessionContext,
    totalProcessedTokens?: number,
  ) {
    if (!context.query.getContextUsage) {
      return undefined;
    }

    const usage = yield* Effect.promise(async () => {
      try {
        return await context.query.getContextUsage?.();
      } catch {
        return undefined;
      }
    }).pipe(Effect.timeoutOption("1 second"));
    if (Option.isNone(usage) || !usage.value) {
      return undefined;
    }

    context.lastKnownContextWindow = usage.value.maxTokens;
    return normalizeClaudeContextUsageApiSnapshot(usage.value, totalProcessedTokens);
  });

  const emitProposedPlanCompleted = Effect.fn("emitProposedPlanCompleted")(function* (
    context: ClaudeSessionContext,
    input: {
      readonly planMarkdown: string;
      readonly toolUseId?: string | undefined;
      readonly rawSource: "claude.sdk.message" | "claude.sdk.permission";
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) {
    const turnState = context.turnState;
    const planMarkdown = input.planMarkdown.trim();
    if (!turnState || planMarkdown.length === 0) {
      return;
    }

    const captureKey = exitPlanCaptureKey({
      toolUseId: input.toolUseId,
      planMarkdown,
    });
    if (turnState.capturedProposedPlanKeys.has(captureKey)) {
      return;
    }
    turnState.capturedProposedPlanKeys.add(captureKey);

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.proposed.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        planMarkdown,
      },
      providerRefs: nativeProviderRefs(context, {
        providerItemId: input.toolUseId,
      }),
      raw: {
        source: input.rawSource,
        method: input.rawMethod,
        payload: input.rawPayload,
      },
    });
  });

  const emitClaudeTaskPlanUpdated = Effect.fn("emitClaudeTaskPlanUpdated")(function* (
    context: ClaudeSessionContext,
    input: {
      readonly toolUseId: string;
      readonly rawMethod: string;
      readonly rawPayload: unknown;
    },
  ) {
    const plan = planStepsFromClaudeTasks(context.claudeTasks);
    if (plan.length === 0) {
      return;
    }

    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.plan.updated",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      payload: {
        explanation: "Claude Tasks",
        plan,
      },
      providerRefs: nativeProviderRefs(context, {
        providerItemId: input.toolUseId,
      }),
      raw: {
        source: "claude.sdk.message",
        method: input.rawMethod,
        payload: input.rawPayload,
      },
    });
  });

  const completeTurn = Effect.fn("completeTurn")(function* (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
    result?: SDKResultMessage,
  ) {
    const resultContextWindow = maxClaudeContextWindowFromModelUsage(result?.modelUsage);
    if (resultContextWindow !== undefined) {
      context.lastKnownContextWindow = resultContextWindow;
    }

    const maxTokens = resultContextWindow ?? context.lastKnownContextWindow;
    const accumulatedTotalProcessedTokens = claudeTotalProcessedTokens(result?.usage);
    if (accumulatedTotalProcessedTokens !== undefined) {
      context.lastKnownTotalProcessedTokens = accumulatedTotalProcessedTokens;
    }

    const contextUsageSnapshot = yield* queryCurrentContextUsage(
      context,
      accumulatedTotalProcessedTokens ?? context.lastKnownTotalProcessedTokens,
    );
    const resultUsageRecord =
      result?.usage && typeof result.usage === "object" && !Array.isArray(result.usage)
        ? (result.usage as Record<string, unknown>)
        : undefined;
    const hasResultUsageIteration =
      resultUsageRecord !== undefined && lastClaudeUsageIteration(resultUsageRecord) !== undefined;
    const resultHasActiveUsage =
      resultUsageRecord !== undefined &&
      (hasResultUsageIteration ||
        claudeUsageInputTokens(resultUsageRecord) + claudeUsageOutputTokens(resultUsageRecord) > 0);
    const resultTotalOnly =
      resultUsageRecord !== undefined &&
      !resultHasActiveUsage &&
      claudeTotalProcessedTokens(resultUsageRecord) !== undefined;
    const resultIterationSnapshot = resultUsageRecord
      ? normalizeClaudeActiveTokenUsage(
          resultUsageRecord,
          maxTokens,
          accumulatedTotalProcessedTokens ?? context.lastKnownTotalProcessedTokens,
        )
      : undefined;
    const lastGoodUsage = context.lastKnownTokenUsage;
    const usageSnapshot: ThreadTokenUsageSnapshot | undefined =
      contextUsageSnapshot ??
      (resultTotalOnly && lastGoodUsage
        ? {
            ...lastGoodUsage,
            ...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
              ? { maxTokens }
              : {}),
            ...(typeof accumulatedTotalProcessedTokens === "number" &&
            Number.isFinite(accumulatedTotalProcessedTokens) &&
            accumulatedTotalProcessedTokens > lastGoodUsage.usedTokens
              ? {
                  totalProcessedTokens: accumulatedTotalProcessedTokens,
                }
              : {}),
          }
        : resultIterationSnapshot) ??
      (lastGoodUsage
        ? {
            ...lastGoodUsage,
            ...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
              ? { maxTokens }
              : {}),
            ...(typeof accumulatedTotalProcessedTokens === "number" &&
            Number.isFinite(accumulatedTotalProcessedTokens) &&
            accumulatedTotalProcessedTokens > lastGoodUsage.usedTokens
              ? {
                  totalProcessedTokens: accumulatedTotalProcessedTokens,
                }
              : {}),
          }
        : undefined);

    const turnState = context.turnState;
    if (!turnState) {
      yield* emitThreadTokenUsage(context, usageSnapshot, {
        rawMethod: "claude/result",
        rawPayload: result ?? { status },
      });

      // A result with no local turn is never a turn this adapter started:
      // real turns get turnState in sendTurn, and assistant messages that
      // arrive outside a turn auto-start a synthetic one. What lands here is
      // the resume handshake (system/init + result(num_turns: 0)), a late
      // result for a turn already completed locally (steer auto-close,
      // stream teardown), or a stream failure with no turn in flight. The
      // untargeted turn.completed this branch used to emit carried no turnId,
      // so ingestion could not attribute it — and whenever the projection had
      // no active turn (a pending turn start included) it flipped the session
      // lifecycle for a turn that never existed. Keep the usage emission,
      // drop the lifecycle event, and leave a tripwire so the upstream
      // trigger stays measurable in the field.
      yield* Effect.logInfo("claude.turn.result-without-active-turn", {
        threadId: context.session.threadId,
        status,
        numTurns: result?.num_turns,
        hasUsage: result?.usage !== undefined,
        ...(errorMessage ? { errorMessage } : {}),
      });
      return;
    }

    for (const [index, tool] of context.inFlightTools.entries()) {
      const toolStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.completed",
        eventId: toolStamp.eventId,
        provider: PROVIDER,
        createdAt: toolStamp.createdAt,
        threadId: context.session.threadId,
        turnId: turnState.turnId,
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: status === "completed" ? "completed" : "failed",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          data: {
            toolName: tool.toolName,
            input: tool.input,
          },
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/result",
          payload: result ?? { status },
        },
      });
      context.inFlightTools.delete(index);
    }
    // Clear any remaining stale entries (e.g. from interrupted content blocks)
    context.inFlightTools.clear();

    for (const block of turnState.assistantTextBlockOrder) {
      yield* completeAssistantTextBlock(context, block, {
        force: true,
        rawMethod: "claude/result",
        rawPayload: result ?? { status },
      });
    }

    context.turns.push({
      id: turnState.turnId,
      items: [...turnState.items],
    });

    yield* emitThreadTokenUsage(context, usageSnapshot, {
      rawMethod: "claude/result",
      rawPayload: result ?? { status },
    });

    const totalCostUsd = nonNegativeNumber(result?.total_cost_usd);
    const stamp = yield* makeEventStamp();
    yield* offerRuntimeEvent({
      type: "turn.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      turnId: turnState.turnId,
      payload: {
        state: status,
        ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
        ...(result?.usage ? { usage: result.usage } : {}),
        ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
        ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
        ...(errorMessage ? { errorMessage } : {}),
      },
      providerRefs: nativeProviderRefs(context),
    });

    const updatedAt = yield* nowIso;
    context.turnState = undefined;
    context.session = {
      ...context.session,
      status: "ready",
      activeTurnId: undefined,
      updatedAt,
      ...(status === "failed" && errorMessage
        ? { lastError: normalizeProviderSessionError(errorMessage) }
        : {}),
    };
    yield* updateResumeCursor(context);
  });

  const handleStreamEvent = Effect.fn("handleStreamEvent")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "stream_event") {
      return;
    }

    const { event } = message;

    // Subagent-owned stream traffic (parent_tool_use_id set) must not write
    // into the parent transcript: with forwardSubagentText off the SDK still
    // forwards subagent tool_use/tool_result blocks and their wrapping
    // text/thinking deltas, and emitting them interleaved N subagents'
    // narration into the chat (live-test finding). Their results reach the
    // UI via the task.* lifecycle; their tool blocks are attributed and
    // re-homed by the quiet-timeline filter.
    const streamParentToolUseId = (message as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (streamParentToolUseId !== null && streamParentToolUseId !== undefined) {
      // Drop only the subagent's narration (text/thinking); tool_use blocks
      // and their input_json_delta frames must flow so attributed tool items
      // keep their inputs (review finding: dropping deltas emptied inputs).
      const dropStart =
        event.type === "content_block_start" &&
        event.content_block.type !== "tool_use" &&
        event.content_block.type !== "server_tool_use" &&
        event.content_block.type !== "mcp_tool_use";
      const dropDelta =
        event.type === "content_block_delta" &&
        (event.delta.type === "text_delta" || event.delta.type === "thinking_delta");
      if (dropStart || dropDelta) {
        return;
      }
    }

    if (event.type === "message_delta") {
      if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) {
        return;
      }

      const snapshot = normalizeClaudeActiveTokenUsage(
        event.usage,
        context.lastKnownContextWindow,
        context.lastKnownTotalProcessedTokens,
      );
      yield* emitThreadTokenUsage(context, snapshot, {
        rawMethod: "claude/stream_event/message_delta",
        rawPayload: message,
      });
      return;
    }

    if (event.type === "content_block_delta") {
      if (
        (event.delta.type === "text_delta" || event.delta.type === "thinking_delta") &&
        context.turnState
      ) {
        const deltaText =
          event.delta.type === "text_delta"
            ? event.delta.text
            : typeof event.delta.thinking === "string"
              ? event.delta.thinking
              : "";
        if (deltaText.length === 0) {
          return;
        }
        const streamKind = streamKindFromDeltaType(event.delta.type);
        const assistantBlockEntry =
          event.delta.type === "text_delta"
            ? yield* ensureAssistantTextBlock(context, event.index)
            : context.turnState.assistantTextBlocks.get(event.index)
              ? {
                  blockIndex: event.index,
                  block: context.turnState.assistantTextBlocks.get(
                    event.index,
                  ) as AssistantTextBlockState,
                }
              : undefined;
        if (assistantBlockEntry?.block && event.delta.type === "text_delta") {
          assistantBlockEntry.block.emittedTextDelta = true;
        }
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "content.delta",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          ...(assistantBlockEntry?.block
            ? {
                itemId: asRuntimeItemId(assistantBlockEntry.block.itemId),
              }
            : {}),
          payload: {
            streamKind,
            delta: deltaText,
          },
          providerRefs: nativeProviderRefs(context),
          raw: {
            source: "claude.sdk.message",
            method: "claude/stream_event/content_block_delta",
            payload: message,
          },
        });
        return;
      }

      if (event.delta.type === "input_json_delta") {
        const tool = context.inFlightTools.get(event.index);
        if (!tool || typeof event.delta.partial_json !== "string") {
          return;
        }

        const partialInputJson = tool.partialInputJson + event.delta.partial_json;
        const parsedInput = tryParseJsonRecord(partialInputJson);
        const detail = parsedInput
          ? summarizeClaudeToolRequestForDiagnostics(tool.toolName, parsedInput)
          : tool.detail;
        let nextTool: ToolInFlight = {
          ...tool,
          partialInputJson,
          ...(parsedInput ? { input: parsedInput } : {}),
          ...(detail ? { detail } : {}),
        };

        const nextFingerprint =
          parsedInput && Object.keys(parsedInput).length > 0
            ? toolInputFingerprint(parsedInput)
            : undefined;
        context.inFlightTools.set(event.index, nextTool);

        if (
          !parsedInput ||
          !nextFingerprint ||
          tool.lastEmittedInputFingerprint === nextFingerprint
        ) {
          return;
        }

        nextTool = {
          ...nextTool,
          lastEmittedInputFingerprint: nextFingerprint,
        };
        context.inFlightTools.set(event.index, nextTool);

        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "item.updated",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          itemId: asRuntimeItemId(nextTool.itemId),
          payload: {
            itemType: nextTool.itemType,
            status: "inProgress",
            title: nextTool.title,
            ...(nextTool.detail ? { detail: nextTool.detail } : {}),
            ...(nextTool.agentId ? { agentId: nextTool.agentId } : {}),
            ...(nextTool.parentToolUseId ? { parentToolUseId: nextTool.parentToolUseId } : {}),
            data: {
              toolName: nextTool.toolName,
              input: nextTool.input,
            },
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: nextTool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/stream_event/content_block_delta/input_json_delta",
            payload: message,
          },
        });

        // Emit plan update when TodoWrite input is parsed
        if (parsedInput && isTodoTool(nextTool.toolName)) {
          const planSteps = extractPlanStepsFromTodoInput(parsedInput);
          if (planSteps && planSteps.length > 0) {
            const planStamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "turn.plan.updated",
              eventId: planStamp.eventId,
              provider: PROVIDER,
              createdAt: planStamp.createdAt,
              threadId: context.session.threadId,
              ...(context.turnState
                ? {
                    turnId: asCanonicalTurnId(context.turnState.turnId),
                  }
                : {}),
              payload: {
                plan: planSteps,
              },
              providerRefs: nativeProviderRefs(context),
            });
          }
        }
      }
      return;
    }

    if (event.type === "content_block_start") {
      const { index, content_block: block } = event;
      if (block.type === "text") {
        yield* ensureAssistantTextBlock(context, index, {
          fallbackText: extractContentBlockText(block),
        });
        return;
      }
      if (
        block.type !== "tool_use" &&
        block.type !== "server_tool_use" &&
        block.type !== "mcp_tool_use"
      ) {
        return;
      }

      const toolName = block.name;
      const itemType = classifyToolItemType(toolName);
      const toolInput =
        typeof block.input === "object" && block.input !== null
          ? (block.input as Record<string, unknown>)
          : {};
      const itemId = block.id;
      const detail = summarizeClaudeToolRequestForDiagnostics(toolName, toolInput);
      const inputFingerprint =
        Object.keys(toolInput).length > 0 ? toolInputFingerprint(toolInput) : undefined;

      // Attribute tools that ran inside a subagent to their owning agent so
      // clients can re-home them out of the main timeline (quiet-timeline
      // guarantee): the SDK forwards subagent tool_use blocks tagged with the
      // spawning Task tool's id as parent_tool_use_id.
      const parentToolUseId =
        (message as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? undefined;
      const owningAgentId = agentIdForParentToolUse(context.taskAgents, parentToolUseId);

      const tool: ToolInFlight = {
        itemId,
        itemType,
        toolName,
        title: titleForTool(itemType),
        detail,
        input: toolInput,
        partialInputJson: "",
        ...(inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}),
        ...(owningAgentId ? { agentId: owningAgentId } : {}),
        ...(parentToolUseId ? { parentToolUseId } : {}),
      };
      context.inFlightTools.set(index, tool);

      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.started",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: "inProgress",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: {
            toolName: tool.toolName,
            input: toolInput,
          },
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/stream_event/content_block_start",
          payload: message,
        },
      });
      return;
    }

    if (event.type === "content_block_stop") {
      const { index } = event;
      const assistantBlock = context.turnState?.assistantTextBlocks.get(index);
      if (assistantBlock) {
        assistantBlock.streamClosed = true;
        yield* completeAssistantTextBlock(context, assistantBlock, {
          rawMethod: "claude/stream_event/content_block_stop",
          rawPayload: message,
        });
        return;
      }
      const tool = context.inFlightTools.get(index);
      if (!tool) {
        return;
      }
    }
  });

  const handleUserMessage = Effect.fn("handleUserMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "user") {
      return;
    }

    if (context.turnState) {
      context.turnState.items.push(message.message);
    }

    for (const toolResult of toolResultBlocksFromUserMessage(message)) {
      const toolEntry = Array.from(context.inFlightTools.entries()).find(
        ([, tool]) => tool.itemId === toolResult.toolUseId,
      );
      if (!toolEntry) {
        continue;
      }

      const [index, tool] = toolEntry;
      const itemStatus = toolResult.isError ? "failed" : "completed";
      const toolUseResult = readClaudeToolUseResult(message);
      const toolData = {
        toolName: tool.toolName,
        input: tool.input,
        result: toolResult.block,
      };

      const updatedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.updated",
        eventId: updatedStamp.eventId,
        provider: PROVIDER,
        createdAt: updatedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: toolResult.isError ? "failed" : "inProgress",
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: toolData,
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user",
          payload: message,
        },
      });

      const streamKind = toolResultStreamKind(tool.itemType);
      if (streamKind && toolResult.text.length > 0 && context.turnState) {
        const deltaStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "content.delta",
          eventId: deltaStamp.eventId,
          provider: PROVIDER,
          createdAt: deltaStamp.createdAt,
          threadId: context.session.threadId,
          turnId: context.turnState.turnId,
          itemId: asRuntimeItemId(tool.itemId),
          payload: {
            streamKind,
            delta: toolResult.text,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: tool.itemId,
          }),
          raw: {
            source: "claude.sdk.message",
            method: "claude/user",
            payload: message,
          },
        });
      }

      const completedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "item.completed",
        eventId: completedStamp.eventId,
        provider: PROVIDER,
        createdAt: completedStamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        itemId: asRuntimeItemId(tool.itemId),
        payload: {
          itemType: tool.itemType,
          status: itemStatus,
          title: tool.title,
          ...(tool.detail ? { detail: tool.detail } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.parentToolUseId ? { parentToolUseId: tool.parentToolUseId } : {}),
          data: toolData,
        },
        providerRefs: nativeProviderRefs(context, {
          providerItemId: tool.itemId,
        }),
        raw: {
          source: "claude.sdk.message",
          method: "claude/user",
          payload: message,
        },
      });

      // The Workflow tool's result carries the run handles (runId, scriptPath,
      // transcriptDir, sessionUrl). Attach them to the workflow's task agent so
      // the next task.* payload advertises them to clients.
      if (!toolResult.isError && tool.toolName.toLowerCase() === "workflow" && toolUseResult) {
        const workflowTaskId = trimmedString(toolUseResult.taskId, ENTITY_ID_MAX_LENGTH);
        if (workflowTaskId) {
          const runHandles: TaskRunHandles = {
            ...(trimmedString(toolUseResult.runId)
              ? { runId: trimmedString(toolUseResult.runId) }
              : {}),
            ...(trimmedString(toolUseResult.scriptPath)
              ? { scriptPath: trimmedString(toolUseResult.scriptPath) }
              : {}),
            ...(trimmedString(toolUseResult.transcriptDir)
              ? { transcriptDir: trimmedString(toolUseResult.transcriptDir) }
              : {}),
            ...(sanitizeSessionUrl(toolUseResult.sessionUrl)
              ? { sessionUrl: sanitizeSessionUrl(toolUseResult.sessionUrl) }
              : {}),
          };
          const existing = context.taskAgents.get(workflowTaskId);
          if (existing || context.taskAgents.size < CLAUDE_TASK_STATE_CAPACITY) {
            context.taskAgents.set(workflowTaskId, {
              taskId: workflowTaskId,
              toolUseId: existing?.toolUseId ?? tool.itemId,
              description: existing?.description,
              subagentType: existing?.subagentType,
              taskType: existing?.taskType ?? "local_workflow",
              workflowName: existing?.workflowName,
              skipTranscript: existing?.skipTranscript ?? false,
              runHandles,
              owningAgentId: existing?.owningAgentId,
              model: existing?.model,
              effort: existing?.effort,
            });
          }
        }
      }

      if (
        !toolResult.isError &&
        applyClaudeTaskToolResult(context.claudeTasks, tool, toolUseResult)
      ) {
        yield* emitClaudeTaskPlanUpdated(context, {
          toolUseId: tool.itemId,
          rawMethod: "claude/user",
          rawPayload: message,
        });
      }

      context.inFlightTools.delete(index);
    }
  });

  const handleAssistantMessage = Effect.fn("handleAssistantMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "assistant") {
      return;
    }

    // Subagent-owned assistant snapshots (parent_tool_use_id set) are the
    // subagent's own conversation, not the parent's. Emitting them created
    // interleaved "Agent N done"-adjacent leak messages and spawned synthetic
    // turns per subagent completion (which also reset the Working timer).
    const assistantParentToolUseId = (message as { parent_tool_use_id?: string | null })
      .parent_tool_use_id;
    if (assistantParentToolUseId !== null && assistantParentToolUseId !== undefined) {
      // The snapshot's message.model is the authoritative API model the
      // subagent actually ran on — refine the seeded launch-time value.
      const owningTaskId = agentIdForParentToolUse(context.taskAgents, assistantParentToolUseId);
      const snapshotModel = trimmedString(message.message.model);
      const owningAgent = owningTaskId ? context.taskAgents.get(owningTaskId) : undefined;
      if (snapshotModel) {
        if (owningAgent) {
          owningAgent.model = snapshotModel;
        } else {
          // The snapshot beat its task_started (or its tool_use_id was never
          // recorded): hold the model until the task registers.
          rememberPendingTaskModel(
            context.pendingTaskModels,
            assistantParentToolUseId,
            snapshotModel,
          );
        }
      }
      context.lastAssistantUuid = boundedClaudeEntityId(message.uuid);
      yield* updateResumeCursor(context);
      return;
    }

    // Auto-start a synthetic turn for assistant messages that arrive without
    // an active turn (e.g., background agent/subagent responses between user prompts).
    if (!context.turnState) {
      const turnId = TurnId.make(yield* randomUUIDv4);
      const startedAt = yield* nowIso;
      context.turnState = {
        turnId,
        startedAt,
        synthetic: true,
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        nextSyntheticAssistantBlockIndex: -1,
      };
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt: startedAt,
      };
      const turnStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "turn.started",
        eventId: turnStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: turnStartedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: {},
        providerRefs: {
          ...nativeProviderRefs(context),
          providerTurnId: turnId,
        },
        raw: {
          source: "claude.sdk.message",
          method: "claude/synthetic-turn-start",
          payload: {},
        },
      });
    }

    const content = message.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const toolUse = block as {
          type?: unknown;
          id?: unknown;
          name?: unknown;
          input?: unknown;
        };
        if (toolUse.type !== "tool_use" || toolUse.name !== "ExitPlanMode") {
          continue;
        }
        const planMarkdown = extractExitPlanModePlan(toolUse.input);
        if (!planMarkdown) {
          continue;
        }
        yield* emitProposedPlanCompleted(context, {
          planMarkdown,
          toolUseId: typeof toolUse.id === "string" ? toolUse.id : undefined,
          rawSource: "claude.sdk.message",
          rawMethod: "claude/assistant",
          rawPayload: message,
        });
      }
    }

    if (context.turnState) {
      context.turnState.items.push(message.message);
      yield* backfillAssistantTextBlocksFromSnapshot(context, message);
    }

    context.lastAssistantUuid = boundedClaudeEntityId(message.uuid);
    yield* updateResumeCursor(context);
  });

  const handleResultMessage = Effect.fn("handleResultMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "result") {
      return;
    }

    const status = turnStatusFromResult(message);
    const errorMessage = resultUserFacingError(message);

    if (status === "failed") {
      yield* emitRuntimeError(context, errorMessage ?? "Claude turn failed.");
    }

    yield* completeTurn(context, status, errorMessage, message);
  });

  /**
   * Synthesizes per-member task.progress rows from the coordinator's
   * workflow_progress array. Member identity is the stable slot
   * `<coordinatorTaskId>:wf:<index>` (never the per-attempt agent id, which
   * changes on retry and would split one member into duplicate rows).
   * timelineBypass keeps these out of the parent chat; the Agents surface and
   * workflow card consume them.
   */
  const emitWorkflowMemberProgress = Effect.fn("emitWorkflowMemberProgress")(function* (
    context: ClaudeSessionContext,
    base: Omit<ProviderRuntimeEvent, "type" | "payload">,
    message: Extract<SDKMessage, { type: "system"; subtype: "task_progress" }>,
  ) {
    const progress = parseWorkflowProgress(
      (message as unknown as Record<string, unknown>).workflow_progress,
    );
    if (!progress) {
      return;
    }
    const coordinatorId = boundedClaudeTaskId(message.task_id);
    for (const entry of progress.agents) {
      const memberSuffix = `:wf:${entry.index}`;
      const memberTaskId = `${coordinatorId.slice(
        0,
        ENTITY_ID_MAX_LENGTH - memberSuffix.length,
      )}${memberSuffix}`;
      const status = workflowAgentStatus(entry);
      // Material-transition filter: the wire repeats every member each tick.
      // Emit only when something the client renders actually changed, so a
      // 100-agent fleet costs ~1 event per changed member instead of 100
      // per tick (review finding: unbounded event amplification).
      const fingerprint = [
        status,
        entry.label ?? "",
        entry.model ?? "",
        entry.lastToolName ?? "",
        entry.error ?? "",
        entry.tokens ?? "",
        entry.toolCalls ?? "",
        entry.phaseIndex ?? "",
        entry.phaseTitle ?? "",
        entry.attempt ?? "",
      ].join("\u001f");
      if (context.workflowMemberFingerprints.get(memberTaskId) === fingerprint) {
        continue;
      }
      if (
        !context.workflowMemberFingerprints.has(memberTaskId) &&
        context.workflowMemberFingerprints.size >= CLAUDE_WORKFLOW_FINGERPRINT_CAPACITY
      ) {
        continue;
      }
      context.workflowMemberFingerprints.set(memberTaskId, fingerprint);
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        ...base,
        eventId: stamp.eventId,
        createdAt: stamp.createdAt,
        type: "task.progress",
        payload: {
          taskId: RuntimeTaskId.make(memberTaskId),
          description: entry.label ?? `agent ${entry.index}`,
          status,
          ...(entry.error ? { error: entry.error } : {}),
          ...(entry.label ? { title: entry.label } : {}),
          ...(entry.model ? { model: entry.model } : {}),
          ...(entry.lastToolName ? { lastToolName: entry.lastToolName } : {}),
          ...(entry.tokens !== undefined
            ? {
                typedUsage: {
                  totalTokens: entry.tokens,
                  ...(entry.toolCalls !== undefined ? { toolUses: entry.toolCalls } : {}),
                },
              }
            : {}),
          parentAgentId: coordinatorId,
          agentIndex: entry.index,
          ...(entry.phaseIndex !== undefined ? { phaseIndex: entry.phaseIndex } : {}),
          ...(entry.phaseTitle ? { phaseTitle: entry.phaseTitle } : {}),
          ...(entry.attempt !== undefined ? { attempt: entry.attempt } : {}),
          timelineBypass: true,
        },
      });
    }
  });

  const handleSystemMessage = Effect.fn("handleSystemMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    if (message.type !== "system") {
      return;
    }

    const stamp = yield* makeEventStamp();
    const base = {
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      providerRefs: nativeProviderRefs(context),
      raw: {
        source: "claude.sdk.message" as const,
        method: sdkNativeMethod(message),
        messageType: `${message.type}:${message.subtype}`,
        payload: message,
      },
    };

    // Undeclared-but-real subtypes (absent from the SDK's union, so they can't
    // be switch cases): consumed intentionally without emitting, otherwise
    // they fall through to the unknown-subtype warning and surface as spurious
    // error rows in client work logs. `background_tasks_changed` is a roster
    // snapshot ({tasks: [...]}) — the task_* lifecycle events carry the
    // authoritative per-agent data and the typed background_tasks control
    // request is the reconciliation source. `vcs_state_changed`
    // ({kind: commit|push|rebase}) and `code_change_published`
    // ({provider, url, repo}) are informational CLI notices; the work log
    // already shows the underlying git/gh tool calls.
    switch (message.subtype as string) {
      case "background_tasks_changed":
      case "vcs_state_changed":
      case "code_change_published":
        return;
    }

    switch (message.subtype) {
      case "init":
        yield* offerRuntimeEvent({
          ...base,
          type: "session.configured",
          payload: {
            config: message as Record<string, unknown>,
          },
        });
        return;
      case "status":
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state: message.status === "compacting" ? "waiting" : "running",
            reason: `status:${message.status ?? "active"}`,
            detail: message,
          },
        });
        return;
      case "compact_boundary":
        yield* emitThreadTokenUsage(
          context,
          compactBoundaryTokenUsageSnapshot(
            message as unknown as Record<string, unknown>,
            context.lastKnownContextWindow,
            context.lastKnownTotalProcessedTokens,
          ),
          {
            rawMethod: "claude/system/compact_boundary",
            rawPayload: message,
          },
        );
        yield* offerRuntimeEvent({
          ...base,
          type: "thread.state.changed",
          payload: {
            state: "compacted",
            detail: message,
          },
        });
        return;
      case "hook_started":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.started",
          payload: {
            hookId: message.hook_id.slice(0, ENTITY_ID_MAX_LENGTH),
            hookName: message.hook_name.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            hookEvent: message.hook_event.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
          },
        });
        return;
      case "hook_progress":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.progress",
          payload: {
            hookId: message.hook_id.slice(0, ENTITY_ID_MAX_LENGTH),
            output: message.output?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            stdout: message.stdout?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            stderr: message.stderr?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
          },
        });
        return;
      case "hook_response":
        yield* offerRuntimeEvent({
          ...base,
          type: "hook.completed",
          payload: {
            hookId: message.hook_id.slice(0, ENTITY_ID_MAX_LENGTH),
            outcome: message.outcome,
            output: message.output?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            stdout: message.stdout?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            stderr: message.stderr?.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
            ...(typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}),
          },
        });
        return;
      case "task_started": {
        const taskId = boundedClaudeTaskId(message.task_id);
        // A task launched by a tool that itself ran inside a subagent (the
        // in-flight tool carries agentId from parent_tool_use_id) is
        // agent-internal: a subagent's background shell, not parent work.
        const launchingTool = message.tool_use_id
          ? Array.from(context.inFlightTools.values()).find(
              (tool) => tool.itemId === message.tool_use_id,
            )
          : undefined;
        const owningAgentId = launchingTool?.agentId;
        // Model/effort: the Agent tool's input carries explicit overrides;
        // absent ones inherit the session's selection (SDK behavior).
        // Subagent assistant snapshots refine model with the authoritative API
        // id: one that already arrived is buffered and outranks the seed here,
        // later ones refine the record in place. AgentInput.effort may be a
        // named level or an integer.
        const launchInput = launchingTool?.input;
        const toolUseId = message.tool_use_id;
        const bufferedModel = toolUseId ? context.pendingTaskModels.get(toolUseId) : undefined;
        if (toolUseId) {
          context.pendingTaskModels.delete(toolUseId);
        }
        const model =
          bufferedModel ??
          trimmedString(launchInput?.model) ??
          trimmedString(context.session.model ?? undefined);
        const rawLaunchEffort = launchInput?.effort;
        const effort =
          trimmedString(rawLaunchEffort) ??
          (typeof rawLaunchEffort === "number" && Number.isFinite(rawLaunchEffort)
            ? String(rawLaunchEffort)
            : context.currentEffort);
        // Remember the agent identity so every later task.* payload for this
        // taskId is self-describing (identity must survive activity retention).
        if (
          context.taskAgents.has(taskId) ||
          context.taskAgents.size < CLAUDE_TASK_STATE_CAPACITY
        ) {
          context.taskAgents.set(taskId, {
            taskId,
            toolUseId: trimmedString(message.tool_use_id, ENTITY_ID_MAX_LENGTH),
            description: trimmedString(message.description),
            subagentType: trimmedString(message.subagent_type),
            taskType: trimmedString(message.task_type),
            workflowName: trimmedString(message.workflow_name),
            skipTranscript: message.skip_transcript === true,
            runHandles: context.taskAgents.get(taskId)?.runHandles,
            owningAgentId,
            model,
            effort,
          });
        }
        if (
          context.liveTaskIds.has(taskId) ||
          context.liveTaskIds.size < CLAUDE_TASK_STATE_CAPACITY
        ) {
          context.liveTaskIds.add(taskId);
        }
        yield* offerRuntimeEvent({
          ...base,
          type: "task.started",
          payload: {
            taskId: RuntimeTaskId.make(taskId),
            description: trimmedString(message.description) ?? "Task",
            ...(trimmedString(message.task_type)
              ? { taskType: trimmedString(message.task_type)! }
              : {}),
            ...(owningAgentId ? { agentId: owningAgentId } : {}),
            ...(trimmedString(message.description)
              ? { title: trimmedString(message.description)! }
              : {}),
            ...(trimmedString(message.subagent_type)
              ? { role: trimmedString(message.subagent_type)! }
              : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(trimmedString(message.tool_use_id, ENTITY_ID_MAX_LENGTH)
              ? { toolUseId: trimmedString(message.tool_use_id, ENTITY_ID_MAX_LENGTH)! }
              : {}),
            ...(trimmedString(message.workflow_name)
              ? { workflowName: trimmedString(message.workflow_name)! }
              : {}),
          },
        });
        return;
      }
      case "task_progress": {
        const taskId = boundedClaudeTaskId(message.task_id);
        yield* emitThreadTokenUsage(
          context,
          normalizeClaudeTaskProgressTokenUsage(message.usage, context),
          {
            rawMethod: "claude/system/task_progress",
            rawPayload: message,
          },
        );
        const linkage = taskLinkageFor(context.taskAgents, taskId);
        const typedUsage = normalizeTaskUsage(message.usage);
        // Phases ride on the coordinator's ONE progress row per tick. A
        // separate phases-only row shared the stable ingestion activity id
        // with this full row, and the thinner upsert overwrote usage and
        // progress text (review finding).
        const workflowPhases = parseWorkflowProgress(
          (message as unknown as Record<string, unknown>).workflow_progress,
        )?.phases;
        yield* offerRuntimeEvent({
          ...base,
          type: "task.progress",
          payload: {
            taskId: RuntimeTaskId.make(taskId),
            description: trimmedString(message.description) ?? "Task",
            ...(trimmedString(message.summary) ? { summary: trimmedString(message.summary)! } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
            ...(typedUsage ? { typedUsage } : {}),
            ...(trimmedString(message.last_tool_name)
              ? { lastToolName: trimmedString(message.last_tool_name)! }
              : {}),
            ...(workflowPhases && workflowPhases.length > 0 ? { phases: workflowPhases } : {}),
            ...linkage,
            ...(trimmedString(message.subagent_type)
              ? { role: trimmedString(message.subagent_type)! }
              : {}),
          },
        });
        yield* emitWorkflowMemberProgress(context, base, message);
        return;
      }
      case "task_updated": {
        const taskId = boundedClaudeTaskId(message.task_id);
        // Status patch (killed/paused/backgrounded/end_time/error) — main
        // previously dropped this on the floor, losing all transitions.
        const patch = message.patch;
        const status =
          patch.status !== undefined ? CLAUDE_TASK_PATCH_STATUS[patch.status] : undefined;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          context.liveTaskIds.delete(taskId);
        }
        const endedAt =
          typeof patch.end_time === "number" && Number.isFinite(patch.end_time)
            ? DateTime.formatIso(DateTime.makeUnsafe(patch.end_time))
            : undefined;
        yield* offerRuntimeEvent({
          ...base,
          type: "task.updated",
          payload: {
            taskId: RuntimeTaskId.make(taskId),
            ...(status ? { status } : {}),
            ...(trimmedString(patch.description)
              ? { description: trimmedString(patch.description)! }
              : {}),
            ...(trimmedString(patch.error) ? { error: trimmedString(patch.error)! } : {}),
            ...(endedAt ? { endedAt } : {}),
            ...(patch.is_backgrounded !== undefined
              ? { isBackgrounded: patch.is_backgrounded }
              : {}),
            ...taskLinkageFor(context.taskAgents, taskId),
          },
        });
        return;
      }
      case "task_notification": {
        const taskId = boundedClaudeTaskId(message.task_id);
        context.liveTaskIds.delete(taskId);
        yield* emitThreadTokenUsage(
          context,
          normalizeClaudeTaskProgressTokenUsage(message.usage, context),
          {
            rawMethod: "claude/system/task_notification",
            rawPayload: message,
          },
        );
        const typedUsage = normalizeTaskUsage(message.usage);
        const linkage = taskLinkageFor(context.taskAgents, taskId);
        yield* offerRuntimeEvent({
          ...base,
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.make(taskId),
            status: message.status,
            ...(trimmedString(message.summary) ? { summary: trimmedString(message.summary)! } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
            ...(typedUsage ? { typedUsage } : {}),
            ...(trimmedString(message.output_file, PROVIDER_RUNTIME_PATH_MAX_LENGTH)
              ? {
                  outputFile: trimmedString(message.output_file, PROVIDER_RUNTIME_PATH_MAX_LENGTH)!,
                }
              : {}),
            ...linkage,
          },
        });
        forgetClaudeTaskRuntimeState(context, taskId);
        return;
      }
      case "files_persisted": {
        const files = Array.isArray(message.files)
          ? message.files.slice(0, PROVIDER_RUNTIME_MAX_PERSISTED_FILES).flatMap((file) => {
              if (
                typeof file !== "object" ||
                file === null ||
                typeof file.filename !== "string" ||
                typeof file.file_id !== "string"
              ) {
                return [];
              }
              return [
                {
                  filename: file.filename.slice(0, PROVIDER_RUNTIME_PATH_MAX_LENGTH),
                  fileId: file.file_id.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
                },
              ];
            })
          : [];
        const failed = Array.isArray(message.failed)
          ? message.failed.slice(0, PROVIDER_RUNTIME_MAX_PERSISTED_FILES).flatMap((entry) => {
              if (
                typeof entry !== "object" ||
                entry === null ||
                typeof entry.filename !== "string" ||
                typeof entry.error !== "string"
              ) {
                return [];
              }
              return [
                {
                  filename: entry.filename.slice(0, PROVIDER_RUNTIME_PATH_MAX_LENGTH),
                  error: entry.error.slice(0, PROVIDER_RUNTIME_DIAGNOSTIC_MAX_LENGTH),
                },
              ];
            })
          : undefined;
        yield* offerRuntimeEvent({
          ...base,
          type: "files.persisted",
          payload: {
            files,
            ...(failed ? { failed } : {}),
          },
        });
        return;
      }
      case "thinking_tokens":
        return;
      case "api_retry":
        // Transport-level retry heartbeat. Surfacing each attempt as a
        // warning row spammed the work log (10 rows during a 502 storm);
        // the terminal result/error path reports the actual failure. Keep
        // the session visibly alive instead.
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state: "running",
            reason: `api_retry:${message.attempt}/${message.max_retries}`,
          },
        });
        return;
      case "session_state_changed":
        // Authoritative turn-over signal from the CLI.
        yield* offerRuntimeEvent({
          ...base,
          type: "session.state.changed",
          payload: {
            state:
              message.state === "running"
                ? "running"
                : message.state === "requires_action"
                  ? "waiting"
                  : "ready",
            reason: `session_state:${message.state}`,
          },
        });
        return;
      case "notification":
        // User-facing CLI notification (e.g. context-limit warnings). Only
        // high-priority ones warrant a work-log row.
        if (message.priority === "high" || message.priority === "immediate") {
          yield* emitRuntimeWarning(context, message.text, message);
        }
        return;
      // Inner protocol/UX details with no T3 surface today — consumed
      // deliberately so they don't masquerade as unknown-subtype warnings.
      case "model_refusal_fallback":
      case "local_command_output":
      case "plugin_install":
      case "commands_changed":
      case "memory_recall":
      case "elicitation_complete":
        return;
      case "permission_denied":
        yield* offerRuntimeEvent({
          ...base,
          type: "tool.denied",
          payload: {
            toolName: message.tool_name,
            ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
            ...(message.decision_reason ? { reason: message.decision_reason } : {}),
            ...(message.agent_id ? { agentId: message.agent_id } : {}),
          },
        });
        return;
      case "mirror_error":
        yield* emitRuntimeError(
          context,
          `Claude workspace mirror error: ${message.error}`,
          message,
        );
        return;
      default: {
        // Exhaustiveness guard: every subtype in the SDK's typed union is
        // handled above, so `message` narrows to never here — a new SDK
        // release adding a subtype fails this typecheck instead of silently
        // warning at runtime. The runtime fallback still catches undeclared
        // wire-only subtypes (like background_tasks_changed used to be).
        message satisfies never;
        const unknownMessage = message as never as { subtype: string };
        yield* emitRuntimeWarning(
          context,
          describeUnknownSdkMessage(`Claude system message '${unknownMessage.subtype}'`, message),
          message,
        );
        return;
      }
    }
  });

  const handleSdkTelemetryMessage = Effect.fn("handleSdkTelemetryMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    const stamp = yield* makeEventStamp();
    const base = {
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      providerRefs: nativeProviderRefs(context),
      raw: {
        source: "claude.sdk.message" as const,
        method: sdkNativeMethod(message),
        messageType: message.type,
        payload: message,
      },
    };

    if (message.type === "tool_progress") {
      const elapsedSeconds = nonNegativeNumber(message.elapsed_time_seconds);
      yield* offerRuntimeEvent({
        ...base,
        type: "tool.progress",
        payload: {
          toolUseId: message.tool_use_id,
          toolName: message.tool_name,
          ...(elapsedSeconds === undefined ? {} : { elapsedSeconds }),
          ...(message.task_id ? { taskId: RuntimeTaskId.make(message.task_id) } : {}),
          ...(message.parent_tool_use_id !== null
            ? { parentToolUseId: message.parent_tool_use_id }
            : {}),
        },
      });
      return;
    }

    if (message.type === "tool_use_summary") {
      yield* offerRuntimeEvent({
        ...base,
        type: "tool.summary",
        payload: {
          summary: message.summary,
          ...(message.preceding_tool_use_ids.length > 0
            ? {
                precedingToolUseIds: message.preceding_tool_use_ids,
              }
            : {}),
        },
      });
      return;
    }

    if (message.type === "auth_status") {
      yield* offerRuntimeEvent({
        ...base,
        type: "auth.status",
        payload: {
          isAuthenticating: message.isAuthenticating,
          output: message.output,
          ...(message.error ? { error: message.error } : {}),
        },
      });
      return;
    }

    if (message.type === "rate_limit_event") {
      yield* offerRuntimeEvent({
        ...base,
        type: "account.rate-limits.updated",
        payload: {
          rateLimits: message,
        },
      });
      return;
    }
  });

  const handleSdkMessage = Effect.fn("handleSdkMessage")(function* (
    context: ClaudeSessionContext,
    message: SDKMessage,
  ) {
    yield* logNativeSdkMessage(context, message);
    yield* ensureThreadId(context, message);

    // Wire-only command bookkeeping has no user-facing T3 lifecycle.
    if (sdkMessageType(message) === "command_lifecycle") {
      return;
    }

    switch (message.type) {
      case "stream_event":
        yield* handleStreamEvent(context, message);
        return;
      case "user":
        yield* handleUserMessage(context, message);
        return;
      case "assistant":
        yield* handleAssistantMessage(context, message);
        return;
      case "result":
        yield* handleResultMessage(context, message);
        return;
      case "system":
        yield* handleSystemMessage(context, message);
        return;
      case "tool_progress":
      case "tool_use_summary":
      case "auth_status":
      case "rate_limit_event":
        yield* handleSdkTelemetryMessage(context, message);
        return;
      // Composer prompt suggestions have no T3 surface; consumed deliberately.
      case "prompt_suggestion":
        return;
      default: {
        // Exhaustiveness guard (see handleSystemMessage): new SDK top-level
        // message types fail typecheck here instead of warning at runtime.
        message satisfies never;
        const unknownMessage = message as never as { type: string };
        yield* emitRuntimeWarning(
          context,
          describeUnknownSdkMessage(`Claude SDK message '${unknownMessage.type}'`, message),
          message,
        );
        return;
      }
    }
  });

  const runSdkStream = (
    context: ClaudeSessionContext,
  ): Effect.Effect<void, ProviderAdapterProcessError> =>
    Stream.fromAsyncIterable(
      context.query,
      (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: "Claude runtime stream failed.",
          cause,
        }),
    ).pipe(
      Stream.takeWhile(() => !context.stopped),
      Stream.runForEach((message) =>
        handleSdkMessage(context, message).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: context.session.threadId,
                detail: "Failed to process Claude runtime event.",
                cause,
              }),
          ),
        ),
      ),
    );

  const handleStreamExit = Effect.fn("handleStreamExit")(function* (
    context: ClaudeSessionContext,
    exit: Exit.Exit<void, ProviderAdapterProcessError>,
  ) {
    if (context.stopped) {
      return;
    }

    if (Exit.isFailure(exit)) {
      if (isClaudeInterruptedCause(exit.cause)) {
        if (context.turnState) {
          yield* completeTurn(context, "interrupted", "Claude runtime interrupted.");
        }
      } else {
        const failures = exit.cause.reasons.flatMap((reason) =>
          Cause.isFailReason(reason) ? [reason.error] : [],
        );
        const message = failures[0]?.detail ?? "Claude runtime stream failed.";
        yield* emitRuntimeError(context, message, {
          failureCount: failures.length,
          failureTags: failures.map((failure) => failure._tag),
        });
        yield* completeTurn(context, "failed", message);
      }
    } else if (context.turnState) {
      yield* completeTurn(context, "interrupted", "Claude runtime stream ended.");
    }

    yield* stopSessionInternal(context, {
      emitExitEvent: true,
    });
  });

  const stopSessionInternal = Effect.fn("stopSessionInternal")(function* (
    context: ClaudeSessionContext,
    options?: { readonly emitExitEvent?: boolean },
  ) {
    if (context.stopped) return;

    // Schedule process termination before any cleanup that can wait on the
    // provider. The SDK closes stdin, then escalates from SIGTERM to SIGKILL.
    yield* Effect.try({
      try: () => context.query.close(),
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: "Failed to close Claude runtime query.",
          cause,
        }),
    });

    context.stopped = true;

    for (const taskId of Array.from(context.liveTaskIds)) {
      if (!context.liveTaskIds.delete(taskId)) {
        continue;
      }
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "task.completed",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        payload: {
          taskId: RuntimeTaskId.make(taskId),
          status: "stopped",
          ...taskLinkageFor(context.taskAgents, taskId),
        },
        providerRefs: nativeProviderRefs(context),
      });
    }

    for (const [requestId, pending] of context.pendingApprovals) {
      yield* Deferred.succeed(pending.decision, "cancel");
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "request.resolved",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
        requestId: asRuntimeRequestId(requestId),
        payload: {
          requestType: pending.requestType,
          decision: "cancel",
        },
        providerRefs: nativeProviderRefs(context),
      });
    }
    context.pendingApprovals.clear();

    // Same reason as the approvals above: a request nobody can answer any more
    // must not stay open, or the thread can never be settled.
    for (const pending of context.pendingUserInputs.values()) {
      yield* pending.cancel;
    }

    if (context.turnState) {
      yield* completeTurn(context, "interrupted", "Session stopped.");
    }

    yield* Queue.shutdown(context.promptQueue);

    const streamFiber = context.streamFiber;
    context.streamFiber = undefined;
    if (streamFiber && streamFiber.pollUnsafe() === undefined) {
      yield* Fiber.interrupt(streamFiber);
    }

    const updatedAt = yield* nowIso;
    context.session = {
      ...context.session,
      status: "closed",
      activeTurnId: undefined,
      updatedAt,
    };

    if (options?.emitExitEvent !== false && sessions.get(context.session.threadId) === context) {
      const stamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.exited",
        eventId: stamp.eventId,
        provider: PROVIDER,
        createdAt: stamp.createdAt,
        threadId: context.session.threadId,
        payload: {
          reason: "Session stopped",
          exitKind: "graceful",
        },
        providerRefs: {},
      });
    }

    if (sessions.get(context.session.threadId) === context) {
      sessions.delete(context.session.threadId);
    }
  });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
    const context = sessions.get(threadId);
    if (!context) {
      return Effect.fail(
        new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    if (context.stopped || context.session.status === "closed") {
      return Effect.fail(
        new ProviderAdapterSessionClosedError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    return Effect.succeed(context);
  };

  const startSession: ClaudeAdapterShape["startSession"] = Effect.fn("startSession")(
    function* (input) {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      const existingContext = sessions.get(input.threadId);
      if (existingContext) {
        yield* Effect.logWarning("claude.session.replacing", {
          threadId: input.threadId,
          existingSessionStatus: existingContext.session.status,
          reason: "startSession called with existing active session",
        });
        yield* stopSessionInternal(existingContext, {
          emitExitEvent: false,
        });
      }

      const startedAt = yield* nowIso;
      const resumeState = readClaudeResumeState(input.resumeCursor);
      const threadId = input.threadId;
      const existingResumeSessionId = input.nativeSessionId ?? resumeState?.resume;
      const newSessionId = existingResumeSessionId === undefined ? yield* randomUUIDv4 : undefined;
      const sessionId = existingResumeSessionId ?? newSessionId;

      const runtimeContext = yield* Effect.context<never>();
      const runFork = Effect.runForkWith(runtimeContext);
      const runPromise = Effect.runPromiseWith(runtimeContext);

      const promptQueue = yield* Queue.bounded<PromptQueueItem>(CLAUDE_PROMPT_QUEUE_CAPACITY);
      const prompt = Stream.fromQueue(promptQueue).pipe(
        Stream.filter((item) => item.type === "message"),
        Stream.map((item) => item.message),
        Stream.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause),
        ),
        Stream.toAsyncIterable,
      );

      const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
      const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
      const inFlightTools = new Map<number, ToolInFlight>();
      const claudeTasks = new Map<string, ClaudeTaskState>();
      const taskAgents = new Map<string, ClaudeTaskAgentState>();
      const pendingTaskModels = new Map<string, string>();
      const workflowMemberFingerprints = new Map<string, string>();
      const liveTaskIds = new Set<string>();

      const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

      /**
       * Handle AskUserQuestion tool calls by emitting a `user-input.requested`
       * runtime event and waiting for the user to respond via `respondToUserInput`.
       */
      const handleAskUserQuestion = Effect.fn("handleAskUserQuestion")(function* (
        context: ClaudeSessionContext,
        toolInput: Record<string, unknown>,
        callbackOptions: {
          readonly signal: AbortSignal;
          readonly toolUseID?: string;
        },
      ) {
        const normalizedRequest = normalizeClaudeUserInputRequest(toolInput.questions);
        if (!normalizedRequest) {
          return {
            behavior: "deny",
            message: "Claude returned a user-input request that exceeds the client limits.",
          } satisfies PermissionResult;
        }
        const { questions, providerQuestionById } = normalizedRequest;
        const requestId = ApprovalRequestId.make(yield* randomUUIDv4);

        const answersDeferred = yield* Deferred.make<ProviderUserInputAnswers>();
        let aborted = false;
        const settleAsAborted = Effect.suspend(() => {
          if (!pendingUserInputs.has(requestId)) {
            return Effect.void;
          }
          aborted = true;
          pendingUserInputs.delete(requestId);
          return Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers).pipe(
            Effect.ignore,
          );
        });
        const pendingInput: PendingUserInput = {
          questions,
          answers: answersDeferred,
          cancel: settleAsAborted,
        };
        const onAbort = () => {
          runFork(settleAsAborted);
        };

        const answers = yield* Effect.acquireUseRelease(
          Effect.sync(() => pendingUserInputs.set(requestId, pendingInput)),
          () =>
            Effect.gen(function* () {
              // Register before publishing so an immediate UI answer always
              // finds the request in the pending map.
              const requestedStamp = yield* makeEventStamp();
              yield* offerRuntimeEvent({
                type: "user-input.requested",
                eventId: requestedStamp.eventId,
                provider: PROVIDER,
                createdAt: requestedStamp.createdAt,
                threadId: context.session.threadId,
                ...(context.turnState
                  ? {
                      turnId: asCanonicalTurnId(context.turnState.turnId),
                    }
                  : {}),
                requestId: asRuntimeRequestId(requestId),
                payload: { questions },
                providerRefs: nativeProviderRefs(context, {
                  providerItemId: callbackOptions.toolUseID,
                }),
                raw: {
                  source: "claude.sdk.permission",
                  method: "canUseTool/AskUserQuestion",
                  payload: {
                    toolName: "AskUserQuestion",
                    input: toolInput,
                  },
                },
              });

              callbackOptions.signal.addEventListener("abort", onAbort, {
                once: true,
              });
              if (callbackOptions.signal.aborted) {
                yield* settleAsAborted;
              }
              return yield* Deferred.await(answersDeferred);
            }),
          () =>
            Effect.sync(() => {
              callbackOptions.signal.removeEventListener("abort", onAbort);
              pendingUserInputs.delete(requestId);
            }),
        );

        // Emit user-input.resolved so the UI knows the interaction completed.
        const resolvedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "user-input.resolved",
          eventId: resolvedStamp.eventId,
          provider: PROVIDER,
          createdAt: resolvedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState
            ? {
                turnId: asCanonicalTurnId(context.turnState.turnId),
              }
            : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { answers },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/AskUserQuestion/resolved",
            payload: { answers },
          },
        });

        if (aborted) {
          return {
            behavior: "deny",
            message: "User cancelled tool execution.",
          } satisfies PermissionResult;
        }

        // Return the answers to the SDK in the expected format:
        // { questions: [...], answers: { questionText: selectedLabel } }
        const providerAnswers = toClaudeSdkUserInputAnswers(answers, providerQuestionById);
        return {
          behavior: "allow",
          updatedInput: {
            questions: toolInput.questions,
            answers: providerAnswers,
          },
        } satisfies PermissionResult;
      });

      const handleResumeDialog = Effect.fn("handleResumeDialog")(function* (
        request: Parameters<NonNullable<ClaudeQueryOptions["onUserDialog"]>>[0],
        callbackOptions: Parameters<NonNullable<ClaudeQueryOptions["onUserDialog"]>>[1],
      ) {
        if (request.dialogKind !== "resume_return") {
          return { behavior: "cancelled" as const };
        }

        const context = yield* Ref.get(contextRef);
        if (!context) {
          return { behavior: "cancelled" as const };
        }

        // The question copy lives in @t3tools/shared/claudeCompaction because
        // the web client recognizes this exact text (and the "never" answer)
        // to mirror a permanent dismissal.
        const question = formatClaudeResumeCompactionQuestion({
          ageMinutes: finiteNonNegativeInteger(request.payload.sessionAgeMinutes) ?? 0,
          estimatedTokens: finiteNonNegativeInteger(request.payload.estimatedTokens) ?? 0,
        });
        const result = yield* handleAskUserQuestion(
          context,
          {
            questions: [
              {
                header: "Resume session",
                question,
                options: [
                  {
                    label: "Compact and continue",
                    description: "Resume with a summary and use fewer tokens.",
                  },
                  {
                    label: "Keep full history",
                    description: "Resume without changing the conversation.",
                  },
                  {
                    label: CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
                    description: "Keep full history and skip future resume prompts.",
                  },
                ],
                multiSelect: false,
              },
            ],
          },
          {
            signal: callbackOptions.signal,
            ...(request.toolUseID ? { toolUseID: request.toolUseID } : {}),
          },
        );

        if (result.behavior !== "allow") {
          return { behavior: "cancelled" as const };
        }

        const answers = result.updatedInput.answers;
        const selection =
          answers && typeof answers === "object" && !Array.isArray(answers)
            ? (answers as Record<string, unknown>)[question]
            : undefined;
        const action =
          selection === "Compact and continue"
            ? "compact"
            : selection === CLAUDE_RESUME_COMPACTION_NEVER_ANSWER
              ? "never"
              : "continue";

        return { behavior: "completed" as const, result: action };
      });

      const canUseToolEffect = Effect.fn("canUseTool")(function* (
        toolName: Parameters<CanUseTool>[0],
        toolInput: Parameters<CanUseTool>[1],
        callbackOptions: Parameters<CanUseTool>[2],
      ) {
        const context = yield* Ref.get(contextRef);
        if (!context) {
          return {
            behavior: "deny",
            message: "Claude session context is unavailable.",
          } satisfies PermissionResult;
        }

        // Handle AskUserQuestion: surface clarifying questions to the
        // user via the user-input runtime event channel, regardless of
        // runtime mode (plan mode relies on this heavily).
        if (toolName === "AskUserQuestion") {
          return yield* handleAskUserQuestion(context, toolInput, callbackOptions);
        }

        if (toolName === "ExitPlanMode") {
          const planMarkdown = extractExitPlanModePlan(toolInput);
          if (planMarkdown) {
            yield* emitProposedPlanCompleted(context, {
              planMarkdown,
              toolUseId: callbackOptions.toolUseID,
              rawSource: "claude.sdk.permission",
              rawMethod: "canUseTool/ExitPlanMode",
              rawPayload: {
                toolName,
                input: toolInput,
              },
            });
          }

          return {
            behavior: "deny",
            message:
              "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
          } satisfies PermissionResult;
        }

        const runtimeMode = input.runtimeMode ?? "full-access";
        if (runtimeMode === "full-access") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
          } satisfies PermissionResult;
        }

        const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
        const requestType = classifyRequestType(toolName);
        const detail = summarizeClaudeToolRequestForDiagnostics(toolName, toolInput);
        const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
        const pendingApproval: PendingApproval = {
          requestType,
          detail,
          decision: decisionDeferred,
          ...(callbackOptions.suggestions ? { suggestions: callbackOptions.suggestions } : {}),
        };

        const settleAsAborted = Effect.suspend(() => {
          if (!pendingApprovals.has(requestId)) {
            return Effect.void;
          }
          pendingApprovals.delete(requestId);
          return Deferred.succeed(decisionDeferred, "cancel").pipe(Effect.ignore);
        });
        const onAbort = () => {
          runFork(settleAsAborted);
        };

        const decision = yield* Effect.acquireUseRelease(
          Effect.sync(() => pendingApprovals.set(requestId, pendingApproval)),
          () =>
            Effect.gen(function* () {
              // Register before publishing so an immediate UI decision always
              // resolves the same Deferred.
              const requestedStamp = yield* makeEventStamp();
              yield* offerRuntimeEvent({
                type: "request.opened",
                eventId: requestedStamp.eventId,
                provider: PROVIDER,
                createdAt: requestedStamp.createdAt,
                threadId: context.session.threadId,
                ...(context.turnState
                  ? { turnId: asCanonicalTurnId(context.turnState.turnId) }
                  : {}),
                requestId: asRuntimeRequestId(requestId),
                payload: {
                  requestType,
                  detail,
                  args: {
                    toolName,
                    input: toolInput,
                    ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
                  },
                },
                providerRefs: nativeProviderRefs(context, {
                  providerItemId: callbackOptions.toolUseID,
                }),
                raw: {
                  source: "claude.sdk.permission",
                  method: "canUseTool/request",
                  payload: {
                    toolName,
                    input: toolInput,
                  },
                },
              });

              callbackOptions.signal.addEventListener("abort", onAbort, {
                once: true,
              });
              if (callbackOptions.signal.aborted) {
                yield* settleAsAborted;
              }
              return yield* Deferred.await(decisionDeferred);
            }),
          () =>
            Effect.sync(() => {
              callbackOptions.signal.removeEventListener("abort", onAbort);
              pendingApprovals.delete(requestId);
            }),
        );

        const resolvedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "request.resolved",
          eventId: resolvedStamp.eventId,
          provider: PROVIDER,
          createdAt: resolvedStamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: {
            requestType,
            decision,
          },
          providerRefs: nativeProviderRefs(context, {
            providerItemId: callbackOptions.toolUseID,
          }),
          raw: {
            source: "claude.sdk.permission",
            method: "canUseTool/decision",
            payload: {
              decision,
            },
          },
        });

        if (decision === "accept" || decision === "acceptForSession") {
          return {
            behavior: "allow",
            updatedInput: toolInput,
            ...(decision === "acceptForSession"
              ? {
                  updatedPermissions: toSessionPermissionUpdates(
                    toolName,
                    pendingApproval.suggestions,
                  ),
                }
              : {}),
          } satisfies PermissionResult;
        }

        return {
          behavior: "deny",
          message:
            decision === "cancel"
              ? "User cancelled tool execution."
              : "User declined tool execution.",
        } satisfies PermissionResult;
      });

      const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
        runPromise(canUseToolEffect(toolName, toolInput, callbackOptions));
      const onUserDialog: NonNullable<ClaudeQueryOptions["onUserDialog"]> = (
        request,
        callbackOptions,
      ) => runPromise(handleResumeDialog(request, callbackOptions));

      const claudeBinaryPath = claudeSdkExecutablePath;
      const extraArgs = parseCliArgs(claudeSettings.launchArgs).flags;
      const modelSelection =
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
      const caps = getClaudeModelCapabilities(modelSelection?.model);
      const descriptors = getProviderOptionDescriptors({ caps });
      const apiModelId = modelSelection ? resolveClaudeApiModelId(modelSelection) : undefined;
      const initialContextWindow = selectedClaudeContextWindow(modelSelection);
      const rawEffort = getModelSelectionStringOptionValue(modelSelection, "effort");
      const effort = resolveClaudeEffort(caps, rawEffort) ?? null;
      const fastModeSupported = descriptors.some(
        (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
      );
      const thinkingSupported = descriptors.some(
        (descriptor) => descriptor.type === "boolean" && descriptor.id === "thinking",
      );
      const fastMode =
        getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true &&
        fastModeSupported;
      const thinking = thinkingSupported
        ? getModelSelectionBooleanOptionValue(modelSelection, "thinking")
        : undefined;
      const ultracode = isClaudeUltracodeEffort(effort);
      const effectiveEffort = getEffectiveClaudeAgentEffort(effort, modelSelection?.model);
      const runtimeModeToPermission: Record<string, PermissionMode> = {
        "auto-accept-edits": "acceptEdits",
        auto: "auto",
        "full-access": "bypassPermissions",
      };
      const permissionMode = runtimeModeToPermission[input.runtimeMode];
      const settings = {
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        ...(ultracode ? { ultracode: true } : {}),
        ...(claudeSettings.autoCompactWindow
          ? { autoCompactWindow: Number(claudeSettings.autoCompactWindow) }
          : {}),
      };
      const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
      // The attachments dir grant lets the agent Read/copy pasted images at
      // the paths ProviderService injects into the turn text, without an
      // approval prompt. It is a leaf directory holding only attachment
      // files; siblings like secrets/ and state.sqlite stay ungranted.
      const additionalDirectories = [
        ...(input.cwd ? [input.cwd] : []),
        serverConfig.attachmentsDir,
      ];
      const queryOptions: ClaudeQueryOptions = {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(apiModelId ? { model: apiModelId } : {}),
        pathToClaudeCodeExecutable: claudeBinaryPath,
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: [...CLAUDE_SETTING_SOURCES],
        // `ultracode` is a Claude Code setting, not an API effort level. It is
        // normalized to `xhigh` above and paired with `settings.ultracode`.
        ...(effectiveEffort
          ? {
              effort: effectiveEffort as unknown as NonNullable<ClaudeQueryOptions["effort"]>,
            }
          : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
        ...(existingResumeSessionId ? { resume: existingResumeSessionId } : {}),
        ...(newSessionId ? { sessionId: newSessionId } : {}),
        includePartialMessages: true,
        canUseTool,
        onUserDialog,
        supportedDialogKinds: ["resume_return"],
        env: mergeClaudeSubagentPolicyEnv(claudeEnvironment, input.subagentPolicy),
        additionalDirectories,
        ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {}),
        ...(mcpSession && mcpSession.servers.length > 0
          ? {
              mcpServers: Object.fromEntries(
                mcpSession.servers.map((server) => [
                  server.name,
                  {
                    type: "http" as const,
                    url: server.url,
                    headers: {
                      Authorization: mcpSession.authorizationHeader,
                    },
                  },
                ]),
              ),
            }
          : {}),
      };

      yield* Effect.annotateCurrentSpan({
        "provider.kind": PROVIDER,
        "provider.thread_id": threadId,
        "provider.runtime_mode": input.runtimeMode,
        "claude.resume.source":
          existingResumeSessionId !== undefined ? "resume-session" : "generated-session",
        "claude.resume.thread_id": resumeState?.threadId ?? "",
        "claude.resume.session_id": existingResumeSessionId ?? "",
        "claude.resume.session_at": resumeState?.resumeSessionAt ?? "",
        "claude.resume.turn_count": resumeState?.turnCount ?? -1,
        "claude.query.cwd": input.cwd ?? "",
        "claude.query.model": apiModelId ?? "",
        "claude.query.effort": effectiveEffort ?? "",
        "claude.query.permission_mode": permissionMode ?? "",
        "claude.query.allow_dangerously_skip_permissions": permissionMode === "bypassPermissions",
        "claude.query.resume": existingResumeSessionId ?? "",
        "claude.query.session_id": newSessionId ?? "",
        "claude.query.include_partial_messages": true,
        "claude.query.additional_directories": additionalDirectories,
        "claude.query.setting_sources": [...CLAUDE_SETTING_SOURCES],
        "claude.query.settings_json": encodeJsonStringForDiagnostics(settings) ?? "",
        "claude.query.extra_args_json": encodeJsonStringForDiagnostics(extraArgs) ?? "",
        "claude.query.path_to_executable": claudeBinaryPath,
      });

      const queryRuntime = yield* Effect.try({
        try: () =>
          createQuery({
            prompt,
            options: queryOptions,
          }),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: "Failed to start Claude runtime session.",
            cause,
          }),
      });

      const session: ProviderSession = {
        threadId,
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(threadId ? { threadId } : {}),
        resumeCursor: {
          ...(threadId ? { threadId } : {}),
          ...(sessionId ? { resume: sessionId } : {}),
          ...(resumeState?.resumeSessionAt ? { resumeSessionAt: resumeState.resumeSessionAt } : {}),
          turnCount: resumeState?.turnCount ?? 0,
        },
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      const context: ClaudeSessionContext = {
        session,
        promptQueue,
        query: queryRuntime,
        streamFiber: undefined,
        startedAt,
        basePermissionMode: permissionMode,
        currentApiModelId: apiModelId,
        currentEffort: effectiveEffort ?? undefined,
        resumeSessionId: sessionId,
        pendingApprovals,
        pendingUserInputs,
        turns: [],
        inFlightTools,
        claudeTasks,
        taskAgents,
        pendingTaskModels,
        workflowMemberFingerprints,
        liveTaskIds,
        turnState: undefined,
        lastKnownContextWindow: initialContextWindow,
        lastKnownTokenUsage: undefined,
        lastKnownTotalProcessedTokens: undefined,
        lastAssistantUuid: resumeState?.resumeSessionAt,
        lastThreadStartedId: undefined,
        stopped: false,
      };
      yield* Ref.set(contextRef, context);
      sessions.set(threadId, context);

      const sessionStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.started",
        eventId: sessionStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: sessionStartedStamp.createdAt,
        threadId,
        payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
        providerRefs: {},
      });

      const configuredStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.configured",
        eventId: configuredStamp.eventId,
        provider: PROVIDER,
        createdAt: configuredStamp.createdAt,
        threadId,
        payload: {
          config: {
            ...(apiModelId ? { model: apiModelId } : {}),
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(effectiveEffort ? { effort: effectiveEffort } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(fastMode ? { fastMode: true } : {}),
          },
        },
        providerRefs: {},
      });

      const readyStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "session.state.changed",
        eventId: readyStamp.eventId,
        provider: PROVIDER,
        createdAt: readyStamp.createdAt,
        threadId,
        payload: {
          state: "ready",
        },
        providerRefs: {},
      });

      let streamFiber: Fiber.Fiber<void, never>;
      streamFiber = runFork(
        Effect.exit(runSdkStream(context)).pipe(
          Effect.flatMap((exit) => {
            if (context.stopped) {
              return Effect.void;
            }
            if (context.streamFiber === streamFiber) {
              context.streamFiber = undefined;
            }
            return handleStreamExit(context, exit).pipe(
              Effect.catch((cause) =>
                Effect.logError("Failed to close Claude runtime stream.", { cause }),
              ),
            );
          }),
        ),
      );
      context.streamFiber = streamFiber;
      streamFiber.addObserver(() => {
        if (context.streamFiber === streamFiber) {
          context.streamFiber = undefined;
        }
      });

      return {
        ...session,
      };
    },
  );

  const sendTurn: ClaudeAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
    const context = yield* requireSession(input.threadId);
    const modelSelection =
      input.modelSelection !== undefined && input.modelSelection.instanceId === boundInstanceId
        ? input.modelSelection
        : undefined;

    // A sendTurn while a real turn is running is a steer: the message is
    // queued into the live SDK agent loop and the work continues as the same
    // turn — no synthetic turn boundary. Stale synthetic turns (from
    // background agent responses between user prompts) are auto-closed
    // instead, so they don't block the user's next turn.
    const steeringTurnState =
      context.turnState && context.turnState.synthetic !== true ? context.turnState : null;
    if (context.turnState && steeringTurnState === null) {
      yield* completeTurn(context, "completed");
    }

    if (modelSelection?.model) {
      const apiModelId = resolveClaudeApiModelId(modelSelection);
      if (context.currentApiModelId !== apiModelId) {
        yield* Effect.tryPromise({
          try: () => context.query.setModel(apiModelId),
          catch: (cause) => toRequestError(input.threadId, "turn/setModel", cause),
        });
        context.currentApiModelId = apiModelId;
      }
      context.session = {
        ...context.session,
        model: modelSelection.model,
      };
      const turnCaps = getClaudeModelCapabilities(modelSelection.model);
      const turnEffort = resolveClaudeEffort(
        turnCaps,
        getModelSelectionStringOptionValue(modelSelection, "effort"),
      );
      context.currentEffort =
        getEffectiveClaudeAgentEffort(turnEffort ?? null, modelSelection.model) ?? undefined;
    }

    // Apply interaction mode by switching the SDK's permission mode.
    // "plan" maps directly to the SDK's "plan" permission mode;
    // "default" restores the session's original permission mode.
    // When interactionMode is absent we leave the current mode unchanged.
    if (input.interactionMode === "plan") {
      yield* Effect.tryPromise({
        try: () => context.query.setPermissionMode("plan"),
        catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
      });
    } else if (input.interactionMode === "default") {
      yield* Effect.tryPromise({
        try: () => context.query.setPermissionMode(context.basePermissionMode ?? "default"),
        catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
      });
    }

    const turnId = steeringTurnState?.turnId ?? TurnId.make(yield* randomUUIDv4);
    if (steeringTurnState === null) {
      const turnState: ClaudeTurnState = {
        turnId,
        startedAt: yield* nowIso,
        items: [],
        assistantTextBlocks: new Map(),
        assistantTextBlockOrder: [],
        capturedProposedPlanKeys: new Set(),
        nextSyntheticAssistantBlockIndex: -1,
      };

      const updatedAt = yield* nowIso;
      context.turnState = turnState;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt,
      };

      const turnStartedStamp = yield* makeEventStamp();
      yield* offerRuntimeEvent({
        type: "turn.started",
        eventId: turnStartedStamp.eventId,
        provider: PROVIDER,
        createdAt: turnStartedStamp.createdAt,
        threadId: context.session.threadId,
        turnId,
        payload: modelSelection?.model ? { model: modelSelection.model } : {},
        providerRefs: {},
      });
    }

    const message = yield* buildUserMessageEffect(input, {
      fileSystem,
      attachmentsDir: serverConfig.attachmentsDir,
      boundInstanceId,
    });

    yield* Queue.offer(context.promptQueue, {
      type: "message",
      message,
    }).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/start", cause)));

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  });

  const interruptTurn: ClaudeAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
    function* (threadId, _turnId) {
      const context = yield* requireSession(threadId);
      // interrupt() can acknowledge while resumed background tasks keep the
      // CLI alive. Stop is a hard session boundary for Claude, so close the
      // query and let the SDK escalate to SIGKILL when graceful exit fails.
      yield* stopSessionInternal(context);
    },
  );

  const readThread: ClaudeAdapterShape["readThread"] = Effect.fn("readThread")(
    function* (threadId) {
      const context = yield* requireSession(threadId);
      return yield* snapshotThread(context);
    },
  );

  const rollbackThread: ClaudeAdapterShape["rollbackThread"] = Effect.fn("rollbackThread")(
    function* (threadId, numTurns) {
      const context = yield* requireSession(threadId);
      const nextLength = Math.max(0, context.turns.length - numTurns);
      context.turns.splice(nextLength);
      yield* updateResumeCursor(context);
      return yield* snapshotThread(context);
    },
  );

  const respondToRequest: ClaudeAdapterShape["respondToRequest"] = Effect.fn("respondToRequest")(
    function* (threadId, requestId, decision) {
      const context = yield* requireSession(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/requestApproval/decision",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }

      context.pendingApprovals.delete(requestId);
      yield* Deferred.succeed(pending.decision, decision);
    },
  );

  const respondToUserInput: ClaudeAdapterShape["respondToUserInput"] = Effect.fn(
    "respondToUserInput",
  )(function* (threadId, requestId, answers) {
    const context = yield* requireSession(threadId);
    const pending = context.pendingUserInputs.get(requestId);
    if (!pending) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "item/tool/respondToUserInput",
        detail: `Unknown pending user-input request: ${requestId}`,
      });
    }

    context.pendingUserInputs.delete(requestId);
    yield* Deferred.succeed(pending.answers, answers);
  });

  const stopSession: ClaudeAdapterShape["stopSession"] = Effect.fn("stopSession")(
    function* (threadId) {
      const context = yield* requireSession(threadId);
      yield* stopSessionInternal(context, {
        emitExitEvent: true,
      });
    },
  );

  const listSessions: ClaudeAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));

  const hasSession: ClaudeAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });

  const stopSessions = Effect.fn("stopSessions")(function* (
    contexts: ReadonlyArray<ClaudeSessionContext>,
    emitExitEvent: boolean,
  ) {
    const results = yield* Effect.forEach(contexts, (context) =>
      stopSessionInternal(context, { emitExitEvent }).pipe(Effect.result),
    );

    for (const result of results) {
      if (result._tag === "Failure") {
        return yield* Effect.fail(result.failure);
      }
    }
  });

  const stopAll: ClaudeAdapterShape["stopAll"] = () =>
    stopSessions(Array.from(sessions.values()), true);

  yield* Effect.addFinalizer(() =>
    stopSessions(Array.from(sessions.values()), false).pipe(
      Effect.catch((cause) =>
        Effect.logError("Failed to emit Claude session shutdown event.", { cause }),
      ),
      Effect.tap(() => Queue.shutdown(runtimeEventQueue)),
      Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    readThread,
    rollbackThread,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies ClaudeAdapterShape;
});
