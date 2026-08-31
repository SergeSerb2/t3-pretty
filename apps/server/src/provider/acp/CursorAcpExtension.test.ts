import { describe, expect, it } from "vite-plus/test";
import {
  PROVIDER_MODEL_ID_MAX_LENGTH,
  PROVIDER_RUNTIME_MAX_PLAN_STEPS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS,
  PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH,
  SERVER_PROVIDER_MODELS_MAX_ITEMS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  CursorAskQuestionRequest,
  CursorListAvailableModelsResponse,
  CursorUpdateTodosRequest,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
  parseCursorListAvailableModelsResponse,
} from "./CursorAcpExtension.ts";

describe("CursorAcpExtension", () => {
  it("rejects question, option, and todo collections beyond runtime event limits", () => {
    const decodeQuestions = Schema.decodeUnknownSync(CursorAskQuestionRequest);
    const baseQuestion = { id: "id", prompt: "Prompt", options: [] };
    expect(() =>
      decodeQuestions({
        toolCallId: "ask",
        questions: Array.from(
          { length: PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS + 1 },
          () => baseQuestion,
        ),
      }),
    ).toThrow();
    expect(() =>
      decodeQuestions({
        toolCallId: "ask",
        questions: [
          {
            ...baseQuestion,
            prompt: "x".repeat(PROVIDER_RUNTIME_USER_INPUT_QUESTION_MAX_LENGTH + 1),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeQuestions({
        toolCallId: "ask",
        questions: [
          {
            ...baseQuestion,
            options: Array.from(
              { length: PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS + 1 },
              (_, index) => ({ id: String(index), label: String(index) }),
            ),
          },
        ],
      }),
    ).toThrow();

    const decodeTodos = Schema.decodeUnknownSync(CursorUpdateTodosRequest);
    expect(() =>
      decodeTodos({
        toolCallId: "todos",
        merge: true,
        todos: Array.from({ length: PROVIDER_RUNTIME_MAX_PLAN_STEPS + 1 }, (_, index) => ({
          id: String(index),
          content: `Step ${index}`,
        })),
      }),
    ).toThrow();

    const decodeModels = Schema.decodeUnknownSync(CursorListAvailableModelsResponse);
    expect(() =>
      decodeModels({
        models: Array.from({ length: SERVER_PROVIDER_MODELS_MAX_ITEMS + 1 }, (_, index) => ({
          value: String(index),
          name: String(index),
        })),
      }),
    ).toThrow();
    expect(() =>
      decodeModels({
        models: [
          {
            value: "x".repeat(PROVIDER_MODEL_ID_MAX_LENGTH + 1),
            name: "Oversized",
          },
        ],
      }),
    ).toThrow();
  });

  it("extracts ask-question prompts from the real Cursor ACP payload shape", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-1",
      title: "Need input",
      questions: [
        {
          id: "language",
          prompt: "Which language should I use?",
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "rs", label: "Rust" },
          ],
          allowMultiple: false,
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "language",
        header: "Question",
        question: "Which language should I use?",
        multiSelect: false,
        options: [
          { label: "TypeScript", description: "TypeScript" },
          { label: "Rust", description: "Rust" },
        ],
      },
    ]);
  });

  it("defaults ask-question multi-select to false when Cursor omits allowMultiple", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-2",
      questions: [
        {
          id: "mode",
          prompt: "Which mode should I use?",
          options: [
            { id: "agent", label: "Agent" },
            { id: "plan", label: "Plan" },
          ],
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "mode",
        header: "Question",
        question: "Which mode should I use?",
        multiSelect: false,
        options: [
          { label: "Agent", description: "Agent" },
          { label: "Plan", description: "Plan" },
        ],
      },
    ]);
  });

  it("extracts plan markdown from the real Cursor create-plan payload shape", () => {
    const planMarkdown = extractPlanMarkdown({
      toolCallId: "plan-1",
      name: "Refactor parser",
      overview: "Tighten ACP parsing",
      plan: "# Plan\n\n1. Add schemas\n2. Remove casts",
      todos: [
        { id: "t1", content: "Add schemas", status: "in_progress" },
        { id: "t2", content: "Remove casts", status: "pending" },
      ],
      isProject: false,
    });

    expect(planMarkdown).toBe("# Plan\n\n1. Add schemas\n2. Remove casts");
  });

  it("projects todo updates into a plan shape and drops invalid entries", () => {
    expect(
      extractTodosAsPlan({
        toolCallId: "todos-1",
        todos: [
          { id: "1", content: "Inspect state", status: "completed" },
          { id: "2", content: "  Apply fix  ", status: "in_progress" },
          { id: "3", title: "Fallback title", status: "pending" },
          { id: "4", content: "Unknown status", status: "weird_status" },
          { id: "5", content: "   " },
        ],
        merge: true,
      }),
    ).toEqual({
      plan: [
        { step: "Inspect state", status: "completed" },
        { step: "Apply fix", status: "inProgress" },
        { step: "Fallback title", status: "pending" },
        { step: "Unknown status", status: "pending" },
      ],
    });
  });

  it("falls back to the title when content is present but blank", () => {
    expect(
      extractTodosAsPlan({
        toolCallId: "todos-2",
        todos: [
          { id: "1", content: "", title: "Titled step", status: "pending" },
          { id: "2", content: "   ", title: "Whitespace content", status: "in_progress" },
          { id: "3", content: "", title: "", status: "pending" },
        ],
        merge: true,
      }),
    ).toEqual({
      plan: [
        { step: "Titled step", status: "pending" },
        { step: "Whitespace content", status: "inProgress" },
      ],
    });
  });

  it("keeps valid models when one sibling fails strict schema decode", () => {
    const parsed = parseCursorListAvailableModelsResponse({
      models: [
        {
          value: "glm-5.2",
          name: "GLM 5.2",
          extraField: "ignored",
        },
        {
          value: "glm-5.3-flash",
          name: "GLM 5.3 Flash",
          configOptions: [
            {
              id: "reasoning",
              name: "Reasoning",
              category: "thought_level",
              type: "select",
              currentValue: "high",
              options: [
                { value: "high", name: "High" },
                { value: "max", name: "Max" },
              ],
            },
            {
              id: "unknown-new-control",
              name: "New Control",
              type: "range",
              currentValue: 3,
            },
          ],
        },
        {
          value: "",
          name: "Broken",
        },
      ],
    });

    expect(parsed.models.map((model) => model.value)).toEqual(["glm-5.2", "glm-5.3-flash"]);
    expect(parsed.models[1]?.configOptions?.map((option) => option.id)).toEqual(["reasoning"]);
  });

  it("decodes Cursor list_available_models responses with per-model config options", () => {
    const decoded = CursorListAvailableModelsResponse.make({
      models: [
        {
          value: "gpt-5.4",
          name: "GPT-5.4",
          configOptions: [
            {
              id: "reasoning",
              name: "Reasoning",
              category: "thought_level",
              type: "select",
              currentValue: "medium",
              options: [
                { value: "low", name: "Low" },
                { value: "medium", name: "Medium" },
              ],
            },
          ],
        },
      ],
    });

    expect(decoded.models[0]?.configOptions?.[0]?.id).toBe("reasoning");
  });
});
