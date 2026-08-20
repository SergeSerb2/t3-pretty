import { ApprovalRequestId, isToolLifecycleItemType } from "@t3tools/contracts";
import { extractGeneratedImagePath } from "@t3tools/shared/imageTool";
import type {
  OrchestrationLatestTurn,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ToolLifecycleItemType,
  TurnId,
  UserInputQuestion,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  buildToolCallDisplaySections,
  serializeToolCallDisplaySections,
} from "@t3tools/shared/shellCommandFormat";

import * as Arr from "effect/Array";
import * as Order from "effect/Order";

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: "command" | "file-read" | "file-change";
  readonly createdAt: string;
  readonly detail?: string;
}

export interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
}

export interface PendingUserInputDraftAnswer {
  readonly selectedOptionLabels?: ReadonlyArray<string>;
  readonly customAnswer?: string;
}

export interface ThreadFeedActivity {
  readonly id: string;
  readonly createdAt: string;
  readonly turnId: TurnId | null;
  readonly summary: string;
  readonly detail: string | null;
  readonly canExpand: boolean;
  readonly getFullDetail: () => string | null;
  readonly getCopyText: () => string;
  readonly icon:
    | "agent"
    | "alert"
    | "check"
    | "command"
    | "edit"
    | "eye"
    | "globe"
    | "hammer"
    | "image"
    | "message"
    | "package"
    | "warning"
    | "wrench"
    | "zap";
  readonly toolLike: boolean;
  readonly status: "success" | "failure" | "neutral" | null;
  readonly itemType?: ToolLifecycleItemType;
  readonly generatedImagePath?: string;
  readonly generatedImagePending?: boolean;
}

const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;

type WorkLogToolLifecycleStatus = "inProgress" | "completed" | "failed" | "declined" | "stopped";

interface WorkLogEntry {
  id: string;
  createdAt: string;
  turnId: TurnId | null;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  toolLifecycleStatus?: WorkLogToolLifecycleStatus;
  toolData?: unknown;
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  /** Grouping key for subagent lifecycle rows (one row per agent). */
  taskId?: string;
}

type RawThreadFeedEntry =
  | {
      readonly type: "message";
      readonly id: string;
      readonly createdAt: string;
      readonly message: OrchestrationThread["messages"][number];
    }
  | {
      readonly type: "activity";
      readonly id: string;
      readonly createdAt: string;
      readonly turnId: TurnId | null;
      readonly activity: ThreadFeedActivity;
    };

type MessageThreadFeedEntry = Extract<RawThreadFeedEntry, { readonly type: "message" }>;

export type ThreadFeedEntry =
  | Extract<RawThreadFeedEntry, { type: "message" }>
  | {
      readonly type: "working";
      readonly id: string;
      readonly createdAt: string;
    }
  | {
      readonly type: "activity-group";
      readonly id: string;
      readonly createdAt: string;
      readonly turnId: TurnId | null;
      readonly activities: ReadonlyArray<ThreadFeedActivity>;
    }
  | {
      readonly type: "work-toggle";
      readonly id: string;
      readonly createdAt: string;
      readonly turnId: TurnId | null;
      readonly groupId: string;
      readonly hiddenCount: number;
      readonly expanded: boolean;
      readonly onlyToolActivities: boolean;
    }
  | {
      readonly type: "turn-fold";
      readonly id: string;
      readonly createdAt: string;
      readonly turnId: TurnId;
      readonly label: string;
      readonly expanded: boolean;
    };

export type ThreadFeedLatestTurn = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function parseApprovalRequestId(value: unknown): ApprovalRequestId | null {
  return typeof value === "string" && value.length > 0 ? ApprovalRequestId.make(value) : null;
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }

  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const record = option as Record<string, unknown>;
          if (typeof record.label !== "string" || typeof record.description !== "string") {
            return null;
          }
          return {
            label: record.label,
            description: record.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);

  return parsed.length > 0 ? parsed : null;
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSelectedOptionLabels(
  value: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  );
}

function resolvePendingUserInputAnswer(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | ReadonlyArray<string> | null {
  const customAnswer = normalizeDraftAnswer(draft?.customAnswer);
  if (customAnswer) {
    return customAnswer;
  }

  const selectedOptionLabels = normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
  if (question.multiSelect) {
    return selectedOptionLabels.length > 0 ? selectedOptionLabels : null;
  }
  return selectedOptionLabels[0] ?? null;
}

/** Codex children settle via task.updated (idle/failed/interrupted), never
 * task.completed — these rows are mobile's only terminal signal for them. */
const MOBILE_TERMINAL_UPDATE_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function isTerminalBypassUpdate(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "task.updated") {
    return false;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return (
    payload?.timelineBypass === true &&
    typeof payload.status === "string" &&
    MOBILE_TERMINAL_UPDATE_STATUSES.has(payload.status)
  );
}

/**
 * Quiet-timeline guarantee (mirrors web's session-logic): agent-internal
 * activity lives in the Agents sheet, not the work log. Terminal rows are
 * kept — with no Agents surface on mobile they are the terminal signal
 * (a surface that hides rows must keep its own terminal signal). That means
 * task.completed (Claude) AND terminal bypassed task.updated (Codex, whose
 * children never emit task.completed — review finding).
 */
function isAgentInternalActivity(activity: OrchestrationThreadActivity): boolean {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return false;
  }
  const isTerminalTaskRow = activity.kind === "task.completed" || isTerminalBypassUpdate(activity);
  if (payload.timelineBypass === true && !isTerminalTaskRow) {
    return true;
  }
  // agentId marks ownership, not "hide me": a NESTED AGENT's terminal row is
  // the only signal mobile gets (no Agents sheet), so it stays. Only an
  // agent's own background work (stamped "background") is internal — same
  // rule as web (review finding: hiding on agentId alone dropped nested
  // completions with no replacement UI).
  const ownedByAgent = typeof payload.agentId === "string" && payload.agentId.trim().length > 0;
  if (!ownedByAgent) {
    return false;
  }
  return !(isTerminalTaskRow && payload.agentKind === "agent");
}

/** Per-activity work-log derivation; null for rows the work log drops. */
function deriveWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry | null {
  if (activity.kind === "tool.started") return null;
  if (activity.kind === "task.started") return null;
  // Terminal bypassed updates pass: Codex children's only terminal signal.
  if (activity.kind === "task.updated" && !isTerminalBypassUpdate(activity)) return null;
  if (activity.kind === "tool.progress") return null;
  if (activity.kind === "context-window.updated") return null;
  if (activity.summary === "Checkpoint captured") return null;
  if (isPlanBoundaryToolActivity(activity)) return null;
  if (isAgentInternalActivity(activity)) return null;
  return toDerivedWorkLogEntry(activity);
}

function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): DerivedWorkLogEntry[] {
  const ordered = Arr.sort(activities, activityOrder);
  const entries: DerivedWorkLogEntry[] = [];
  for (const activity of ordered) {
    const entry = deriveWorkLogEntry(activity);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return collapseDerivedWorkLogEntries(entries);
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const commandPreview = extractToolCommand(payload);
  const changedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  // task.updated included: terminal bypassed updates (Codex children's only
  // terminal signal) must carry task identity so they collapse per child
  // instead of stacking anonymous "Task idle" rows.
  const isTaskActivity =
    activity.kind === "task.progress" ||
    activity.kind === "task.completed" ||
    activity.kind === "task.updated";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const taskId =
    isTaskActivity && typeof payload?.taskId === "string" && payload.taskId.length > 0
      ? payload.taskId
      : undefined;
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    ...(taskId ? { taskId } : {}),
    label: taskLabel || activity.summary,
    tone:
      activity.kind === "task.progress"
        ? "thinking"
        : activity.tone === "approval"
          ? "info"
          : activity.tone,
    activityKind: activity.kind,
  };
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  if (
    !taskDetailAsLabel &&
    payload &&
    typeof payload.detail === "string" &&
    payload.detail.length > 0
  ) {
    const detail = stripTrailingExitCode(payload.detail).output;
    if (detail) {
      entry.detail = detail;
    }
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (itemType === "mcp_tool_call") {
    const data = asRecord(payload?.data);
    if (data?.item !== undefined) {
      entry.toolData = data.item;
    }
  }
  if (itemType === "image_generation") {
    const data = asRecord(payload?.data);
    if (data !== undefined) {
      entry.toolData = data;
    }
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  let toolLifecycleStatus = extractWorkLogToolLifecycleStatus(payload);
  if (!toolLifecycleStatus && activity.kind === "tool.completed") {
    toolLifecycleStatus = "completed";
  }
  if (toolLifecycleStatus) {
    entry.toolLifecycleStatus = toolLifecycleStatus;
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) {
    entry.collapseKey = collapseKey;
  }
  return entry;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  // Subagent rows collapse by identity, not adjacency (quiet-timeline
  // guarantee; mirrors web's session-logic).
  const taskRowIndex = new Map<string, number>();
  for (const entry of entries) {
    appendCollapsedWorkLogEntry(collapsed, taskRowIndex, entry);
  }
  return collapsed;
}

/** One fold step of `collapseDerivedWorkLogEntries`, shared with the incremental feed cache. */
function appendCollapsedWorkLogEntry(
  collapsed: DerivedWorkLogEntry[],
  taskRowIndex: Map<string, number>,
  entry: DerivedWorkLogEntry,
): void {
  const isTaskRow =
    entry.taskId !== undefined &&
    (entry.activityKind === "task.progress" ||
      entry.activityKind === "task.completed" ||
      entry.activityKind === "task.updated");
  if (isTaskRow && entry.taskId !== undefined) {
    const existingIndex = taskRowIndex.get(entry.taskId);
    if (existingIndex !== undefined) {
      collapsed[existingIndex] = mergeDerivedWorkLogEntries(collapsed[existingIndex]!, entry);
      return;
    }
    taskRowIndex.set(entry.taskId, collapsed.length);
    collapsed.push(entry);
    return;
  }
  const previous = collapsed.at(-1);
  if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
    collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
    return;
  }
  collapsed.push(entry);
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (previous.activityKind !== "tool.updated" && previous.activityKind !== "tool.completed") {
    return false;
  }
  if (next.activityKind !== "tool.updated" && next.activityKind !== "tool.completed") {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  return previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey;
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolLifecycleStatus = next.toolLifecycleStatus ?? previous.toolLifecycleStatus;
  const toolData = next.toolData ?? previous.toolData;
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolLifecycleStatus ? { toolLifecycleStatus } : {}),
    ...(toolData !== undefined ? { toolData } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (entry.activityKind !== "tool.updated" && entry.activityKind !== "tool.completed") {
    return undefined;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  if (entry.tone === "tool" || entry.tone === "thinking" || entry.tone === "error") {
    return true;
  }
  if (entry.command !== undefined && entry.command.trim().length > 0) {
    return true;
  }
  if (entry.requestKind !== undefined) {
    return true;
  }
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType);
}

function toolDetailTextLooksLikeFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("file not found") ||
    normalized.includes("no files found") ||
    normalized.includes("enoent") ||
    normalized.includes("no such file or directory") ||
    normalized.includes("no such file") ||
    normalized.includes("commandnotfoundexception") ||
    normalized.includes("command not found") ||
    (normalized.includes("cannot find path") && normalized.includes("because it does not exist")) ||
    (normalized.includes("is not recognized") && normalized.includes("the term '")) ||
    normalized.includes("is not recognized as the name of a cmdlet") ||
    normalized.includes("a parameter cannot be found that matches parameter name") ||
    /<exited with exit code\s+[1-9]\d*\s*>/i.test(text) ||
    /exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text) ||
    /exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text)
  );
}

function workEntryIndicatesToolFailure(entry: WorkLogEntry): boolean {
  if (entry.tone === "error") {
    return true;
  }
  if (entry.toolLifecycleStatus === "failed" || entry.toolLifecycleStatus === "declined") {
    return true;
  }
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  return toolDetailTextLooksLikeFailure([entry.detail, entry.command].filter(Boolean).join("\n"));
}

function workEntryIndicatesToolSuccess(entry: WorkLogEntry): boolean {
  if (!workLogEntryIsToolLike(entry) || workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (entry.tone === "thinking") {
    return false;
  }
  return (
    entry.toolLifecycleStatus !== "inProgress" &&
    entry.toolLifecycleStatus !== "stopped" &&
    entry.toolLifecycleStatus !== "failed" &&
    entry.toolLifecycleStatus !== "declined"
  );
}

function workEntryStatus(entry: WorkLogEntry): ThreadFeedActivity["status"] {
  if (!workLogEntryIsToolLike(entry)) {
    return null;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return "failure";
  }
  if (workEntryIndicatesToolSuccess(entry)) {
    return "success";
  }
  return "neutral";
}

function workEntryIcon(entry: DerivedWorkLogEntry): ThreadFeedActivity["icon"] {
  if (
    entry.activityKind === "user-input.requested" ||
    entry.activityKind === "user-input.resolved"
  ) {
    return "message";
  }
  if (entry.activityKind === "runtime.warning") return "warning";
  if (entry.requestKind === "command") return "command";
  if (entry.requestKind === "file-read") return "eye";
  if (entry.requestKind === "file-change") return "edit";
  if (entry.itemType === "command_execution" || entry.command) return "command";
  if (entry.itemType === "file_change" || (entry.changedFiles?.length ?? 0) > 0) return "edit";
  if (entry.itemType === "web_search") return "globe";
  if (entry.itemType === "image_view") return "eye";
  if (entry.itemType === "image_generation") return "image";
  if (entry.itemType === "mcp_tool_call") return "wrench";
  if (entry.itemType === "skill_load") return "package";
  if (entry.itemType === "dynamic_tool_call" || entry.itemType === "collab_agent_tool_call") {
    return "hammer";
  }
  if (entry.tone === "error") return "alert";
  if (entry.tone === "thinking") return "agent";
  if (entry.tone === "info") return "check";
  return "zap";
}

function buildWorkEntryExpandedBody(entry: WorkLogEntry): string | null {
  const mcpText =
    entry.itemType === "mcp_tool_call" && entry.toolData !== undefined
      ? `MCP call\n${JSON.stringify(entry.toolData, null, 2)}`
      : null;
  return serializeToolCallDisplaySections(
    buildToolCallDisplaySections({
      leadingText: mcpText,
      command: entry.rawCommand ?? entry.command,
      output: entry.detail,
      trailingText: (entry.changedFiles?.length ?? 0) > 0 ? entry.changedFiles!.join("\n") : null,
    }),
  );
}

function workEntryHasExpandedBody(entry: WorkLogEntry): boolean {
  return (
    (entry.itemType === "mcp_tool_call" && entry.toolData !== undefined) ||
    Boolean((entry.rawCommand ?? entry.command)?.trim()) ||
    Boolean(entry.detail?.trim()) ||
    (entry.changedFiles?.some((path) => path.trim().length > 0) ?? false)
  );
}

function memoizeValue<T>(build: () => T): () => T {
  let value: T;
  let initialized = false;
  return () => {
    if (!initialized) {
      value = build();
      initialized = true;
    }
    return value;
  };
}

function workEntryPreview(
  workEntry: Pick<WorkLogEntry, "detail" | "command" | "changedFiles">,
): string | null {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  return workEntry.changedFiles!.length === 1
    ? firstPath
    : `${firstPath} +${workEntry.changedFiles!.length - 1} more`;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function workEntryHeading(workEntry: WorkLogEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts: Array<string> = [];
  for (const entry of value) {
    const part = asTrimmedString(entry);
    if (part !== null) {
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function extractWorkLogToolLifecycleStatus(
  payload: Record<string, unknown> | null,
): WorkLogToolLifecycleStatus | undefined {
  const status = payload?.status;
  if (
    status === "inProgress" ||
    status === "completed" ||
    status === "failed" ||
    status === "declined" ||
    status === "stopped"
  ) {
    return status;
  }
  return undefined;
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.savedPath);
  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
    "locations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

const activityOrder = Order.combineAll<OrchestrationThreadActivity>([
  Order.mapInput(Order.Number, (activity) => activity.sequence ?? Number.MAX_SAFE_INTEGER),
  Order.mapInput(Order.String, (activity) => activity.createdAt),
  Order.mapInput(Order.Number, (activity) => compareActivityLifecycleRank(activity.kind)),
  Order.mapInput(Order.String, (activity) => activity.id),
]);

function isEmptyMessage(entry: RawThreadFeedEntry): boolean {
  if (entry.type !== "message") {
    return false;
  }
  const hasText = entry.message.text.trim().length > 0;
  const hasAttachments = (entry.message.attachments ?? []).length > 0;
  return !hasText && !hasAttachments;
}

function groupAdjacentActivities(entries: ReadonlyArray<RawThreadFeedEntry>): ThreadFeedEntry[] {
  const grouped: ThreadFeedEntry[] = [];
  // Mutable backing array for the trailing group so appending an activity is
  // O(1) instead of re-copying the group (which made this loop quadratic on
  // long tool runs). The array is only mutated while it is the trailing group.
  let openGroupActivities: ThreadFeedActivity[] | null = null;
  let openGroupTurnId: TurnId | null = null;

  for (const entry of entries) {
    // Skip empty messages so they don't break activity grouping.
    if (isEmptyMessage(entry)) {
      continue;
    }

    if (entry.type !== "activity") {
      grouped.push(entry);
      openGroupActivities = null;
      continue;
    }

    if (openGroupActivities !== null && openGroupTurnId === entry.turnId) {
      openGroupActivities.push(entry.activity);
      continue;
    }

    openGroupActivities = [entry.activity];
    openGroupTurnId = entry.turnId;
    grouped.push({
      type: "activity-group",
      id: entry.id,
      createdAt: entry.createdAt,
      turnId: entry.turnId,
      activities: openGroupActivities,
    });
  }

  return grouped;
}

function computeElapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs)) return b;
  if (!Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

function deriveUnsettledTurnId(latestTurn: ThreadFeedLatestTurn | null): TurnId | null {
  if (!latestTurn) {
    return null;
  }
  const settled = latestTurn.completedAt !== null && latestTurn.state !== "running";
  return settled ? null : latestTurn.turnId;
}

interface ThreadFeedTurnFold {
  readonly turnId: TurnId;
  readonly createdAt: string;
  readonly hiddenEntryIds: ReadonlySet<string>;
  readonly label: string;
}

function deriveThreadFeedTurnFolds(
  feed: ReadonlyArray<ThreadFeedEntry>,
  latestTurn: ThreadFeedLatestTurn | null,
): ReadonlyMap<string, ThreadFeedTurnFold> {
  const terminalAssistantMessageIdByTurn = new Map<TurnId, string>();
  for (const entry of feed) {
    if (entry.type === "message" && entry.message.role === "assistant" && entry.message.turnId) {
      terminalAssistantMessageIdByTurn.set(entry.message.turnId, entry.id);
    }
  }

  interface TurnGroup {
    readonly entries: ThreadFeedEntry[];
    readonly startBoundary: string | null;
  }
  const groupsByTurnId = new Map<TurnId, TurnGroup>();
  let pendingUserBoundary: string | null = null;
  for (const entry of feed) {
    if (entry.type === "message" && entry.message.role === "user") {
      pendingUserBoundary = entry.message.createdAt;
      continue;
    }
    const turnId =
      entry.type === "message" && entry.message.role === "assistant"
        ? entry.message.turnId
        : entry.type === "activity-group"
          ? entry.turnId
          : null;
    if (!turnId) {
      continue;
    }
    let group = groupsByTurnId.get(turnId);
    if (!group) {
      group = {
        entries: [],
        startBoundary: pendingUserBoundary,
      };
      pendingUserBoundary = null;
      groupsByTurnId.set(turnId, group);
    }
    group.entries.push(entry);
  }

  const unsettledTurnId = deriveUnsettledTurnId(latestTurn);
  const foldsByAnchorId = new Map<string, ThreadFeedTurnFold>();
  for (const [turnId, group] of groupsByTurnId) {
    const { entries } = group;
    if (turnId === unsettledTurnId) {
      continue;
    }
    if (entries.some((entry) => entry.type === "message" && entry.message.streaming)) {
      continue;
    }

    const terminalAssistantMessageId = terminalAssistantMessageIdByTurn.get(turnId);
    const hiddenEntryIds = new Set(
      entries.filter((entry) => entry.id !== terminalAssistantMessageId).map((entry) => entry.id),
    );
    if (hiddenEntryIds.size === 0) {
      continue;
    }

    const firstEntry = entries[0];
    const lastEntry = entries.at(-1);
    if (!firstEntry || !lastEntry) {
      continue;
    }
    const terminalEntry = terminalAssistantMessageId
      ? entries.find((entry) => entry.id === terminalAssistantMessageId)
      : null;
    const latestTurnMatches = latestTurn?.turnId === turnId;
    const lastEntryEnd =
      lastEntry.type === "message" ? lastEntry.message.updatedAt : lastEntry.createdAt;
    const elapsedMs =
      latestTurnMatches && latestTurn.startedAt && latestTurn.completedAt
        ? computeElapsedMs(latestTurn.startedAt, latestTurn.completedAt)
        : computeElapsedMs(
            group.startBoundary ?? firstEntry.createdAt,
            maxIsoTimestamp(
              terminalEntry?.type === "message" ? terminalEntry.message.updatedAt : null,
              lastEntryEnd,
            ) ?? lastEntryEnd,
          );
    const duration = elapsedMs === null ? null : formatDuration(elapsedMs);
    const interrupted = latestTurnMatches && latestTurn.state === "interrupted";
    const label = interrupted
      ? duration
        ? `You stopped after ${duration}`
        : "You stopped this response"
      : duration
        ? `Worked for ${duration}`
        : "Worked";

    foldsByAnchorId.set(firstEntry.id, {
      turnId,
      createdAt: firstEntry.createdAt,
      hiddenEntryIds,
      label,
    });
  }
  return foldsByAnchorId;
}

export function deriveThreadFeedPresentation(
  feed: ReadonlyArray<ThreadFeedEntry>,
  latestTurn: ThreadFeedLatestTurn | null,
  expandedTurnIds: ReadonlySet<TurnId>,
  expandedWorkGroupIds: ReadonlySet<string> = new Set(),
  activeWorkStartedAt: string | null = null,
): ThreadFeedEntry[] {
  const sourceFeed = feed.filter(
    (entry) =>
      entry.type !== "turn-fold" && entry.type !== "work-toggle" && entry.type !== "working",
  );
  const foldsByAnchorId = deriveThreadFeedTurnFolds(sourceFeed, latestTurn);
  const collapsedEntryIds = new Set<string>();
  for (const fold of foldsByAnchorId.values()) {
    if (!expandedTurnIds.has(fold.turnId)) {
      for (const entryId of fold.hiddenEntryIds) {
        collapsedEntryIds.add(entryId);
      }
    }
  }

  const result: ThreadFeedEntry[] = [];
  for (const entry of sourceFeed) {
    const fold = foldsByAnchorId.get(entry.id);
    if (fold) {
      result.push(presentedTurnFoldEntry(entry, fold, expandedTurnIds.has(fold.turnId)));
    }
    if (!collapsedEntryIds.has(entry.id)) {
      appendPresentedFeedEntry(result, entry, expandedWorkGroupIds);
    }
  }
  if (activeWorkStartedAt !== null) {
    result.push(presentedWorkingEntry(activeWorkStartedAt));
  }
  return result;
}

// Presented rows are minted per call below, but LegendList re-runs row bodies
// for rows whose object identity changed, so each shaped row is cached against
// its source entry plus the inputs that shape it; unchanged inputs reuse the
// previous object. Feed entries are immutable, so WeakMap-keyed caches stay
// valid (and collect) with their source.

type ActivityGroupFeedEntry = Extract<ThreadFeedEntry, { readonly type: "activity-group" }>;
type WorkToggleFeedEntry = Extract<ThreadFeedEntry, { readonly type: "work-toggle" }>;
type TurnFoldFeedEntry = Extract<ThreadFeedEntry, { readonly type: "turn-fold" }>;
type WorkingFeedEntry = Extract<ThreadFeedEntry, { readonly type: "working" }>;

interface PresentedActivityGroup {
  readonly visibleActivities: ReadonlyArray<ThreadFeedActivity>;
  readonly collapsed: ActivityGroupFeedEntry;
  collapsedToggle?: WorkToggleFeedEntry;
  expandedToggle?: WorkToggleFeedEntry;
}

const presentedActivityGroupCache = new WeakMap<ActivityGroupFeedEntry, PresentedActivityGroup>();
const presentedSingleActivityGroupCache = new WeakMap<ThreadFeedActivity, ActivityGroupFeedEntry>();

interface PresentedTurnFold {
  readonly turnId: TurnId;
  readonly createdAt: string;
  readonly label: string;
  collapsedEntry?: TurnFoldFeedEntry;
  expandedEntry?: TurnFoldFeedEntry;
}

const presentedTurnFoldCache = new WeakMap<ThreadFeedEntry, PresentedTurnFold>();
let presentedWorkingRow: { readonly startedAt: string; readonly entry: WorkingFeedEntry } | null =
  null;

function presentedTurnFoldEntry(
  anchor: ThreadFeedEntry,
  fold: ThreadFeedTurnFold,
  expanded: boolean,
): TurnFoldFeedEntry {
  let cached = presentedTurnFoldCache.get(anchor);
  if (
    cached === undefined ||
    cached.turnId !== fold.turnId ||
    cached.createdAt !== fold.createdAt ||
    cached.label !== fold.label
  ) {
    cached = { turnId: fold.turnId, createdAt: fold.createdAt, label: fold.label };
    presentedTurnFoldCache.set(anchor, cached);
  }
  const cachedEntry = expanded ? cached.expandedEntry : cached.collapsedEntry;
  if (cachedEntry !== undefined) {
    return cachedEntry;
  }
  const entry: TurnFoldFeedEntry = {
    type: "turn-fold",
    id: `turn-fold:${fold.turnId}`,
    createdAt: fold.createdAt,
    turnId: fold.turnId,
    label: fold.label,
    expanded,
  };
  if (expanded) {
    cached.expandedEntry = entry;
  } else {
    cached.collapsedEntry = entry;
  }
  return entry;
}

function presentedWorkingEntry(startedAt: string): WorkingFeedEntry {
  if (presentedWorkingRow?.startedAt !== startedAt) {
    presentedWorkingRow = {
      startedAt,
      entry: { type: "working", id: "working-indicator-row", createdAt: startedAt },
    };
  }
  return presentedWorkingRow.entry;
}

function appendPresentedFeedEntry(
  result: ThreadFeedEntry[],
  entry: Exclude<ThreadFeedEntry, { readonly type: "turn-fold" | "work-toggle" | "working" }>,
  expandedWorkGroupIds: ReadonlySet<string>,
): void {
  if (entry.type !== "activity-group") {
    result.push(entry);
    return;
  }

  let presented = presentedActivityGroupCache.get(entry);
  if (presented === undefined) {
    const visibleActivities = entry.activities.filter(
      (activity) => !(activity.toolLike && activity.status === "neutral"),
    );
    presented = {
      visibleActivities,
      collapsed:
        visibleActivities.length === entry.activities.length
          ? entry
          : { ...entry, activities: visibleActivities },
    };
    presentedActivityGroupCache.set(entry, presented);
  }
  const activities = presented.visibleActivities;
  if (activities.length === 0) {
    return;
  }
  if (activities.length <= MAX_VISIBLE_WORK_LOG_ENTRIES) {
    result.push(presented.collapsed);
    return;
  }

  const groupId = entry.id;
  const expanded = expandedWorkGroupIds.has(groupId);
  const overflowCandidates = activities.filter(
    (activity) => activity.itemType !== "image_generation",
  );
  const hiddenActivities = overflowCandidates.slice(0, -MAX_VISIBLE_WORK_LOG_ENTRIES);
  const hiddenIds = new Set(hiddenActivities.map((activity) => activity.id));
  const visibleActivities = expanded
    ? activities
    : activities.filter(
        (activity) => activity.itemType === "image_generation" || !hiddenIds.has(activity.id),
      );

  for (const activity of visibleActivities) {
    let single = presentedSingleActivityGroupCache.get(activity);
    if (single === undefined) {
      single = {
        type: "activity-group",
        id: activity.id,
        createdAt: activity.createdAt,
        turnId: activity.turnId,
        activities: [activity],
      };
      presentedSingleActivityGroupCache.set(activity, single);
    }
    result.push(single);
  }
  if (hiddenActivities.length === 0) {
    return;
  }
  let toggle = expanded ? presented.expandedToggle : presented.collapsedToggle;
  if (toggle === undefined) {
    toggle = {
      type: "work-toggle",
      id: `work-toggle:${groupId}`,
      createdAt: entry.createdAt,
      turnId: entry.turnId,
      groupId,
      hiddenCount: hiddenActivities.length,
      expanded,
      onlyToolActivities: activities.every((activity) => activity.toolLike),
    };
    if (expanded) {
      presented.expandedToggle = toggle;
    } else {
      presented.collapsedToggle = toggle;
    }
  }
  result.push(toggle);
}

/**
 * Sorts activities into lifecycle order. `derivePendingApprovals` and
 * `derivePendingUserInputs` both expect this ordering; sorting once and
 * passing the result to both avoids re-sorting the full activity history
 * per derivation.
 */
export function sortThreadActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  return Arr.sort(activities, activityOrder);
}

export function derivePendingApprovals(
  sortedActivities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();

  for (const activity of sortedActivities) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = parseApprovalRequestId(payload?.requestId);
    const requestKind =
      payload?.requestKind === "command" ||
      payload?.requestKind === "file-read" ||
      payload?.requestKind === "file-change"
        ? payload.requestKind
        : requestKindFromRequestType(payload?.requestType);
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return Arr.sortWith([...openByRequestId.values()], (s) => new Date(s.createdAt), Order.Date);
}

export function derivePendingUserInputs(
  sortedActivities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();

  for (const activity of sortedActivities) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = parseApprovalRequestId(payload?.requestId);
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return Arr.sortWith(openByRequestId.values(), (s) => new Date(s.createdAt), Order.Date);
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  const selectedOptionLabels =
    customAnswer.trim().length > 0
      ? undefined
      : normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
  return {
    customAnswer,
    ...(selectedOptionLabels && selectedOptionLabels.length > 0 ? { selectedOptionLabels } : {}),
  };
}

export function isPendingUserInputOptionSelected(
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
): boolean {
  if (normalizeDraftAnswer(draft?.customAnswer)) {
    return false;
  }

  return normalizeSelectedOptionLabels(draft?.selectedOptionLabels).includes(optionLabel.trim());
}

export function togglePendingUserInputOptionSelection(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
): PendingUserInputDraftAnswer {
  const normalizedOptionLabel = optionLabel.trim();

  if (question.multiSelect) {
    const selectedOptionLabels = normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
    const nextSelectedOptionLabels = selectedOptionLabels.includes(normalizedOptionLabel)
      ? selectedOptionLabels.filter((label) => label !== normalizedOptionLabel)
      : [...selectedOptionLabels, normalizedOptionLabel];

    return {
      customAnswer: "",
      ...(nextSelectedOptionLabels.length > 0
        ? { selectedOptionLabels: nextSelectedOptionLabels }
        : {}),
    };
  }

  return {
    customAnswer: "",
    selectedOptionLabels: [normalizedOptionLabel],
  };
}

export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): Record<string, string | ReadonlyArray<string>> | null {
  const answers: Record<string, string | ReadonlyArray<string>> = {};

  for (const question of questions) {
    const answer = resolvePendingUserInputAnswer(question, draftAnswers[question.id]);
    if (!answer) {
      return null;
    }
    answers[question.id] = answer;
  }

  return answers;
}

type ThreadFeedSource = Pick<OrchestrationThread, "messages" | "activities">;

type BuildThreadFeedOptions = {
  readonly loadedMessages?: ReadonlyArray<OrchestrationThread["messages"][number]>;
};

// Date.parse matches the previous Order.Date/new Date comparison exactly
// (getTime; invalid timestamps are NaN and order first) without allocating a
// Date per comparison.
const rawThreadFeedEntryCreatedAtOrder = Order.mapInput(Order.Number, (entry: RawThreadFeedEntry) =>
  Date.parse(entry.createdAt),
);

function buildMessageFeedEntries(
  messages: ReadonlyArray<OrchestrationThread["messages"][number]>,
): ReadonlyArray<MessageThreadFeedEntry> {
  const entries = messages.map<MessageThreadFeedEntry>((message) => ({
    type: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
  }));
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous && current && rawThreadFeedEntryCreatedAtOrder(previous, current) > 0) {
      return Arr.sort(entries, rawThreadFeedEntryCreatedAtOrder);
    }
  }
  return entries;
}

interface MessageFeedEntryCache {
  readonly entries: ReadonlyArray<MessageThreadFeedEntry>;
  readonly sortedIndexById: ReadonlyMap<string, number>;
}

interface IncrementalMessageFeedEntryUpdate {
  readonly cache: MessageFeedEntryCache;
  readonly changedEntries: ReadonlyArray<MessageThreadFeedEntry>;
  readonly visibilityChanged: boolean;
}

function buildMessageFeedEntryCache(
  messages: ReadonlyArray<OrchestrationThread["messages"][number]>,
): MessageFeedEntryCache {
  const entries = buildMessageFeedEntries(messages);
  return {
    entries,
    sortedIndexById: new Map(entries.map((entry, index) => [entry.id, index])),
  };
}

/**
 * Reuses sorted entry wrappers when the source topology is unchanged. Message
 * ids and timestamps define sort/group placement, while object identity tells
 * us exactly which immutable message payloads the reducer replaced.
 */
function updateMessageFeedEntryCache(
  messages: ReadonlyArray<OrchestrationThread["messages"][number]>,
  previousMessages: ReadonlyArray<OrchestrationThread["messages"][number]>,
  previousCache: MessageFeedEntryCache,
): IncrementalMessageFeedEntryUpdate | null {
  if (
    messages.length !== previousMessages.length ||
    previousCache.sortedIndexById.size !== previousCache.entries.length
  ) {
    return null;
  }

  let nextEntries: MessageThreadFeedEntry[] | null = null;
  const changedEntries: MessageThreadFeedEntry[] = [];
  let visibilityChanged = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const previousMessage = previousMessages[index];
    if (
      !message ||
      !previousMessage ||
      message.id !== previousMessage.id ||
      message.createdAt !== previousMessage.createdAt
    ) {
      // Reorders, inserts, removals, and timestamp corrections can all change
      // stable sort order, so let the full builder handle them.
      return null;
    }

    const sortedIndex = previousCache.sortedIndexById.get(message.id);
    if (sortedIndex === undefined) {
      return null;
    }
    const previousEntry = previousCache.entries[sortedIndex];
    if (!previousEntry || previousEntry.id !== message.id) {
      return null;
    }
    if (message === previousEntry.message) {
      continue;
    }

    const nextEntry: MessageThreadFeedEntry = {
      type: "message",
      id: message.id,
      createdAt: message.createdAt,
      message,
    };
    nextEntries ??= previousCache.entries.slice();
    nextEntries[sortedIndex] = nextEntry;
    changedEntries.push(nextEntry);
    visibilityChanged ||= isEmptyMessage(previousEntry) !== isEmptyMessage(nextEntry);
  }

  return {
    cache:
      nextEntries === null
        ? previousCache
        : {
            entries: nextEntries,
            sortedIndexById: previousCache.sortedIndexById,
          },
    changedEntries,
    visibilityChanged,
  };
}

function toActivityFeedEntry(entry: DerivedWorkLogEntry): RawThreadFeedEntry {
  const summary = workEntryHeading(entry);
  const detail = workEntryPreview(entry);
  const generatedImagePath =
    entry.itemType === "image_generation"
      ? extractGeneratedImagePath({
          changedFiles: entry.changedFiles,
          detail: entry.detail,
          data: entry.toolData,
        })
      : undefined;
  const status = workEntryStatus(entry);
  const generatedImagePending =
    entry.itemType === "image_generation" &&
    generatedImagePath === undefined &&
    status !== "success" &&
    status !== "failure";
  const getFullDetail = memoizeValue(() => buildWorkEntryExpandedBody(entry));
  const getCopyText = memoizeValue(() =>
    [summary, detail, getFullDetail()]
      .filter((value, index, values): value is string => {
        return Boolean(value) && values.indexOf(value) === index;
      })
      .join("\n"),
  );
  return {
    type: "activity",
    id: entry.id,
    createdAt: entry.createdAt,
    turnId: entry.turnId,
    activity: {
      id: entry.id,
      createdAt: entry.createdAt,
      turnId: entry.turnId,
      summary,
      detail,
      canExpand: workEntryHasExpandedBody(entry),
      getFullDetail,
      getCopyText,
      icon: workEntryIcon(entry),
      toolLike: workLogEntryIsToolLike(entry),
      status,
      ...(entry.itemType ? { itemType: entry.itemType } : {}),
      ...(generatedImagePath ? { generatedImagePath } : {}),
      ...(generatedImagePending ? { generatedImagePending: true } : {}),
    },
  };
}

function buildActivityFeedEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<RawThreadFeedEntry> {
  return Arr.sort(
    deriveWorkLogEntries(activities).map(toActivityFeedEntry),
    rawThreadFeedEntryCreatedAtOrder,
  );
}

interface ActivityFeedSlot {
  readonly derived: DerivedWorkLogEntry;
  readonly feedEntry: RawThreadFeedEntry;
  readonly createdAtMs: number;
}

interface ActivityFeedEntryCache {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  // Activities are immutable, so an unchanged reference always reuses its
  // derived entry. Weak keys let evicted thread state garbage-collect.
  readonly derivedByActivity: WeakMap<OrchestrationThreadActivity, DerivedWorkLogEntry | null>;
  // Collapse order (taskRowIndex points here); `entries` is the same rows in
  // final createdAt order.
  readonly slots: ReadonlyArray<ActivityFeedSlot>;
  readonly taskRowIndex: ReadonlyMap<string, number>;
  // Greatest kept row in fold order; the append boundary check compares
  // against this, not the array tail.
  readonly lastKeptActivity: OrchestrationThreadActivity | null;
  readonly entries: ReadonlyArray<RawThreadFeedEntry>;
}

function makeActivityFeedSlot(derived: DerivedWorkLogEntry): ActivityFeedSlot {
  return {
    derived,
    feedEntry: toActivityFeedEntry(derived),
    createdAtMs: Date.parse(derived.createdAt),
  };
}

const activityFeedSlotOrder = Order.mapInput(
  Order.Number,
  (slot: ActivityFeedSlot) => slot.createdAtMs,
);

// The createdAt re-sort is almost always a no-op on an incrementally extended
// feed; scan (NaN-safe: NaN never satisfies `<=`, forcing the sort, which
// orders it first — the same as the stateless builder) before paying for it.
function sortActivityFeedSlots(
  slots: ReadonlyArray<ActivityFeedSlot>,
): ReadonlyArray<ActivityFeedSlot> {
  for (let index = 1; index < slots.length; index += 1) {
    if (!(slots[index - 1]!.createdAtMs <= slots[index]!.createdAtMs)) {
      return Arr.sort(slots, activityFeedSlotOrder);
    }
  }
  return slots;
}

function buildActivityFeedEntryCache(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  derivedByActivity: WeakMap<
    OrchestrationThreadActivity,
    DerivedWorkLogEntry | null
  > = new WeakMap(),
): ActivityFeedEntryCache {
  const ordered = Arr.sort(activities, activityOrder);
  const collapsed: DerivedWorkLogEntry[] = [];
  const taskRowIndex = new Map<string, number>();
  let lastKeptActivity: OrchestrationThreadActivity | null = null;
  for (const activity of ordered) {
    let derived = derivedByActivity.get(activity);
    if (derived === undefined) {
      derived = deriveWorkLogEntry(activity);
      derivedByActivity.set(activity, derived);
    }
    if (derived === null) {
      continue;
    }
    lastKeptActivity = activity;
    appendCollapsedWorkLogEntry(collapsed, taskRowIndex, derived);
  }
  const slots = collapsed.map(makeActivityFeedSlot);
  return {
    activities,
    derivedByActivity,
    slots,
    taskRowIndex,
    lastKeptActivity,
    entries: sortActivityFeedSlots(slots).map((slot) => slot.feedEntry),
  };
}

/**
 * Incremental counterpart to `buildActivityFeedEntryCache`: replays the
 * collapse fold over only the appended suffix, deriving each new activity
 * once. Returns null on any topology change the fold cannot replay — a kept
 * row removed, replaced, or arriving out of order — so the caller rebuilds in
 * full. Rows the work log drops may legitimately vanish mid-array (the
 * reducer supersedes context-window updates); they never shaped the output,
 * so their removal is replay-safe.
 */
function updateActivityFeedEntryCache(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  previousCache: ActivityFeedEntryCache,
): ActivityFeedEntryCache | null {
  const previousActivities = previousCache.activities;
  let previousIndex = 0;
  let newIndex = 0;
  while (previousIndex < previousActivities.length) {
    const previousActivity = previousActivities[previousIndex]!;
    if (newIndex < activities.length && activities[newIndex] === previousActivity) {
      previousIndex += 1;
      newIndex += 1;
      continue;
    }
    if (previousCache.derivedByActivity.get(previousActivity) === null) {
      previousIndex += 1;
      continue;
    }
    return null;
  }

  // Copy-on-write: a mid-suffix bail must leave the previous cache untouched.
  let nextSlots: ActivityFeedSlot[] | null = null;
  let nextTaskRowIndex: Map<string, number> | null = null;
  let lastKeptActivity = previousCache.lastKeptActivity;
  for (; newIndex < activities.length; newIndex += 1) {
    const activity = activities[newIndex]!;
    let derived = previousCache.derivedByActivity.get(activity);
    if (derived === undefined) {
      derived = deriveWorkLogEntry(activity);
      previousCache.derivedByActivity.set(activity, derived);
    }
    if (derived === null) {
      continue;
    }
    if (lastKeptActivity !== null && activityOrder(lastKeptActivity, activity) > 0) {
      return null;
    }
    lastKeptActivity = activity;

    // Mirrors appendCollapsedWorkLogEntry against the writable copies.
    const currentSlots = nextSlots ?? previousCache.slots;
    const isTaskRow =
      derived.taskId !== undefined &&
      (derived.activityKind === "task.progress" ||
        derived.activityKind === "task.completed" ||
        derived.activityKind === "task.updated");
    if (isTaskRow && derived.taskId !== undefined) {
      const existingIndex = (nextTaskRowIndex ?? previousCache.taskRowIndex).get(derived.taskId);
      if (existingIndex !== undefined) {
        nextSlots ??= previousCache.slots.slice();
        nextSlots[existingIndex] = makeActivityFeedSlot(
          mergeDerivedWorkLogEntries(currentSlots[existingIndex]!.derived, derived),
        );
        continue;
      }
      nextTaskRowIndex ??= new Map(previousCache.taskRowIndex);
      nextTaskRowIndex.set(derived.taskId, currentSlots.length);
      nextSlots ??= previousCache.slots.slice();
      nextSlots.push(makeActivityFeedSlot(derived));
      continue;
    }
    const previousSlot = currentSlots.at(-1);
    if (previousSlot && shouldCollapseToolLifecycleEntries(previousSlot.derived, derived)) {
      nextSlots ??= previousCache.slots.slice();
      nextSlots[currentSlots.length - 1] = makeActivityFeedSlot(
        mergeDerivedWorkLogEntries(previousSlot.derived, derived),
      );
      continue;
    }
    nextSlots ??= previousCache.slots.slice();
    nextSlots.push(makeActivityFeedSlot(derived));
  }

  if (nextSlots === null) {
    // Only dropped rows came and went; the derived output is unchanged.
    return { ...previousCache, activities };
  }
  return {
    activities,
    derivedByActivity: previousCache.derivedByActivity,
    slots: nextSlots,
    taskRowIndex: nextTaskRowIndex ?? previousCache.taskRowIndex,
    lastKeptActivity,
    entries: sortActivityFeedSlots(nextSlots).map((slot) => slot.feedEntry),
  };
}

function mergeThreadFeedEntries(
  messages: ReadonlyArray<RawThreadFeedEntry>,
  activities: ReadonlyArray<RawThreadFeedEntry>,
): ReadonlyArray<RawThreadFeedEntry> {
  const merged: RawThreadFeedEntry[] = [];
  let messageIndex = 0;
  let activityIndex = 0;

  while (messageIndex < messages.length && activityIndex < activities.length) {
    const message = messages[messageIndex];
    const activity = activities[activityIndex];
    if (!message || !activity) break;

    // The old stable combined sort received messages before activities, so a
    // timestamp tie must keep the message first.
    if (Date.parse(message.createdAt) <= Date.parse(activity.createdAt)) {
      merged.push(message);
      messageIndex += 1;
    } else {
      merged.push(activity);
      activityIndex += 1;
    }
  }

  while (messageIndex < messages.length) {
    const message = messages[messageIndex];
    if (message) merged.push(message);
    messageIndex += 1;
  }
  while (activityIndex < activities.length) {
    const activity = activities[activityIndex];
    if (activity) merged.push(activity);
    activityIndex += 1;
  }

  return merged;
}

function assembleThreadFeed(
  messages: ReadonlyArray<RawThreadFeedEntry>,
  activities: ReadonlyArray<RawThreadFeedEntry>,
  oldestLoadedMessageCreatedAt: string | null,
): ThreadFeedEntry[] {
  const visibleActivities =
    oldestLoadedMessageCreatedAt === null
      ? activities
      : activities.filter((entry) => entry.createdAt >= oldestLoadedMessageCreatedAt);
  return groupAdjacentActivities(mergeThreadFeedEntries(messages, visibleActivities));
}

function indexThreadFeedMessages(
  feed: ReadonlyArray<ThreadFeedEntry>,
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  for (let index = 0; index < feed.length; index += 1) {
    const entry = feed[index];
    if (entry?.type === "message") {
      indexes.set(entry.id, index);
    }
  }
  return indexes;
}

function replaceThreadFeedMessages(
  feed: ThreadFeedEntry[],
  changedEntries: ReadonlyArray<MessageThreadFeedEntry>,
  messageIndexById: ReadonlyMap<string, number>,
): ThreadFeedEntry[] | null {
  let nextFeed: ThreadFeedEntry[] | null = null;
  for (const entry of changedEntries) {
    const feedIndex = messageIndexById.get(entry.id);
    if (feedIndex === undefined) {
      if (isEmptyMessage(entry)) continue;
      return null;
    }
    const previousEntry = feed[feedIndex];
    if (previousEntry?.type !== "message" || previousEntry.id !== entry.id) {
      return null;
    }
    nextFeed ??= feed.slice();
    nextFeed[feedIndex] = entry;
  }
  return nextFeed ?? feed;
}

/**
 * Builds a feed while reusing the expensive derived half when only messages or
 * activities changed. Streaming message deltas normally preserve the activity
 * array identity, and activity churn that only touches dropped rows (e.g.
 * context-window supersede) preserves the derived entries, so neither
 * re-sorts and re-interprets the full work log.
 */
export function createThreadFeedBuilder() {
  let previousMessages: ReadonlyArray<OrchestrationThread["messages"][number]> | null = null;
  let previousMessageCache: MessageFeedEntryCache = {
    entries: [],
    sortedIndexById: new Map(),
  };
  let previousActivities: ReadonlyArray<OrchestrationThreadActivity> | null = null;
  let previousActivityCache: ActivityFeedEntryCache | null = null;
  let previousActivityEntries: ReadonlyArray<RawThreadFeedEntry> = [];
  let previousOldestLoadedMessageCreatedAt: string | null = null;
  let previousUsedLoadedMessages = false;
  let previousFeed: ThreadFeedEntry[] | null = null;
  let previousFeedMessageIndexById: ReadonlyMap<string, number> = new Map();

  return (thread: ThreadFeedSource, options?: BuildThreadFeedOptions): ThreadFeedEntry[] => {
    const loadedMessages = options?.loadedMessages ?? thread.messages;
    const messagesChanged = loadedMessages !== previousMessages;
    const activitiesChanged = thread.activities !== previousActivities;
    const usedLoadedMessages = options?.loadedMessages !== undefined;
    const oldestLoadedMessageCreatedAt = usedLoadedMessages
      ? (loadedMessages[0]?.createdAt ?? null)
      : null;
    const incrementalMessageUpdate =
      messagesChanged && previousMessages !== null
        ? updateMessageFeedEntryCache(loadedMessages, previousMessages, previousMessageCache)
        : null;
    const nextMessageCache = messagesChanged
      ? (incrementalMessageUpdate?.cache ?? buildMessageFeedEntryCache(loadedMessages))
      : previousMessageCache;

    if (messagesChanged) {
      previousMessages = loadedMessages;
      previousMessageCache = nextMessageCache;
    }
    let activityEntriesChanged = false;
    if (activitiesChanged) {
      previousActivityCache =
        (previousActivityCache === null
          ? null
          : updateActivityFeedEntryCache(thread.activities, previousActivityCache)) ??
        buildActivityFeedEntryCache(thread.activities, previousActivityCache?.derivedByActivity);
      previousActivities = thread.activities;
      activityEntriesChanged = previousActivityCache.entries !== previousActivityEntries;
      previousActivityEntries = previousActivityCache.entries;
    }

    const canReplaceMessages =
      previousFeed !== null &&
      messagesChanged &&
      !activityEntriesChanged &&
      usedLoadedMessages === previousUsedLoadedMessages &&
      oldestLoadedMessageCreatedAt === previousOldestLoadedMessageCreatedAt &&
      incrementalMessageUpdate !== null &&
      !incrementalMessageUpdate.visibilityChanged;
    const canReuseFeed =
      previousFeed !== null &&
      !messagesChanged &&
      !activityEntriesChanged &&
      usedLoadedMessages === previousUsedLoadedMessages &&
      oldestLoadedMessageCreatedAt === previousOldestLoadedMessageCreatedAt;
    const replacedFeed =
      canReplaceMessages && previousFeed !== null && incrementalMessageUpdate !== null
        ? replaceThreadFeedMessages(
            previousFeed,
            incrementalMessageUpdate.changedEntries,
            previousFeedMessageIndexById,
          )
        : null;
    const reusedFeed = replacedFeed ?? (canReuseFeed ? previousFeed : null);
    const nextFeed =
      reusedFeed ??
      assembleThreadFeed(
        nextMessageCache.entries,
        previousActivityEntries,
        oldestLoadedMessageCreatedAt,
      );
    if (reusedFeed === null) {
      previousFeedMessageIndexById = indexThreadFeedMessages(nextFeed);
    }
    previousFeed = nextFeed;
    previousUsedLoadedMessages = usedLoadedMessages;
    previousOldestLoadedMessageCreatedAt = oldestLoadedMessageCreatedAt;
    return nextFeed;
  };
}

export function buildThreadFeed(
  thread: OrchestrationThread,
  options?: {
    readonly loadedMessages?: ReadonlyArray<OrchestrationThread["messages"][number]>;
  },
): ThreadFeedEntry[] {
  const loadedMessages = options?.loadedMessages ?? thread.messages;
  return assembleThreadFeed(
    buildMessageFeedEntries(loadedMessages),
    buildActivityFeedEntries(thread.activities),
    options?.loadedMessages === undefined ? null : (loadedMessages[0]?.createdAt ?? null),
  );
}
