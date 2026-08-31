/**
 * Public Docs: https://cursor.com/docs/cli/acp#cursor-extension-methods
 * Additional reference provided by the Cursor team: https://anysphere.enterprise.slack.com/files/U068SSJE141/F0APT1HSZRP/cursor-acp-extension-method-schemas.md
 */
import {
  ENTITY_ID_MAX_LENGTH,
  PROVIDER_MODEL_ID_MAX_LENGTH,
  PROVIDER_OPTION_MAX_COUNT,
  PROVIDER_RUNTIME_MAX_PLAN_STEPS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS,
  PROVIDER_RUNTIME_USER_INPUT_HEADER_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH,
  SERVER_PROVIDER_LABEL_MAX_LENGTH,
  SERVER_PROVIDER_MODELS_MAX_ITEMS,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as AcpSchema from "effect-acp/schema";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const CursorEntityId = Schema.String.check(Schema.isMaxLength(ENTITY_ID_MAX_LENGTH));
const CursorUserInputId = Schema.String.check(
  Schema.isMaxLength(PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH),
);

const CursorAskQuestionOption = Schema.Struct({
  id: CursorUserInputId,
  label: Schema.String.check(
    Schema.isMaxLength(PROVIDER_RUNTIME_USER_INPUT_OPTION_LABEL_MAX_LENGTH),
  ),
});

const CursorAskQuestion = Schema.Struct({
  id: CursorUserInputId,
  prompt: Schema.String.check(Schema.isMaxLength(PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH)),
  options: Schema.Array(CursorAskQuestionOption).check(
    Schema.isMaxLength(PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS),
  ),
  allowMultiple: Schema.optional(Schema.Boolean),
});

export const CursorAskQuestionRequest = Schema.Struct({
  toolCallId: CursorEntityId,
  title: Schema.optional(
    Schema.String.check(Schema.isMaxLength(PROVIDER_RUNTIME_USER_INPUT_HEADER_MAX_LENGTH)),
  ),
  questions: Schema.Array(CursorAskQuestion).check(
    Schema.isMaxLength(PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS),
  ),
});

const CursorTodoStatus = Schema.String;

const CursorTodo = Schema.Struct({
  id: Schema.optional(CursorEntityId),
  content: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  status: Schema.optional(CursorTodoStatus),
});

const CursorPlanPhase = Schema.Struct({
  name: Schema.String,
  todos: Schema.Array(CursorTodo).check(Schema.isMaxLength(PROVIDER_RUNTIME_MAX_PLAN_STEPS)),
});

export const CursorCreatePlanRequest = Schema.Struct({
  toolCallId: CursorEntityId,
  name: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  plan: Schema.String,
  todos: Schema.Array(CursorTodo).check(Schema.isMaxLength(PROVIDER_RUNTIME_MAX_PLAN_STEPS)),
  isProject: Schema.optional(Schema.Boolean),
  phases: Schema.optional(
    Schema.Array(CursorPlanPhase).check(Schema.isMaxLength(PROVIDER_RUNTIME_MAX_PLAN_STEPS)),
  ),
});

export const CursorUpdateTodosRequest = Schema.Struct({
  toolCallId: CursorEntityId,
  todos: Schema.Array(CursorTodo).check(Schema.isMaxLength(PROVIDER_RUNTIME_MAX_PLAN_STEPS)),
  merge: Schema.Boolean,
});

const CursorAvailableModel = Schema.Struct({
  value: Schema.String.check(Schema.isMaxLength(PROVIDER_MODEL_ID_MAX_LENGTH)),
  name: Schema.String.check(Schema.isMaxLength(SERVER_PROVIDER_LABEL_MAX_LENGTH)),
  configOptions: Schema.optional(
    Schema.Array(AcpSchema.SessionConfigOption).check(
      Schema.isMaxLength(PROVIDER_OPTION_MAX_COUNT),
    ),
  ),
});

export const CursorListAvailableModelsResponse = Schema.Struct({
  models: Schema.Array(CursorAvailableModel).check(
    Schema.isMaxLength(SERVER_PROVIDER_MODELS_MAX_ITEMS),
  ),
});
export type CursorListAvailableModelsResponse = typeof CursorListAvailableModelsResponse.Type;

const decodeCursorListAvailableModelsResponseExit = Schema.decodeUnknownExit(
  CursorListAvailableModelsResponse,
);
const decodeCursorAvailableModelExit = Schema.decodeUnknownExit(CursorAvailableModel);
const decodeCursorSessionConfigOptionExit = Schema.decodeUnknownExit(AcpSchema.SessionConfigOption);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCursorSessionConfigOptions(
  value: unknown,
): ReadonlyArray<AcpSchema.SessionConfigOption> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options: Array<AcpSchema.SessionConfigOption> = [];
  for (const entry of value) {
    if (options.length >= PROVIDER_OPTION_MAX_COUNT) {
      break;
    }
    const decoded = decodeCursorSessionConfigOptionExit(entry);
    if (Exit.isSuccess(decoded)) {
      options.push(decoded.value);
    }
  }
  return options.length > 0 ? options : undefined;
}

function parseCursorAvailableModel(value: unknown): typeof CursorAvailableModel.Type | undefined {
  const decoded = decodeCursorAvailableModelExit(value);
  if (Exit.isSuccess(decoded)) {
    const slug = decoded.value.value.trim();
    const name = decoded.value.name.trim();
    if (!slug || !name) {
      return undefined;
    }
    return {
      ...decoded.value,
      value: slug,
      name,
    };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const slug = typeof value.value === "string" ? value.value.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!slug || !name || slug.length > PROVIDER_MODEL_ID_MAX_LENGTH) {
    return undefined;
  }
  const configOptions = parseCursorSessionConfigOptions(value.configOptions);
  return {
    value: slug,
    name: name.slice(0, SERVER_PROVIDER_LABEL_MAX_LENGTH),
    ...(configOptions ? { configOptions } : {}),
  };
}

/**
 * Decode `cursor/list_available_models` without failing the whole catalog
 * when one model or config option uses a newer shape than the schema.
 */
export function parseCursorListAvailableModelsResponse(
  value: unknown,
): CursorListAvailableModelsResponse {
  const decoded = decodeCursorListAvailableModelsResponseExit(value);
  if (Exit.isSuccess(decoded)) {
    return decoded.value;
  }
  const models: Array<typeof CursorAvailableModel.Type> = [];
  const rawModels = isRecord(value) && Array.isArray(value.models) ? value.models : [];
  for (const entry of rawModels) {
    if (models.length >= SERVER_PROVIDER_MODELS_MAX_ITEMS) {
      break;
    }
    const model = parseCursorAvailableModel(entry);
    if (model) {
      models.push(model);
    }
  }
  return { models };
}

export function extractAskQuestions(
  params: typeof CursorAskQuestionRequest.Type,
): ReadonlyArray<UserInputQuestion> {
  return params.questions.map((question) => ({
    id: question.id,
    header: "Question",
    question: question.prompt,
    multiSelect: question.allowMultiple === true,
    options:
      question.options.length > 0
        ? question.options.map((option) => ({
            label: option.label,
            description: option.label,
          }))
        : [{ label: "OK", description: "Continue" }],
  }));
}

export function extractPlanMarkdown(params: typeof CursorCreatePlanRequest.Type): string {
  return params.plan || "# Plan\n\n(Cursor did not supply plan text.)";
}

export function extractTodosAsPlan(params: typeof CursorUpdateTodosRequest.Type): {
  readonly explanation?: string;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
} {
  const plan = params.todos.flatMap((todo) => {
    // Fall back to the title when content is missing OR blank. `??` only
    // covers a missing content, so a present-but-empty content ("" or
    // whitespace) would shadow a real title and drop the step below.
    const step = todo.content?.trim() || todo.title?.trim() || "";
    if (step === "") {
      return [];
    }
    const status: "pending" | "inProgress" | "completed" =
      todo.status === "completed"
        ? "completed"
        : todo.status === "in_progress" || todo.status === "inProgress"
          ? "inProgress"
          : "pending";
    return [{ step, status }];
  });
  return { plan };
}
