import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

import {
  activityContextUsedTokens,
  activityProjectionGroupKey,
} from "./activityProjectionMetadata.ts";

const TOOL_TEXT_SCAN_MAX_CHARS = 64 * 1_024;
const MCP_RESULT_SCAN_MAX_BLOCKS = 256;
const CHANGED_FILE_SCAN_MAX_NODES = 512;
const IMAGE_FILE_PATH_KEYS = ["savedPath", "path", "filePath"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown): void {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(
  value: unknown,
  target: string[],
  seen: Set<string>,
  depth: number,
  budget: { remaining: number },
): void {
  if (depth > 4 || target.length >= 12 || budget.remaining <= 0) {
    return;
  }
  budget.remaining -= 1;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1, budget);
      if (target.length >= 12 || budget.remaining <= 0) {
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
  pushChangedFile(target, seen, record.file_path);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "files",
    "changes",
    "edits",
    "patch",
    "patches",
    "operations",
    "item",
    "result",
    "input",
    "data",
    "locations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1, budget);
    if (target.length >= 12 || budget.remaining <= 0) {
      return;
    }
  }
}

type ProjectedFileChangeKind = "add" | "delete" | "update";

type HarvestedFileDiff = {
  kind?: ProjectedFileChangeKind;
  diff?: string;
};

// ponytail: 4 files × 32 lines / 1.5KB; full turn diff lives in the Diff panel
const FILE_DIFF_MAX_FILES = 4;
const FILE_DIFF_MAX_LINES = 32;
const FILE_DIFF_MAX_CHARS = 1_500;

function boundDiffText(
  value: string,
  maxLines = FILE_DIFF_MAX_LINES,
  maxChars = FILE_DIFF_MAX_CHARS,
): string {
  const lines = value.split("\n");
  let text = lines.slice(0, maxLines).join("\n");
  if (text.length > maxChars) {
    const clipped = text.slice(0, maxChars);
    const lastNewline = clipped.lastIndexOf("\n");
    text = lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped;
  }
  if (lines.length > maxLines || value.length > maxChars) {
    return `${text}\n…`;
  }
  return text;
}

function prefixLines(value: string, sign: "+" | "-"): string {
  if (value.length === 0) {
    return sign;
  }
  return value
    .split("\n")
    .map((line) => `${sign}${line}`)
    .join("\n");
}

function compactReplaceDiff(
  oldText: string | null,
  newText: string | null,
): { kind: ProjectedFileChangeKind; diff: string } | null {
  const oldValue = oldText ?? "";
  const newValue = newText ?? "";
  if (oldValue.length === 0 && newValue.length === 0) {
    return null;
  }
  if (oldValue.length === 0) {
    return { kind: "add", diff: boundDiffText(prefixLines(newValue, "+")) };
  }
  if (newValue.length === 0) {
    return { kind: "delete", diff: boundDiffText(prefixLines(oldValue, "-")) };
  }
  const sideLines = Math.max(1, Math.floor(FILE_DIFF_MAX_LINES / 2));
  const sideChars = Math.max(1, Math.floor(FILE_DIFF_MAX_CHARS / 2));
  return {
    kind: "update",
    diff: `${boundDiffText(prefixLines(oldValue, "-"), sideLines, sideChars)}\n${boundDiffText(prefixLines(newValue, "+"), sideLines, sideChars)}`,
  };
}

function kindFromUnknown(value: unknown): ProjectedFileChangeKind | undefined {
  if (value === "add" || value === "delete" || value === "update") {
    return value;
  }
  const record = asRecord(value);
  const type = asTrimmedString(record?.type)?.toLowerCase();
  if (type === "add" || type === "create" || type === "write") return "add";
  if (type === "delete" || type === "remove") return "delete";
  if (type === "update" || type === "edit" || type === "patch") return "update";
  const name = asTrimmedString(value)?.toLowerCase();
  if (!name) return undefined;
  if (name.includes("write") || name.includes("create") || name === "add") return "add";
  if (name.includes("delete") || name.includes("remove")) return "delete";
  if (
    name.includes("edit") ||
    name.includes("replace") ||
    name.includes("patch") ||
    name.includes("update")
  ) {
    return "update";
  }
  return undefined;
}

function setHarvestedDiff(
  target: Map<string, HarvestedFileDiff>,
  path: string,
  next: HarvestedFileDiff,
): void {
  const previous = target.get(path);
  const kind = next.kind ?? previous?.kind;
  const diff = next.diff ?? previous?.diff;
  target.set(path, {
    ...(kind ? { kind } : {}),
    ...(diff ? { diff } : {}),
  });
}

function harvestAcpDiffEntries(value: unknown, target: Map<string, HarvestedFileDiff>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || record.type !== "diff") continue;
    const path = asTrimmedString(record.path);
    if (!path) continue;
    const compact = compactReplaceDiff(
      typeof record.oldText === "string" ? record.oldText : "",
      typeof record.newText === "string" ? record.newText : "",
    );
    if (compact) {
      setHarvestedDiff(target, path, compact);
    }
  }
}

function harvestNamedChangeEntries(value: unknown, target: Map<string, HarvestedFileDiff>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const kind = kindFromUnknown(record.kind) ?? kindFromUnknown(record.type);
    const patch = asTrimmedString(record.diff) ?? asTrimmedString(record.patch);
    if (!kind && !patch) continue;
    const path =
      asTrimmedString(record.path) ??
      asTrimmedString(record.newPath) ??
      asTrimmedString(record.filePath) ??
      asTrimmedString(record.file_path);
    if (!path) continue;
    if (patch) {
      setHarvestedDiff(target, path, { kind: kind ?? "update", diff: boundDiffText(patch) });
    } else if (kind) {
      setHarvestedDiff(target, path, { kind });
    }
  }
}

function harvestToolInputDiff(
  input: Record<string, unknown> | null,
  toolName: unknown,
  target: Map<string, HarvestedFileDiff>,
): void {
  if (!input) return;
  const path =
    asTrimmedString(input.file_path) ??
    asTrimmedString(input.path) ??
    asTrimmedString(input.filePath);
  if (!path) return;
  const oldText =
    typeof input.old_string === "string"
      ? input.old_string
      : typeof input.oldText === "string"
        ? input.oldText
        : null;
  const newText =
    typeof input.new_string === "string"
      ? input.new_string
      : typeof input.newText === "string"
        ? input.newText
        : typeof input.content === "string"
          ? input.content
          : null;
  const kind = kindFromUnknown(toolName) ?? kindFromUnknown(input.kind);
  if (oldText !== null || newText !== null) {
    const compact = compactReplaceDiff(oldText, newText);
    if (compact) {
      setHarvestedDiff(target, path, { kind: kind ?? compact.kind, diff: compact.diff });
      return;
    }
  }
  if (kind) {
    setHarvestedDiff(target, path, { kind });
  }
}

function harvestFileDiffs(data: Record<string, unknown>): Map<string, HarvestedFileDiff> {
  const target = new Map<string, HarvestedFileDiff>();
  harvestAcpDiffEntries(data.content, target);
  harvestNamedChangeEntries(asRecord(data.item)?.changes, target);
  harvestNamedChangeEntries(data.changes, target);
  harvestNamedChangeEntries(data.files, target);
  harvestToolInputDiff(asRecord(data.input), data.toolName ?? data.kind, target);
  harvestToolInputDiff(asRecord(data.rawInput), data.kind ?? data.toolName, target);
  return target;
}

function toProjectedChangedFiles(
  paths: ReadonlyArray<string>,
  diffs: Map<string, HarvestedFileDiff>,
): Array<{ path: string; kind?: ProjectedFileChangeKind; diff?: string }> {
  let diffsAttached = 0;
  return paths.map((path) => {
    const extra = diffs.get(path);
    if (!extra) {
      return { path };
    }
    const canAttachDiff = extra.diff !== undefined && diffsAttached < FILE_DIFF_MAX_FILES;
    if (canAttachDiff) {
      diffsAttached += 1;
    }
    return {
      path,
      ...(extra.kind ? { kind: extra.kind } : {}),
      ...(canAttachDiff ? { diff: extra.diff } : {}),
    };
  });
}

function projectChangedFiles(
  data: Record<string, unknown>,
  extraPaths?: ReadonlyArray<string>,
): Array<{ path: string; kind?: ProjectedFileChangeKind; diff?: string }> | undefined {
  const changedFiles: string[] = [];
  const seenFiles = new Set<string>();
  collectChangedFiles(data, changedFiles, seenFiles, 0, {
    remaining: CHANGED_FILE_SCAN_MAX_NODES,
  });
  if (extraPaths) {
    for (const path of extraPaths) {
      if (seenFiles.has(path)) continue;
      seenFiles.add(path);
      changedFiles.push(path);
    }
  }
  const diffs = harvestFileDiffs(data);
  for (const path of diffs.keys()) {
    if (seenFiles.has(path)) continue;
    seenFiles.add(path);
    changedFiles.push(path);
  }
  if (changedFiles.length === 0) {
    return undefined;
  }
  return toProjectedChangedFiles(changedFiles, diffs);
}

function collectProjectedImageFiles(
  rawOutputValue: unknown,
  target: string[],
  seen: Set<string>,
): void {
  const rawOutput = asRecord(rawOutputValue);
  if (!rawOutput) {
    return;
  }
  for (const key of IMAGE_FILE_PATH_KEYS) {
    const candidate = asTrimmedString(rawOutput[key]);
    if (candidate && isWorkspaceImagePreviewPath(candidate)) {
      pushChangedFile(target, seen, candidate);
    }
  }
}

function projectCommandData(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const item = asRecord(data.item);
  if (!item) {
    return undefined;
  }

  const projectedItem: Record<string, unknown> = {};
  if ("command" in item) {
    projectedItem.command = item.command;
  }

  const aggregatedOutput = asTrimmedString(item.aggregatedOutput);
  if (aggregatedOutput) {
    const summary = summarizeToolTextOutput(aggregatedOutput);
    if (summary) {
      projectedItem.aggregatedOutput = summary;
    }
  }

  const input = asRecord(item.input);
  if (input && "command" in input) {
    projectedItem.input = { command: input.command };
  }

  const result = asRecord(item.result);
  if (result) {
    const projectedResult: Record<string, unknown> = {};
    if ("command" in result) {
      projectedResult.command = result.command;
    }
    const content = asTrimmedString(result.content);
    if (content) {
      const summary = summarizeToolTextOutput(content);
      if (summary) {
        projectedResult.content = summary;
      }
    }
    if (Object.keys(projectedResult).length > 0) {
      projectedItem.result = projectedResult;
    }
  }

  return Object.keys(projectedItem).length > 0 ? projectedItem : undefined;
}

function projectCommandValue(data: Record<string, unknown>): unknown {
  if (data.command !== undefined) {
    return data.command;
  }

  const input = asRecord(data.input);
  if (input?.command !== undefined) {
    return input.command;
  }

  const stateInput = asRecord(asRecord(data.state)?.input);
  if (stateInput?.command !== undefined) {
    return stateInput.command;
  }

  return undefined;
}

function summarizeToolTextOutput(value: string): string | null {
  const scanEnd = Math.min(value.length, TOOL_TEXT_SCAN_MAX_CHARS);
  let meaningfulLineCount = 0;
  let lineStart = 0;

  for (let cursor = 0; cursor <= scanEnd; cursor += 1) {
    if (cursor < scanEnd && value.charCodeAt(cursor) !== 10) {
      continue;
    }
    const line = value.slice(lineStart, cursor).replace(/\s+/g, " ").trim();
    if (line.length > 0) {
      meaningfulLineCount += 1;
      if (line !== "```") {
        return line.length <= 84 ? line : `${line.slice(0, 83).trimEnd()}…`;
      }
    }
    lineStart = cursor + 1;
  }

  // A count is only exact when the complete value was inspected. If the scan
  // ceiling was reached, omit the cosmetic fence-only fallback instead of
  // reporting a partial line count.
  if (scanEnd < value.length) {
    return null;
  }
  if (meaningfulLineCount > 1) {
    return `${meaningfulLineCount.toLocaleString()} lines`;
  }
  return null;
}

/**
 * Fields of an MCP tool-call item both clients render in the expanded
 * work-log row. Everything else — notably `result`, which carries the full
 * tool output and dominates wire size on MCP-heavy threads — is summarized
 * or dropped. Full payloads remain in persistence.
 */
const MCP_ITEM_KEPT_FIELDS = [
  "type",
  "id",
  "tool",
  "server",
  "status",
  "arguments",
  "appContext",
  "error",
  "durationMs",
] as const;

/**
 * Pulls renderable text out of an MCP tool result: either a Codex-style
 * `{content: [{type: "text", text}, ...]}` record or a raw Claude
 * `tool_result` block whose `content` is a string or block array.
 */
function extractMcpResultText(result: unknown): string | null {
  const record = asRecord(result);
  if (!record) {
    return typeof result === "string" ? result : null;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    const texts: string[] = [];
    let remainingChars = TOOL_TEXT_SCAN_MAX_CHARS;
    for (
      let index = 0;
      index < record.content.length && index < MCP_RESULT_SCAN_MAX_BLOCKS;
      index += 1
    ) {
      const entry = record.content[index];
      const text = asRecord(entry)?.text;
      if (typeof text !== "string") {
        continue;
      }
      const separatorLength = texts.length > 0 ? 1 : 0;
      if (remainingChars <= separatorLength) {
        break;
      }
      const clipped = text.slice(0, remainingChars - separatorLength);
      texts.push(clipped);
      remainingChars -= clipped.length + separatorLength;
      if (clipped.length < text.length || remainingChars <= 0) {
        break;
      }
    }
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }
  return null;
}

function summarizeMcpResult(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined || result === null) {
    return undefined;
  }
  const text = extractMcpResultText(result);
  const summary = text ? summarizeToolTextOutput(text) : null;
  return summary ? { content: summary } : undefined;
}

/**
 * MCP tool arguments stay renderable (browser-automation rows label
 * themselves from them) but oversized fields — e.g. preview_evaluate
 * expressions — are dropped rather than shipping the whole object.
 */
const MCP_ARGUMENTS_MAX_CHARS = 4_000;

function jsonEncodedLength(value: unknown): number | undefined {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : encoded.length;
  } catch {
    return undefined;
  }
}

const MCP_ARGUMENT_LABEL_KEYS = [
  "locator",
  "selector",
  "text",
  "url",
  "key",
  "clear",
  "x",
  "y",
  "target",
  "deltaX",
  "deltaY",
  "modifiers",
  "preset",
  "width",
  "height",
  "colorScheme",
  "urlIncludes",
] as const;

function boundedMcpArguments(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const total = jsonEncodedLength(value);
  if (total === undefined) return undefined;
  if (total <= MCP_ARGUMENTS_MAX_CHARS) return value;
  const record = asRecord(value);
  if (!record) return undefined;
  const preferred = new Set<string>(MCP_ARGUMENT_LABEL_KEYS);
  const keys = [
    ...MCP_ARGUMENT_LABEL_KEYS.filter((key) => key in record),
    ...Object.keys(record).filter((key) => !preferred.has(key)),
  ];
  const kept: Record<string, unknown> = {};
  for (const key of keys) {
    const field = record[key];
    const fieldLength = jsonEncodedLength(field);
    if (fieldLength === undefined || fieldLength > MCP_ARGUMENTS_MAX_CHARS) continue;
    const next = { ...kept, [key]: field };
    const nextLength = jsonEncodedLength(next);
    if (nextLength === undefined || nextLength > MCP_ARGUMENTS_MAX_CHARS) continue;
    kept[key] = field;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * MCP tool calls carry full tool results (`data.item.result` on Codex,
 * `data.result` on Claude) that used to bypass slimming entirely to
 * keep the expanded-row UI working. Keep the fields the UI actually renders
 * and summarize the result like regular tool output.
 */
function projectMcpToolCallData(data: Record<string, unknown>): Record<string, unknown> {
  const projectedData: Record<string, unknown> = {};

  const item = asRecord(data.item);
  if (item) {
    const projectedItem: Record<string, unknown> = {};
    for (const key of MCP_ITEM_KEPT_FIELDS) {
      if (key in item) {
        projectedItem[key] = key === "arguments" ? boundedMcpArguments(item[key]) : item[key];
      }
    }
    const result = summarizeMcpResult(item.result);
    if (result) {
      projectedItem.result = result;
    }
    projectedData.item = projectedItem;
  }

  if ("toolName" in data) {
    projectedData.toolName = data.toolName;
  }
  // Claude reports MCP arguments as `input` where Codex nests them in
  // `item.arguments`. Normalize to `arguments` so clients read one field.
  if (!item && "input" in data) {
    const argumentsValue = boundedMcpArguments(data.input);
    if (argumentsValue !== undefined) {
      projectedData.arguments = argumentsValue;
    }
  }
  if (!item) {
    const result = summarizeMcpResult(data.result);
    if (result) {
      projectedData.result = result;
    }
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }
  if ("kind" in data) {
    projectedData.kind = data.kind;
  }

  const files = projectChangedFiles(data);
  if (files) {
    projectedData.files = files;
  }

  return projectedData;
}

function projectRawOutput(value: unknown, itemType: unknown): Record<string, unknown> | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    const summary = summarizeToolTextOutput(direct);
    return summary ? { content: summary } : undefined;
  }

  const rawOutput = asRecord(value);
  if (!rawOutput) {
    return undefined;
  }

  if (itemType === "image_generation") {
    const projectedImage: Record<string, unknown> = {};
    for (const key of IMAGE_FILE_PATH_KEYS) {
      const candidate = asTrimmedString(rawOutput[key]);
      if (candidate && isWorkspaceImagePreviewPath(candidate)) {
        projectedImage[key] = candidate;
      }
    }
    if (Object.keys(projectedImage).length > 0) {
      const filename = asTrimmedString(rawOutput.filename);
      if (filename) {
        projectedImage.filename = filename;
      }
      const sessionFolder = asTrimmedString(rawOutput.session_folder);
      if (sessionFolder) {
        projectedImage.session_folder = sessionFolder;
      }
      return projectedImage;
    }
  }

  if (typeof rawOutput.totalFiles === "number" && Number.isFinite(rawOutput.totalFiles)) {
    return {
      totalFiles: rawOutput.totalFiles,
      ...(rawOutput.truncated === true ? { truncated: true } : {}),
    };
  }

  if (typeof rawOutput.content === "string") {
    const summary = summarizeToolTextOutput(rawOutput.content);
    if (summary) {
      return { content: summary };
    }
  }

  if (typeof rawOutput.stdout === "string") {
    const summary = summarizeToolTextOutput(rawOutput.stdout);
    if (summary) {
      return { content: summary };
    }
  }

  const stderr = asTrimmedString(rawOutput.stderr);
  if (stderr) {
    const summary = summarizeToolTextOutput(stderr);
    return summary ? { content: summary } : undefined;
  }

  return undefined;
}

function projectAcpContent(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((entryValue) => {
      const entry = asRecord(entryValue);
      const content = asRecord(entry?.content);
      return entry?.type === "content" && content?.type === "text"
        ? asTrimmedString(content.text)
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");
  const summary = summarizeToolTextOutput(text);
  return summary ? { content: summary } : undefined;
}

/**
 * Removes activity payload fields that no current client reads while retaining
 * the full payload in persistence and the event store.
 */
export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  if (!payload || !data) {
    return activity;
  }

  const itemStatus = asRecord(data.item)?.status;
  const projectedPayload =
    payload.status === "completed" && (itemStatus === "failed" || itemStatus === "declined")
      ? { ...payload, status: itemStatus }
      : payload;

  if (payload.itemType === "mcp_tool_call") {
    return {
      ...activity,
      payload: {
        ...projectedPayload,
        data: projectMcpToolCallData(data),
      },
    };
  }

  const projectedData: Record<string, unknown> = {};
  const item = projectCommandData(data);
  if (item) {
    projectedData.item = item;
  }
  const command = projectCommandValue(data);
  if (command !== undefined) {
    projectedData.command = command;
  }

  const imageFiles: string[] = [];
  if (payload.itemType === "image_generation") {
    collectProjectedImageFiles(data.rawOutput, imageFiles, new Set<string>());
  }
  const files = projectChangedFiles(data, imageFiles);
  if (files) {
    // Both clients discover file names by walking objects with path-like keys.
    projectedData.files = files;
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }
  if ("kind" in data) {
    projectedData.kind = data.kind;
  }
  const toolName = asTrimmedString(data.toolName);
  if (toolName) {
    projectedData.toolName = toolName;
  }

  const rawOutput =
    projectRawOutput(data.rawOutput, payload.itemType) ?? projectAcpContent(data.content);
  if (rawOutput) {
    projectedData.rawOutput = rawOutput;
  }

  return {
    ...activity,
    payload: {
      ...projectedPayload,
      data: projectedData,
    },
  };
}

/**
 * Matches the validity rule in the web client's
 * `deriveLatestContextWindowSnapshot`: rows without a finite, non-negative
 * `usedTokens` are skipped during its backward walk, so they must not shadow
 * an earlier resolvable row here.
 */
function isResolvableContextWindowActivity(activity: OrchestrationThreadActivity): boolean {
  return activityContextUsedTokens(activity) !== null;
}

/**
 * Drops all but the last resolvable context-window activity per turn from a
 * snapshot. Clients only ever read the latest usage value (walking the array
 * backwards), so shipping the full history — often thousands of rows on long
 * threads — buys nothing. Retention is per turn rather than per thread because
 * a live `thread.reverted` makes the client discard whole turns; keeping each
 * turn's latest row means the meter can still resolve a value from the turns
 * that survive. Malformed rows pass through untouched rather than shadowing a
 * valid earlier row. Live `thread.activity-appended` events are untouched:
 * newer updates still stream through and supersede the retained rows on the
 * client.
 */
function dropStaleContextWindowActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const latestIndexByTurn = new Map<string | null, number>();
  for (let index = 0; index < activities.length; index += 1) {
    if (isResolvableContextWindowActivity(activities[index]!)) {
      latestIndexByTurn.set(activities[index]!.turnId, index);
    }
  }
  if (latestIndexByTurn.size === 0) {
    return activities;
  }
  return activities.filter(
    (activity, index) =>
      !isResolvableContextWindowActivity(activity) ||
      latestIndexByTurn.get(activity.turnId) === index,
  );
}

/**
 * Identity used to retain only the newest lifecycle row for each call in a
 * thread snapshot. Prefer the runtime item id, then the legacy nested id, and
 * finally the itemType/title/detail triple. Rows without any identity remain
 * untouched.
 */
function toolLifecycleIdentity(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  const topLevelToolCallId = asTrimmedString(payload?.toolCallId);
  if (topLevelToolCallId) {
    return `id:${topLevelToolCallId}`;
  }

  return activityProjectionGroupKey(activity);
}

/**
 * Drops `tool.updated` rows a `tool.completed` row already supersedes. An
 * update is the in-flight snapshot of a call; once the call completes, the
 * completion carries the final state and the clients fold every matching
 * update into it, so shipping the updates buys nothing — 47k such rows exist
 * in one real database, and a single thread carries 2,291 of them totalling
 * ~1MB post-slimming.
 *
 * Matching is per turn for the same reason `dropStaleContextWindowActivities`
 * retains per turn: a live `thread.reverted` makes the client discard whole
 * turns, so a completion in a different turn could vanish and leave the
 * dropped update unrepresented. The completion must also come *after* the
 * update within the turn — a later update belongs to a subsequent call that
 * reuses the same identity and is still in flight. Rows without a lifecycle
 * identity pass through, matching the clients, which never collapse them.
 * Live `thread.activity-appended` events are untouched: updates still stream
 * in real time and the completion supersedes them on the client as before.
 *
 * Deliberate divergence from client collapse: clients fold only *adjacent*
 * lifecycle rows, so a superseded update separated from its completion by an
 * interleaved parallel call renders as its own row today, and this drop
 * removes it. Measured against a real database, that affects 1.5% of dropped
 * rows (553 of 36,581), all pure in-flight state whose final result the
 * retained completion still shows. Dropping them is intentional; matching
 * adjacency server-side would forfeit most of the win for parallel-heavy
 * threads, which are exactly the heavy ones. Superseding completions always
 * carry a payload superset of their updates (verified across all 49,515
 * update rows: zero dropped rows held a client-merged field — detail, title,
 * command, item, kind, files — their completion lacked), so no expanded-row
 * content is lost.
 */
function dropSupersededToolUpdatedActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const completionIndicesByKey = new Map<string, number[]>();
  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index]!;
    if (activity.kind !== "tool.completed") {
      continue;
    }
    const identity = toolLifecycleIdentity(activity);
    if (!identity) {
      continue;
    }
    const key = `${activity.turnId ?? ""}\0${identity}`;
    const indices = completionIndicesByKey.get(key);
    if (indices) {
      indices.push(index);
    } else {
      completionIndicesByKey.set(key, [index]);
    }
  }
  if (completionIndicesByKey.size === 0) {
    return activities;
  }

  return activities.filter((activity, index) => {
    if (activity.kind !== "tool.updated") {
      return true;
    }
    const identity = toolLifecycleIdentity(activity);
    if (!identity) {
      return true;
    }
    const indices = completionIndicesByKey.get(`${activity.turnId ?? ""}\0${identity}`);
    return !indices?.some((completionIndex) => completionIndex > index);
  });
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities: dropSupersededToolUpdatedActivities(
        dropStaleContextWindowActivities(snapshot.thread.activities),
      ).map(projectActivityPayload),
    },
  };
}

export function projectActivityEvent(event: OrchestrationEvent): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity),
    },
  };
}
