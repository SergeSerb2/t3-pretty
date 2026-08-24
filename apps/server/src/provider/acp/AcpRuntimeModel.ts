import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as EffectAcpSchema from "effect-acp/schema";
import { classifyImageToolItemType } from "@t3tools/shared/imageTool";
import { deriveToolActivityPresentation } from "@t3tools/shared/toolActivity";
import { classifySkillLoadItemType } from "@t3tools/shared/skillTool";
import {
  PROVIDER_OPTION_AGGREGATE_MAX_CHOICES,
  PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS,
  PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_OPTION_ID_MAX_LENGTH,
  PROVIDER_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_OPTION_MAX_COUNT,
  PROVIDER_OPTION_VALUE_MAX_LENGTH,
  PROVIDER_RUNTIME_MAX_PLAN_STEPS,
  type RuntimeContentStreamKind,
  type ToolLifecycleItemType,
} from "@t3tools/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionModelState(value: unknown): value is EffectAcpSchema.SessionModelState {
  if (!isRecord(value) || typeof value.currentModelId !== "string") {
    return false;
  }
  if (!Array.isArray(value.availableModels)) {
    return false;
  }
  return value.availableModels.every(
    (model) =>
      isRecord(model) &&
      typeof model.modelId === "string" &&
      typeof model.name === "string" &&
      (model.description === undefined ||
        model.description === null ||
        typeof model.description === "string"),
  );
}

function isSessionModeState(value: unknown): value is EffectAcpSchema.SessionModeState {
  if (!isRecord(value) || typeof value.currentModeId !== "string") {
    return false;
  }
  if (!Array.isArray(value.availableModes)) {
    return false;
  }
  return value.availableModes.every(
    (mode) =>
      isRecord(mode) &&
      typeof mode.id === "string" &&
      typeof mode.name === "string" &&
      (mode.description === undefined || typeof mode.description === "string"),
  );
}

export interface AcpSessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface AcpSessionModeState {
  readonly currentModeId: string;
  readonly availableModes: ReadonlyArray<AcpSessionMode>;
}

export interface AcpToolCallState {
  readonly toolCallId: string;
  readonly kind?: string;
  readonly title?: string;
  readonly status?: "pending" | "inProgress" | "completed" | "failed";
  readonly command?: string;
  readonly detail?: string;
  readonly data: Record<string, unknown>;
}

export interface AcpPlanUpdate {
  readonly explanation?: string | null;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
}

/**
 * Stable, allocation-bounded fingerprint for repeated cumulative ACP plan
 * notifications. Serializing the full provider payload solely for deduplication
 * can briefly duplicate a very large plan and retain that copy for the session.
 */
export function fingerprintAcpPlanUpdate(payload: AcpPlanUpdate): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  let characterCount = 0;

  const mixNumber = (value: number) => {
    left = Math.imul(left ^ (value & 0xffff), 0x01000193);
    left = Math.imul(left ^ ((value >>> 16) & 0xffff), 0x01000193);
    right = Math.imul(right ^ (value & 0xffff), 0x85ebca6b);
    right = Math.imul(right ^ ((value >>> 16) & 0xffff), 0x85ebca6b);
  };
  const mixText = (value: string) => {
    mixNumber(value.length);
    characterCount += value.length;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      left = Math.imul(left ^ code, 0x01000193);
      right = Math.imul(right ^ code, 0x85ebca6b);
    }
  };

  mixText(payload.explanation ?? "");
  mixNumber(payload.plan.length);
  for (const entry of payload.plan) {
    mixText(entry.step);
    mixText(entry.status);
  }
  return `${payload.plan.length}:${characterCount}:${(left >>> 0).toString(16)}:${(
    right >>> 0
  ).toString(16)}`;
}

export interface AcpPermissionRequest {
  readonly kind: string | "unknown";
  readonly detail?: string;
  readonly toolCall?: AcpToolCallState;
}

export type AcpParsedSessionEvent =
  | {
      readonly _tag: "ModeChanged";
      readonly modeId: string;
    }
  | {
      readonly _tag: "AssistantItemStarted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "AssistantItemCompleted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "PlanUpdated";
      readonly payload: AcpPlanUpdate;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ToolCallUpdated";
      readonly toolCall: AcpToolCallState;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ContentDelta";
      readonly itemId?: string;
      readonly streamKind: Extract<RuntimeContentStreamKind, "assistant_text" | "reasoning_text">;
      readonly text: string;
      readonly rawPayload: unknown;
    };

type AcpSessionSetupResponse =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

type AcpToolCallUpdate = Extract<
  EffectAcpSchema.SessionNotification["update"],
  { readonly sessionUpdate: "tool_call" | "tool_call_update" }
>;

export function extractModelConfigId(sessionResponse: AcpSessionSetupResponse): string | undefined {
  const configOptions = sessionResponse.configOptions;
  if (!configOptions) return undefined;
  for (const opt of configOptions) {
    if (opt.category === "model" && opt.id.trim().length > 0) {
      return opt.id.trim();
    }
  }
  return undefined;
}

export function findSessionConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  configId: string,
): EffectAcpSchema.SessionConfigOption | undefined {
  if (!configOptions) {
    return undefined;
  }
  const normalizedConfigId = configId.trim();
  if (!normalizedConfigId) {
    return undefined;
  }
  return configOptions.find((option) => option.id.trim() === normalizedConfigId);
}

interface AcpConfigBudget {
  choices: number;
  textChars: number;
}

function boundedAcpConfigIdentity(value: string, maximumChars: number): string | undefined {
  if (value.length > maximumChars) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function boundedAcpConfigPresentation(value: string, maximumChars: number): string | undefined {
  const normalized = value.slice(0, maximumChars).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function consumeAcpConfigText(budget: AcpConfigBudget, values: ReadonlyArray<string>): boolean {
  let addedChars = 0;
  for (const value of values) addedChars += value.length;
  if (budget.textChars + addedChars > PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS) return false;
  budget.textChars += addedChars;
  return true;
}

function boundAcpConfigSelectOption(
  option: EffectAcpSchema.SessionConfigSelectOption,
): EffectAcpSchema.SessionConfigSelectOption | undefined {
  const value = boundedAcpConfigIdentity(option.value, PROVIDER_OPTION_VALUE_MAX_LENGTH);
  if (!value) return undefined;
  const name = boundedAcpConfigPresentation(option.name, PROVIDER_OPTION_LABEL_MAX_LENGTH) ?? value;
  const description = option.description
    ? boundedAcpConfigPresentation(option.description, PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH)
    : undefined;
  return {
    value,
    name,
    ...(description ? { description } : {}),
  };
}

function acpConfigSelectOptionText(
  option: EffectAcpSchema.SessionConfigSelectOption,
): ReadonlyArray<string> {
  return [option.value, option.name, ...(option.description ? [option.description] : [])];
}

/**
 * Keeps the first representable ACP session options within the same budgets as
 * ModelCapabilities. Provider metadata is intentionally dropped: consumers of
 * this state use only canonical ids, labels, categories, and choices.
 */
export function boundAcpSessionConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<EffectAcpSchema.SessionConfigOption> {
  if (!configOptions) return [];

  const bounded: Array<EffectAcpSchema.SessionConfigOption> = [];
  const budget: AcpConfigBudget = { choices: 0, textChars: 0 };
  let textBudgetExhausted = false;

  for (const option of configOptions) {
    if (bounded.length >= PROVIDER_OPTION_MAX_COUNT || textBudgetExhausted) break;

    const id = boundedAcpConfigIdentity(option.id, PROVIDER_OPTION_ID_MAX_LENGTH);
    if (!id) continue;
    const name = boundedAcpConfigPresentation(option.name, PROVIDER_OPTION_LABEL_MAX_LENGTH) ?? id;
    const description = option.description
      ? boundedAcpConfigPresentation(option.description, PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH)
      : undefined;
    const category = option.category
      ? boundedAcpConfigIdentity(option.category, PROVIDER_OPTION_ID_MAX_LENGTH)
      : undefined;

    if (option.type === "boolean") {
      if (
        !consumeAcpConfigText(budget, [
          id,
          name,
          ...(description ? [description] : []),
          ...(category ? [category] : []),
        ])
      ) {
        break;
      }
      bounded.push({
        type: "boolean",
        id,
        name,
        currentValue: option.currentValue,
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      });
      continue;
    }

    const currentValue = boundedAcpConfigIdentity(
      option.currentValue,
      PROVIDER_OPTION_VALUE_MAX_LENGTH,
    );
    if (!currentValue) continue;
    const descriptorText = [
      id,
      name,
      currentValue,
      ...(description ? [description] : []),
      ...(category ? [category] : []),
    ];
    const descriptorTextStart = budget.textChars;
    if (!consumeAcpConfigText(budget, descriptorText)) break;

    const firstEntry = option.options[0];
    const grouped = firstEntry !== undefined && !("value" in firstEntry);
    let descriptorChoices = 0;

    if (grouped) {
      const groups: Array<EffectAcpSchema.SessionConfigSelectGroup> = [];
      for (const entry of option.options) {
        if ("value" in entry || descriptorChoices >= PROVIDER_OPTION_MAX_COUNT) break;
        if (budget.choices >= PROVIDER_OPTION_AGGREGATE_MAX_CHOICES) break;

        const group = boundedAcpConfigIdentity(entry.group, PROVIDER_OPTION_ID_MAX_LENGTH);
        if (!group) continue;
        const groupName =
          boundedAcpConfigPresentation(entry.name, PROVIDER_OPTION_LABEL_MAX_LENGTH) ?? group;
        const groupTextStart = budget.textChars;
        if (!consumeAcpConfigText(budget, [group, groupName])) {
          textBudgetExhausted = true;
          break;
        }

        const groupOptions: Array<EffectAcpSchema.SessionConfigSelectOption> = [];
        for (const nested of entry.options) {
          if (
            descriptorChoices >= PROVIDER_OPTION_MAX_COUNT ||
            budget.choices >= PROVIDER_OPTION_AGGREGATE_MAX_CHOICES
          ) {
            break;
          }
          const choice = boundAcpConfigSelectOption(nested);
          if (!choice) continue;
          if (!consumeAcpConfigText(budget, acpConfigSelectOptionText(choice))) {
            textBudgetExhausted = true;
            break;
          }
          groupOptions.push(choice);
          descriptorChoices += 1;
          budget.choices += 1;
        }

        if (groupOptions.length > 0) {
          groups.push({ group, name: groupName, options: groupOptions });
        } else {
          budget.textChars = groupTextStart;
        }
        if (textBudgetExhausted) break;
      }

      if (option.options.length > 0 && descriptorChoices === 0) {
        budget.textChars = descriptorTextStart;
        if (textBudgetExhausted) break;
        continue;
      }
      bounded.push({
        type: "select",
        id,
        name,
        currentValue,
        options: groups,
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      });
    } else {
      const choices: Array<EffectAcpSchema.SessionConfigSelectOption> = [];
      for (const entry of option.options) {
        if (!("value" in entry)) break;
        if (
          descriptorChoices >= PROVIDER_OPTION_MAX_COUNT ||
          budget.choices >= PROVIDER_OPTION_AGGREGATE_MAX_CHOICES
        ) {
          break;
        }
        const choice = boundAcpConfigSelectOption(entry);
        if (!choice) continue;
        if (!consumeAcpConfigText(budget, acpConfigSelectOptionText(choice))) {
          textBudgetExhausted = true;
          break;
        }
        choices.push(choice);
        descriptorChoices += 1;
        budget.choices += 1;
      }

      if (option.options.length > 0 && descriptorChoices === 0) {
        budget.textChars = descriptorTextStart;
        if (textBudgetExhausted) break;
        continue;
      }
      bounded.push({
        type: "select",
        id,
        name,
        currentValue,
        options: choices,
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      });
    }
  }

  return bounded;
}

function visitSessionConfigOptionValues(
  configOption: EffectAcpSchema.SessionConfigOption,
  visit: (value: string) => boolean,
): void {
  if (configOption.type !== "select") return;
  for (const entry of configOption.options) {
    if ("value" in entry) {
      if (!visit(entry.value)) return;
      continue;
    }
    for (const option of entry.options) {
      if (!visit(option.value)) return;
    }
  }
}

export function collectSessionConfigOptionValues(
  configOption: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<string> {
  const values: Array<string> = [];
  visitSessionConfigOptionValues(configOption, (value) => {
    if (values.length >= PROVIDER_OPTION_MAX_COUNT) return false;
    values.push(value);
    return true;
  });
  return values;
}

export function sessionConfigOptionIncludesValue(
  configOption: EffectAcpSchema.SessionConfigOption,
  expected: string,
): boolean {
  let found = false;
  visitSessionConfigOptionValues(configOption, (value) => {
    found = value === expected;
    return !found;
  });
  return found;
}

export function summarizeSessionConfigOptionValuesForError(
  configOption: EffectAcpSchema.SessionConfigOption,
): { readonly values: ReadonlyArray<string>; readonly count: number } {
  const values: Array<string> = [];
  let count = 0;
  visitSessionConfigOptionValues(configOption, (value) => {
    count += 1;
    if (values.length < 16) {
      values.push(boundedAcpConfigPresentation(value, 256) ?? "[empty]");
    }
    return true;
  });
  return { values, count };
}

export function parseSessionModeState(
  sessionResponse: AcpSessionSetupResponse,
): AcpSessionModeState | undefined {
  const modes = sessionResponse.modes;
  if (!modes) return undefined;
  const currentModeId = modes.currentModeId.trim();
  if (!currentModeId) {
    return undefined;
  }
  const availableModes: Array<AcpSessionMode> = [];
  for (const mode of modes.availableModes) {
    const id = mode.id.trim();
    const name = mode.name.trim();
    if (!id || !name) {
      continue;
    }
    const description = mode.description?.trim() || undefined;
    availableModes.push(
      description !== undefined
        ? ({ id, name, description } satisfies AcpSessionMode)
        : ({ id, name } satisfies AcpSessionMode),
    );
  }
  if (availableModes.length === 0) {
    return undefined;
  }
  return {
    currentModeId,
    availableModes,
  };
}

function normalizePlanStepStatus(raw: unknown): "pending" | "inProgress" | "completed" {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    default:
      return "pending";
  }
}

function normalizeToolCallStatus(
  raw: unknown,
  fallback?: "pending" | "inProgress" | "completed" | "failed",
): "pending" | "inProgress" | "completed" | "failed" | undefined {
  switch (raw) {
    case "pending":
      return "pending";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return fallback;
  }
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: Array<string> = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const part = entry.trim();
      if (part.length > 0) {
        parts.push(part);
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const match = /`([^`]+)`/.exec(title);
  return match?.[1]?.trim() || undefined;
}

function extractToolCallCommand(rawInput: unknown, title: string | undefined): string | undefined {
  if (isRecord(rawInput)) {
    const directCommand = normalizeCommandValue(rawInput.command);
    if (directCommand) {
      return directCommand;
    }
    const executable = typeof rawInput.executable === "string" ? rawInput.executable.trim() : "";
    const args = normalizeCommandValue(rawInput.args);
    if (executable && args) {
      return `${executable} ${args}`;
    }
    if (executable) {
      return executable;
    }
  }
  return extractCommandFromTitle(title);
}

function extractTextContentFromToolCallContent(
  content: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined,
): string | undefined {
  if (!content) return undefined;
  const chunks: Array<string> = [];
  for (const entry of content) {
    if (entry.type !== "content") {
      continue;
    }
    const nestedContent = entry.content;
    if (nestedContent.type !== "text") {
      continue;
    }
    const text = nestedContent.text.trim();
    if (text.length > 0) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function normalizeToolKind(kind: unknown): string | undefined {
  return typeof kind === "string" && kind.trim().length > 0 ? kind.trim() : undefined;
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  const skillItemType = classifySkillLoadItemType({ kind });
  if (skillItemType) {
    return skillItemType;
  }
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "search":
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function makeToolCallState(
  input: {
    readonly toolCallId: string;
    readonly title?: string | null | undefined;
    readonly kind?: EffectAcpSchema.ToolKind | null | undefined;
    readonly status?: EffectAcpSchema.ToolCallStatus | null | undefined;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
    readonly content?: ReadonlyArray<EffectAcpSchema.ToolCallContent> | null | undefined;
    readonly locations?: ReadonlyArray<EffectAcpSchema.ToolCallLocation> | null | undefined;
  },
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  const toolCallId = input.toolCallId.trim();
  if (!toolCallId) {
    return undefined;
  }
  const title = input.title?.trim() || undefined;
  const command = extractToolCallCommand(input.rawInput, title);
  const textContent = extractTextContentFromToolCallContent(input.content);
  const normalizedTitle =
    title && title.toLowerCase() !== "terminal" && title.toLowerCase() !== "tool call"
      ? title
      : undefined;
  const data: Record<string, unknown> = { toolCallId };
  const kind = normalizeToolKind(input.kind);
  if (kind) {
    data.kind = kind;
  }
  if (command) {
    data.command = command;
  }
  if (input.rawInput !== undefined) {
    data.rawInput = input.rawInput;
  }
  if (input.rawOutput !== undefined) {
    data.rawOutput = input.rawOutput;
  }
  if (input.content !== undefined) {
    data.content = input.content;
  }
  if (input.locations !== undefined) {
    data.locations = input.locations;
  }
  const fallbackDetail = command ?? normalizedTitle ?? textContent;
  const hasPresentationSeed =
    title !== undefined ||
    kind !== undefined ||
    command !== undefined ||
    normalizedTitle !== undefined ||
    textContent !== undefined;
  const presentation = hasPresentationSeed
    ? deriveToolActivityPresentation({
        itemType:
          classifySkillLoadItemType({ kind, title }) ??
          classifyImageToolItemType({ kind, title }) ??
          canonicalItemTypeFromAcpToolKind(kind),
        title,
        detail: fallbackDetail,
        data,
        fallbackSummary: title ?? "Tool",
      })
    : undefined;
  const status = normalizeToolCallStatus(input.status, options?.fallbackStatus);
  return {
    toolCallId,
    ...(kind ? { kind } : {}),
    ...(presentation?.summary ? { title: presentation.summary } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(presentation?.detail ? { detail: presentation.detail } : {}),
    data,
  };
}

function parseTypedToolCallState(
  event: AcpToolCallUpdate,
  options?: {
    readonly fallbackStatus?: "pending" | "inProgress" | "completed" | "failed";
  },
): AcpToolCallState | undefined {
  return makeToolCallState(
    {
      toolCallId: event.toolCallId,
      title: event.title,
      kind: event.kind,
      status: event.status,
      rawInput: event.rawInput,
      rawOutput: event.rawOutput,
      content: event.content,
      locations: event.locations,
    },
    options,
  );
}

export function mergeToolCallState(
  previous: AcpToolCallState | undefined,
  next: AcpToolCallState,
): AcpToolCallState {
  const nextKind = typeof next.data.kind === "string" ? next.data.kind : undefined;
  const kind = nextKind ?? previous?.kind;
  const title = next.title ?? previous?.title;
  const status = next.status ?? previous?.status;
  const command = next.command ?? previous?.command;
  const detail = next.detail ?? previous?.detail;
  return {
    toolCallId: next.toolCallId,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(command ? { command } : {}),
    ...(detail ? { detail } : {}),
    data: {
      ...previous?.data,
      ...next.data,
    },
  };
}

export function parsePermissionRequest(
  params: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionRequest {
  const toolCall = makeToolCallState(
    {
      toolCallId: params.toolCall.toolCallId,
      title: params.toolCall.title,
      kind: params.toolCall.kind,
      status: params.toolCall.status,
      rawInput: params.toolCall.rawInput,
      rawOutput: params.toolCall.rawOutput,
      content: params.toolCall.content,
      locations: params.toolCall.locations,
    },
    { fallbackStatus: "pending" },
  );
  const kind = normalizeToolKind(params.toolCall.kind) ?? "unknown";
  const detail =
    toolCall?.command ??
    toolCall?.title ??
    toolCall?.detail ??
    (typeof params.sessionId === "string" ? `Session ${params.sessionId}` : undefined);
  return {
    kind,
    ...(detail ? { detail } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}

export function sessionUpdateIsReplay(params: EffectAcpSchema.SessionNotification): boolean {
  const meta = params._meta;
  return isRecord(meta) && meta.isReplay === true;
}

export interface SessionLoadGate {
  readonly active: boolean;
  readonly lastActivityAtMillis: number | undefined;
  readonly idleGap: Duration.Duration;
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
}

export const waitForSessionLoadReplayIdle = (input: {
  readonly gateRef: Ref.Ref<Option.Option<SessionLoadGate>>;
}): Effect.Effect<EffectAcpSchema.LoadSessionResponse, never> =>
  Effect.gen(function* () {
    const pollInterval = Duration.millis(25);
    while (true) {
      const gate = yield* Ref.get(input.gateRef);
      if (
        Option.isSome(gate) &&
        gate.value.active &&
        gate.value.lastActivityAtMillis !== undefined
      ) {
        const idleGapMillis = Duration.toMillis(gate.value.idleGap);
        const nowMillis = yield* Clock.currentTimeMillis;
        if (nowMillis - gate.value.lastActivityAtMillis >= idleGapMillis) {
          return syntheticLoadSessionResponseFromInitialize(gate.value.initializeResult);
        }
      }
      yield* Effect.sleep(pollInterval);
    }
  });

export function syntheticLoadSessionResponseFromInitialize(
  initializeResult: EffectAcpSchema.InitializeResponse,
): EffectAcpSchema.LoadSessionResponse {
  const meta = initializeResult._meta;
  const modelState = isRecord(meta) ? meta.modelState : undefined;
  const modeState = isRecord(meta) ? meta.modeState : undefined;
  const models = isSessionModelState(modelState) ? modelState : undefined;
  const modes = isSessionModeState(modeState) ? modeState : undefined;

  return {
    ...(models ? { models } : {}),
    ...(modes ? { modes } : {}),
    _meta: {
      t3SessionLoadReady: "replay_idle",
    },
  };
}

export function parseSessionUpdateEvent(params: EffectAcpSchema.SessionNotification): {
  readonly modeId?: string;
  readonly events: ReadonlyArray<AcpParsedSessionEvent>;
} {
  const upd = params.update;
  const events: Array<AcpParsedSessionEvent> = [];
  let modeId: string | undefined;

  switch (upd.sessionUpdate) {
    case "current_mode_update": {
      modeId = upd.currentModeId.trim();
      if (modeId) {
        events.push({
          _tag: "ModeChanged",
          modeId,
        });
      }
      break;
    }
    case "plan": {
      const plan = upd.entries.slice(0, PROVIDER_RUNTIME_MAX_PLAN_STEPS).map((entry, index) => {
        const step = entry.content.trim();
        return {
          step: step.length > 0 ? step : `Step ${index + 1}`,
          status: normalizePlanStepStatus(entry.status),
        };
      });
      if (plan.length > 0) {
        events.push({
          _tag: "PlanUpdated",
          payload: {
            plan,
          },
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call": {
      const toolCall = parseTypedToolCallState(upd, {
        fallbackStatus: "pending",
      });
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call_update": {
      const toolCall = parseTypedToolCallState(upd);
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "agent_message_chunk": {
      if (upd.content.type === "text" && upd.content.text.length > 0) {
        events.push({
          _tag: "ContentDelta",
          streamKind: "assistant_text",
          text: upd.content.text,
          rawPayload: params,
        });
      }
      break;
    }
    case "agent_thought_chunk": {
      if (upd.content.type === "text" && upd.content.text.length > 0) {
        events.push({
          _tag: "ContentDelta",
          streamKind: "reasoning_text",
          text: upd.content.text,
          rawPayload: params,
        });
      }
      break;
    }
    default:
      break;
  }

  return { ...(modeId !== undefined ? { modeId } : {}), events };
}
