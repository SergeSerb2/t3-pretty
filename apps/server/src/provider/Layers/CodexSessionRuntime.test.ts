// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";
import {
  DEFAULT_MODEL,
  PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS,
  PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS,
  PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH,
  ThreadId,
} from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexDeveloperInstructions,
  codexDefaultModeDeveloperInstructions,
  codexPlanModeDeveloperInstructions,
} from "../CodexDeveloperInstructions.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import {
  buildTurnStartParams,
  CODEX_STDERR_FRAGMENT_MAX_CHARS,
  describeMcpElicitation,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  makeCodexSessionRuntime,
  isTerminalCodexChildNotification,
  makeMemoryConsolidationNotificationFilter,
  normalizeCodexUserInputQuestions,
  openCodexThread,
  splitCodexStderrChunk,
  toMcpElicitationResponse,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

describe("CodexSessionRuntimeIdentifierGenerationError", () => {
  it("retains identifier purpose and the random source failure", () => {
    const cause = new Error("random source unavailable");
    const error = new CodexErrors.CodexAppServerIdentifierGenerationError({
      purpose: "provider-event",
      cause,
    });

    NodeAssert.equal(error.purpose, "provider-event");
    NodeAssert.strictEqual(error.cause, cause);
    NodeAssert.equal(
      error.message,
      "Failed to generate Codex App Server identifier for provider-event.",
    );
  });
});

describe("splitCodexStderrChunk", () => {
  it("bounds incomplete and completed stderr fragments", () => {
    const oversized = "x".repeat(CODEX_STDERR_FRAGMENT_MAX_CHARS + 1_000);

    const [noLines, remainder] = splitCodexStderrChunk("", oversized);
    NodeAssert.deepEqual(noLines, []);
    NodeAssert.equal(remainder.length, CODEX_STDERR_FRAGMENT_MAX_CHARS);

    const [lines, nextRemainder] = splitCodexStderrChunk(remainder, "tail\r\nnext");
    NodeAssert.equal(lines.length, 1);
    NodeAssert.equal(lines[0]?.length, CODEX_STDERR_FRAGMENT_MAX_CHARS);
    NodeAssert.equal(nextRemainder, "next");
  });
});

describe("normalizeCodexUserInputQuestions", () => {
  const freeformQuestion = {
    id: "answer",
    header: "Answer",
    question: "What should Codex do next?",
    options: null,
  } as const;

  it("keeps valid free-form questions without inventing options", () => {
    NodeAssert.deepEqual(normalizeCodexUserInputQuestions([freeformQuestion]), [
      {
        id: "answer",
        header: "Answer",
        question: "What should Codex do next?",
        options: [],
        multiSelect: false,
      },
    ]);
  });

  it("rejects question sets that cannot cross the canonical contract", () => {
    NodeAssert.equal(
      normalizeCodexUserInputQuestions(
        Array.from(
          { length: PROVIDER_RUNTIME_MAX_USER_INPUT_QUESTIONS + 1 },
          () => freeformQuestion,
        ),
      ),
      undefined,
    );
    NodeAssert.equal(
      normalizeCodexUserInputQuestions([
        { ...freeformQuestion, id: "x".repeat(PROVIDER_RUNTIME_USER_INPUT_ID_MAX_LENGTH + 1) },
      ]),
      undefined,
    );
    NodeAssert.equal(
      normalizeCodexUserInputQuestions([
        {
          ...freeformQuestion,
          options: Array.from(
            { length: PROVIDER_RUNTIME_MAX_USER_INPUT_OPTIONS + 1 },
            (_, index) => ({ label: `option-${index}`, description: "description" }),
          ),
        },
      ]),
      undefined,
    );
  });
});

describe("isTerminalCodexChildNotification", () => {
  it("settles closed and non-retrying children only", () => {
    NodeAssert.equal(
      isTerminalCodexChildNotification({ method: "thread/closed", params: {} }),
      true,
    );
    NodeAssert.equal(
      isTerminalCodexChildNotification({ method: "error", params: { willRetry: false } }),
      true,
    );
    NodeAssert.equal(
      isTerminalCodexChildNotification({ method: "error", params: { willRetry: true } }),
      false,
    );
    NodeAssert.equal(
      isTerminalCodexChildNotification({ method: "turn/completed", params: {} }),
      false,
    );
  });
});

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("keeps invalid turn values only in the schema cause", () => {
    const secret = "codex-turn-input-secret-sentinel";
    const error = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        attachments: [
          {
            type: "image",
            url: { secret } as unknown as string,
          },
        ],
      }).pipe(Effect.flip),
    );
    const { cause, ...directDiagnostics } = error;

    NodeAssert.equal(error.operation, "decode-request-payload");
    NodeAssert.equal(error.method, "turn/start");
    NodeAssert.ok((error.issueCount ?? 0) > 0);
    NodeAssert.ok(error.issueKinds?.includes("Pointer"));
    NodeAssert.ok((error.maximumPathDepth ?? 0) > 0);
    NodeAssert.ok(Schema.isSchemaError(cause));
    NodeAssert.doesNotMatch(error.message, new RegExp(secret));
    NodeAssert.doesNotMatch(JSON.stringify(directDiagnostics), new RegExp(secret));
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
        browserToolsAvailable: true,
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions(
            "plan",
            {
              model: "gpt-5.3-codex",
              reasoningEffort: "medium",
            },
            true,
          ),
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        browserToolsAvailable: true,
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions(
            "default",
            {
              model: "gpt-5.3-codex",
              reasoningEffort: "medium",
            },
            true,
          ),
        },
      },
    });
  });

  it("reports the same fallback model and effort in settings and instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Go",
        interactionMode: "default",
      }),
    );

    const settings = params.collaborationMode?.settings;
    NodeAssert.equal(settings?.model, DEFAULT_MODEL);
    NodeAssert.equal(settings?.reasoning_effort, "medium");
    NodeAssert.ok(settings?.developer_instructions?.includes(`as ${DEFAULT_MODEL} with medium`));
  });

  it.effect("routes approvals to the auto reviewer in auto mode", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto",
        prompt: "Ship it",
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        input: [
          {
            type: "text",
            text: "Ship it",
          },
        ],
      });
    }),
  );

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("Codex MCP elicitation approvals", () => {
  const request = {
    mode: "form",
    message: "Allow ChatGPT to use Safari?",
    serverName: "computer-use",
    threadId: "provider-thread-1",
    turnId: "turn-1",
    _meta: {
      app_name: "Safari",
      persist: ["session", "always"],
    },
    requestedSchema: {
      type: "object",
      properties: {
        approval: {
          type: "string",
          oneOf: [
            { const: "once", title: "Allow once" },
            { const: "session", title: "Allow for this session" },
            { const: "always", title: "Always allow Safari" },
          ],
        },
      },
      required: ["approval"],
    },
  } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

  it("preserves the app name and advertised persistence choices", () => {
    NodeAssert.deepStrictEqual(describeMcpElicitation(request), {
      appName: "Safari",
      options: [
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
        { decision: "acceptForSession", label: "Allow for this session" },
        { decision: "acceptAlways", label: "Always allow Safari" },
        { decision: "accept", label: "Approve" },
      ],
    });
  });

  it("extracts the app name from a Computer Use request without metadata", () => {
    const { _meta, ...requestWithoutMetadata } = request;

    NodeAssert.equal(describeMcpElicitation(requestWithoutMetadata).appName, "Safari");
  });

  it("returns the accepted form option to Codex", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "accept"), {
      action: "accept",
      content: { approval: "once" },
    });
  });

  it("returns session-scoped approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptForSession"), {
      action: "accept",
      _meta: { persist: "session" },
      content: { approval: "session" },
    });
  });

  it("returns persistent approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("returns rejection without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "decline"), {
      action: "decline",
    });
  });

  it("returns cancellation without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "cancel"), {
      action: "cancel",
    });
  });

  it("supports boolean permanent-approval fields", () => {
    const booleanRequest = {
      ...request,
      _meta: { app_name: "Safari" },
      requestedSchema: {
        type: "object",
        properties: {
          always: { type: "boolean", title: "Always allow Safari" },
        },
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.ok(
      describeMcpElicitation(booleanRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(booleanRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { always: true },
    });
  });

  it("preserves valid nullable MCP form fields and persistence choices", () => {
    const nullableRequest = {
      ...request,
      _meta: {
        app_name: null,
        appName: "Safari",
        connector_name: null,
        persist: null,
        target: null,
        tool_params: null,
      },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            title: null,
            description: null,
            default: null,
            enum: ["once", "always"],
            enumNames: null,
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.equal(describeMcpElicitation(nullableRequest).appName, "Safari");
    NodeAssert.ok(
      describeMcpElicitation(nullableRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(nullableRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("declines required form fields that an approval prompt cannot collect", () => {
    const inputRequest = {
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
        },
        required: ["email"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(inputRequest, "accept"), {
      action: "decline",
    });
  });

  it("does not approve URL elicitations without opening their requested URL", () => {
    const urlRequest = {
      mode: "url",
      message: "Finish signing in to continue.",
      serverName: "computer-use",
      threadId: "provider-thread-1",
      turnId: "turn-1",
      elicitationId: "sign-in-1",
      url: "https://example.com/authorize",
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(urlRequest, "accept"), {
      action: "decline",
    });
  });

  it("omits persistence choices that cannot satisfy required form fields", () => {
    const onceOnlyRequest = {
      ...request,
      _meta: { app_name: "Safari", persist: ["session", "always"] },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            enum: ["once"],
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(describeMcpElicitation(onceOnlyRequest).options, [
      { decision: "cancel", label: "Cancel" },
      { decision: "decline", label: "Decline" },
      { decision: "accept", label: "Approve" },
    ]);
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("appends runtime info after the mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    NodeAssert.ok(instructions.startsWith(codexDefaultModeDeveloperInstructions(false)));
    NodeAssert.match(instructions, /T3 Code/);
    NodeAssert.match(instructions, /Codex harness/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with high reasoning effort/);
  });

  it("includes runtime info alongside plan mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("plan", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    NodeAssert.ok(instructions.startsWith(codexPlanModeDeveloperInstructions(false)));
    NodeAssert.match(instructions, /as gpt-5\.3-codex with medium reasoning effort/);
  });

  it("varies with the model and effort of each turn", () => {
    const first = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
    const second = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    NodeAssert.notEqual(first, second);
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("T3 browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      codexDefaultModeDeveloperInstructions(true),
      codexPlanModeDeveloperInstructions(true),
    ]) {
      NodeAssert.match(instructions, /t3-code/);
      NodeAssert.match(instructions, /preview_status/);
      NodeAssert.match(instructions, /preview_open/);
      NodeAssert.match(instructions, /Do not switch to global browser skills/);
    }
  });

  it("omits the browser block entirely when the preview tools are not attached", () => {
    for (const instructions of [
      codexDefaultModeDeveloperInstructions(false),
      codexPlanModeDeveloperInstructions(false),
    ]) {
      NodeAssert.doesNotMatch(instructions, /preview_status/);
      NodeAssert.doesNotMatch(instructions, /preview_open/);
      NodeAssert.doesNotMatch(instructions, /T3 Code collaborative browser/);
      // Steering away from other browser automation must go with the tools;
      // keeping it would leave the model talked out of its only option.
      NodeAssert.doesNotMatch(instructions, /Do not switch to global browser skills/);
      // The rest of the collaboration mode is untouched.
      NodeAssert.match(instructions, /<collaboration_mode>/);
      NodeAssert.match(instructions, /<\/collaboration_mode>/);
    }
  });

  it("tracks the turn's MCP configuration rather than defaulting to on", () => {
    const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };
    NodeAssert.match(buildCodexDeveloperInstructions("default", runtime, true), /preview_open/);
    NodeAssert.doesNotMatch(
      buildCodexDeveloperInstructions("default", runtime, false),
      /preview_open/,
    );
  });

  it.effect("defaults to no browser instructions without an explicit preview capability", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-computer-only",
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      NodeAssert.doesNotMatch(
        params.collaborationMode?.settings.developer_instructions ?? "",
        /preview_open/,
      );
    }),
  );
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    NodeAssert.equal(hasConfiguredMcpServer(undefined), false);
    NodeAssert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.t3-code.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

describe("T3 computer developer instructions", () => {
  it("tracks the turn's attached computer-use capability", () => {
    const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };
    const enabled = buildCodexDeveloperInstructions("default", runtime, false, true);
    const disabled = buildCodexDeveloperInstructions("default", runtime, false, false);

    NodeAssert.match(enabled, /t3-code-computer/);
    NodeAssert.match(enabled, /computer_screen_info/);
    NodeAssert.match(enabled, /Quartz global display coordinates/);
    NodeAssert.doesNotMatch(disabled, /t3-code-computer/);
    NodeAssert.doesNotMatch(disabled, /computer_screen_info/);
  });

  it.effect("defaults to no computer instructions without an explicit capability", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-preview-only",
        runtimeMode: "full-access",
        interactionMode: "default",
        browserToolsAvailable: true,
      });

      NodeAssert.doesNotMatch(
        params.collaborationMode?.settings.developer_instructions ?? "",
        /t3-code-computer/,
      );
    }),
  );
});

function makeThreadStartedNotification(
  threadId: string,
  source: EffectCodexSchema.V2ThreadStartedNotification["thread"]["source"],
  threadSource?: string,
) {
  return {
    method: "thread/started" as const,
    params: {
      thread: {
        cliVersion: "0.0.0",
        createdAt: 0,
        cwd: "/tmp/project",
        ephemeral: true,
        id: threadId,
        modelProvider: "openai",
        preview: "",
        sessionId: threadId,
        source,
        status: { type: "idle" as const },
        ...(threadSource ? { threadSource } : {}),
        turns: [],
        updatedAt: 0,
      },
    },
  };
}

describe("makeMemoryConsolidationNotificationFilter", () => {
  it("suppresses memory consolidation without hiding other Codex subagents", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
      ),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "internal memory update",
          itemId: "memory-message",
          threadId: "memory-thread",
          turnId: "memory-turn",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "serverRequest/resolved",
        params: {
          requestId: "memory-approval",
          threadId: "memory-thread",
        },
      }),
      false,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "warning",
        params: {
          message: "internal warning",
          threadId: "memory-thread",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "normal reply",
          itemId: "root-message",
          threadId: "root-thread",
          turnId: "root-turn",
        },
      }),
      false,
    );

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("legacy-memory-thread", {
          subAgent: "memory_consolidation",
        }),
      ),
      true,
    );

    for (const source of [
      { subAgent: "review" as const },
      { subAgent: "compact" as const },
      {
        subAgent: {
          thread_spawn: {
            depth: 1,
            parent_thread_id: "root-thread",
          },
        },
      },
    ]) {
      NodeAssert.equal(
        shouldSuppress(makeThreadStartedNotification("visible-subagent", source)),
        false,
      );
    }
  });

  it("forgets memory consolidation threads after they close", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();
    shouldSuppress(
      makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
    );

    NodeAssert.equal(
      shouldSuppress({
        method: "thread/closed",
        params: { threadId: "memory-thread" },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "later message",
          itemId: "later-message",
          threadId: "memory-thread",
          turnId: "later-turn",
        },
      }),
      false,
    );
  });
});

describe("codexSessionAppServerArgs", () => {
  it("keeps the app-server subcommand when explicit args are provided", () => {
    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", "model=gpt-5"], undefined), [
      "app-server",
      "-c",
      "model=gpt-5",
    ]);
  });

  it("keeps launch args when explicit app-server args are provided", () => {
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(
        ["-c", "mcp_servers.t3-code.url=http://127.0.0.1/mcp"],
        "--strict-config --enable foo",
      ),
      [
        "app-server",
        "--strict-config",
        "--enable",
        "foo",
        "-c",
        "mcp_servers.t3-code.url=http://127.0.0.1/mcp",
      ],
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("matches a missing rollout for a known thread id", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "no rollout found for thread id 019fdf74-aaa9-7950-b252-7cc7a8650470",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it.effect("falls back to thread/start when resume fails recoverably", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const started = makeThreadOpenResponse("fresh-thread");
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          }
          return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      NodeAssert.equal(opened.thread.id, "fresh-thread");
      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
    }),
  );

  it.effect("propagates non-recoverable resume failures", () =>
    Effect.gen(function* () {
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          _payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "timed out waiting for server",
              }),
            );
          }
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };

      const error = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }).pipe(Effect.flip);

      NodeAssert.ok(isCodexAppServerRequestError(error));
      NodeAssert.equal(error.errorMessage, "timed out waiting for server");
    }),
  );
});

/**
 * Mid-turn sends must steer the running turn instead of queueing a new one.
 * The only way to observe that is the wire, so these tests boot the real
 * runtime against a throwaway app-server peer that logs every request it
 * receives and can be told to reject `turn/steer` the way Codex does for
 * non-steerable turns.
 */
const FIXTURE_PATH = NodePath.join(import.meta.dirname, "../testFixtures/codexMultiAgentWire.json");
const FIRST_TURN_ID = "019fe3e8-f908-7f31-8d51-283f4a47897a";
const SECOND_TURN_ID = "019fe3eb-8faf-7de3-a85b-ac64c7f9c8c3";

// Holds the first turn open (no turn/completed) so the session still looks
// "running" when the second send lands, and announces turn/started only for
// that first turn — Codex does not start a turn it merely queued.
const STEER_PEER_SOURCE = `#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

const fixture = JSON.parse(NodeFS.readFileSync(process.env.T3_STEER_FIXTURE, "utf8"));
const logPath = process.env.T3_STEER_LOG;
const rejectSteer = process.env.T3_STEER_REJECT === "1";
const turnIds = JSON.parse(process.env.T3_STEER_TURN_IDS);
let turnStarts = 0;

const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === undefined) return;
  NodeFS.appendFileSync(logPath, JSON.stringify({ method, params }) + "\\n");
  if (method === "initialize") {
    write({
      id,
      result: {
        userAgent: "t3-steer-mock/0.0.0",
        codexHome: "/tmp",
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
    return;
  }
  if (method === "thread/start" || method === "thread/resume") {
    write({ id, result: fixture.responses.threadStart });
    return;
  }
  if (method === "turn/start") {
    const turn = { ...fixture.responses.turnStart.turn, id: turnIds[turnStarts] };
    turnStarts += 1;
    write({ id, result: { ...fixture.responses.turnStart, turn } });
    if (turnStarts === 1) {
      write({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: fixture.rootThreadId, turn },
      });
    }
    return;
  }
  if (method === "turn/steer") {
    if (rejectSteer) {
      write({ id, error: { code: -32000, message: "activeTurnNotSteerable" } });
      return;
    }
    write({ id, result: {} });
    return;
  }
  if (id !== undefined) write({ id, result: {} });
});
`;

interface SteerPeer {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly requests: () => ReadonlyArray<{ readonly method: string; readonly params?: unknown }>;
  readonly cleanup: () => void;
}

function makeSteerPeer(options: { readonly rejectSteer: boolean }): SteerPeer {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codex-steer-"));
  const binaryPath = NodePath.join(dir, "peer.mjs");
  const logPath = NodePath.join(dir, "requests.jsonl");
  NodeFS.writeFileSync(binaryPath, STEER_PEER_SOURCE, { encoding: "utf8", mode: 0o755 });
  NodeFS.writeFileSync(logPath, "", "utf8");
  return {
    binaryPath,
    environment: {
      ...process.env,
      T3_STEER_FIXTURE: FIXTURE_PATH,
      T3_STEER_LOG: logPath,
      T3_STEER_REJECT: options.rejectSteer ? "1" : "0",
      T3_STEER_TURN_IDS: JSON.stringify([FIRST_TURN_ID, SECOND_TURN_ID]),
    },
    requests: () =>
      NodeFS.readFileSync(logPath, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { method: string; params?: unknown }),
    cleanup: () => NodeFS.rmSync(dir, { recursive: true, force: true }),
  };
}

const turnMethods = (peer: SteerPeer) =>
  peer
    .requests()
    .map((request) => request.method)
    .filter((method) => method.startsWith("turn/"));

// it.live: the runtime drives a real child process, and it.effect's TestClock
// freezes the transport's own timers.
describe("CodexSessionRuntime sendTurn steering", () => {
  it.live("infers built-in tool instructions from MCP config after resume", () =>
    Effect.gen(function* () {
      const peer = makeSteerPeer({ rejectSteer: false });
      yield* Effect.addFinalizer(() => Effect.sync(peer.cleanup));

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-resume-tools"),
        binaryPath: peer.binaryPath,
        cwd: "/tmp",
        runtimeMode: "full-access",
        environment: peer.environment,
        resumeCursor: { threadId: "provider-thread-resume-tools" },
        appServerArgs: [
          "-c",
          "mcp_servers.t3-code.url=http://127.0.0.1/mcp",
          "-c",
          "mcp_servers.t3-code-computer.url=http://127.0.0.1/mcp/computer-use",
        ],
      });

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "inspect the desktop", interactionMode: "default" });

      const turnStart = peer.requests().find((request) => request.method === "turn/start");
      const params = turnStart?.params as
        | {
            readonly collaborationMode?: {
              readonly settings?: { readonly developer_instructions?: string };
            };
          }
        | undefined;
      const instructions = params?.collaborationMode?.settings?.developer_instructions ?? "";
      NodeAssert.match(instructions, /preview_open/);
      NodeAssert.match(instructions, /t3-code-computer/);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("steers the active turn instead of starting a second one mid-turn", () =>
    Effect.gen(function* () {
      const peer = makeSteerPeer({ rejectSteer: false });
      yield* Effect.addFinalizer(() => Effect.sync(peer.cleanup));

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-steer"),
        binaryPath: peer.binaryPath,
        cwd: "/tmp",
        runtimeMode: "full-access",
        environment: peer.environment,
      });

      const turnStartedFiber = yield* runtime.events.pipe(
        Stream.filter((event) => event.method === "turn/started"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      const first = yield* runtime.sendTurn({ input: "keep working" });
      NodeAssert.equal(first.turnId, FIRST_TURN_ID);
      // An idle send must be a plain turn/start — no steer before a turn runs.
      NodeAssert.deepStrictEqual(turnMethods(peer), ["turn/start"]);

      const started = yield* Fiber.join(turnStartedFiber).pipe(Effect.timeoutOption("15 seconds"));
      NodeAssert.equal(started._tag, "Some", "turn/started never arrived");

      const second = yield* runtime.sendTurn({ input: "also fix the tests" });

      NodeAssert.deepStrictEqual(turnMethods(peer), ["turn/start", "turn/steer"]);
      NodeAssert.equal(second.turnId, FIRST_TURN_ID);
      const steer = peer.requests().find((request) => request.method === "turn/steer");
      NodeAssert.deepStrictEqual(steer?.params, {
        threadId: "019fcfd6-17bb-72f0-ae12-a1f2dee6e3e5",
        expectedTurnId: FIRST_TURN_ID,
        input: [{ type: "text", text: "also fix the tests" }],
      });

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("never steers a mid-turn send whose delivery is queue", () =>
    Effect.gen(function* () {
      const peer = makeSteerPeer({ rejectSteer: false });
      yield* Effect.addFinalizer(() => Effect.sync(peer.cleanup));

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-queue-no-steer"),
        binaryPath: peer.binaryPath,
        cwd: "/tmp",
        runtimeMode: "full-access",
        environment: peer.environment,
      });

      const turnStartedFiber = yield* runtime.events.pipe(
        Stream.filter((event) => event.method === "turn/started"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "keep working" });
      const started = yield* Fiber.join(turnStartedFiber).pipe(Effect.timeoutOption("15 seconds"));
      NodeAssert.equal(started._tag, "Some", "turn/started never arrived");

      // The runtime still reports the turn as running (ingest lag from the
      // orchestrator's point of view); an explicit queue must not be injected
      // into that turn.
      const second = yield* runtime.sendTurn({ input: "after the turn", delivery: "queue" });

      NodeAssert.deepStrictEqual(turnMethods(peer), ["turn/start", "turn/start"]);
      NodeAssert.equal(second.turnId, SECOND_TURN_ID);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("falls back to turn/start when Codex rejects the steer", () =>
    Effect.gen(function* () {
      const peer = makeSteerPeer({ rejectSteer: true });
      yield* Effect.addFinalizer(() => Effect.sync(peer.cleanup));

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-steer-rejected"),
        binaryPath: peer.binaryPath,
        cwd: "/tmp",
        runtimeMode: "full-access",
        environment: peer.environment,
      });

      const turnStartedFiber = yield* runtime.events.pipe(
        Stream.filter((event) => event.method === "turn/started"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "review this" });
      const started = yield* Fiber.join(turnStartedFiber).pipe(Effect.timeoutOption("15 seconds"));
      NodeAssert.equal(started._tag, "Some", "turn/started never arrived");

      const second = yield* runtime.sendTurn({ input: "and then some" });

      NodeAssert.deepStrictEqual(turnMethods(peer), ["turn/start", "turn/steer", "turn/start"]);
      NodeAssert.equal(second.turnId, SECOND_TURN_ID);
      // Codex queued the follow-up: the turn that is actually running — and
      // the only one turn/interrupt accepts — stays pinned.
      const session = yield* runtime.getSession;
      NodeAssert.equal(session.activeTurnId, FIRST_TURN_ID);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
