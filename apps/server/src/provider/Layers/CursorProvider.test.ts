import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/schema";
import type { CursorSettings } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildCursorProviderSnapshot,
  buildCursorCapabilitiesFromConfigOptions,
  checkCursorProviderStatus,
  cursorCliVariantBaseSlug,
  discoverCursorModelsViaAcp,
  enrichCursorAutoModelCapabilities,
  getCursorFallbackModels,
  getCursorParameterizedModelPickerUnsupportedMessage,
  mergeCursorCliModelsIntoDiscoveredModels,
  parseCursorAboutOutput,
  parseCursorCliConfigChannel,
  parseCursorListModelsOutput,
  parseCursorVersionDate,
  resolveCursorAcpBaseModelId,
  resolveCursorAcpConfigUpdates,
} from "./CursorProvider.ts";

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

const runNode = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | FileSystem.FileSystem | Path.Path
  >,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const resolveMockAgentPath = Effect.fn("resolveMockAgentPath")(function* () {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(new URL("../../../scripts/acp-mock-agent.ts", import.meta.url));
});

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
    ...(options.find((option) => option.isDefault)?.id
      ? { currentValue: options.find((option) => option.isDefault)?.id }
      : {}),
  };
}

function booleanDescriptor(id: string, label: string, currentValue?: boolean) {
  return {
    id,
    label,
    type: "boolean" as const,
    ...(typeof currentValue === "boolean" ? { currentValue } : {}),
  };
}

const makeMockAgentWrapper = Effect.fn("makeMockAgentWrapper")(function* (
  extraEnv?: Record<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mockAgentPath = yield* resolveMockAgentPath();
  const dir = yield* fileSystem.makeTempDirectory({
    directory: NodeOS.tmpdir(),
    prefix: "cursor-provider-mock-",
  });
  const wrapperPath = path.join(dir, "fake-agent.sh");
  const mockAgentCommand = ["node", mockAgentPath].map((arg) => JSON.stringify(arg)).join(" ");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${mockAgentCommand} "$@"
`;
  yield* fileSystem.writeFileString(wrapperPath, script);
  yield* fileSystem.chmod(wrapperPath, 0o755);
  return wrapperPath;
});

const makeMockAgentWithAboutWrapper = Effect.fn("makeMockAgentWithAboutWrapper")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mockAgentPath = yield* resolveMockAgentPath();
  const dir = yield* fileSystem.makeTempDirectory({
    directory: NodeOS.tmpdir(),
    prefix: "cursor-provider-about-mock-",
  });
  const wrapperPath = path.join(dir, "fake-agent.sh");
  const mockAgentCommand = ["node", mockAgentPath].map((arg) => JSON.stringify(arg)).join(" ");
  const script = `#!/bin/sh
if [ "$1" = "about" ]; then
  printf 'CLI Version         2026.04.09-f2b0fcd\\n'
  printf 'User Email          cursor@example.com\\n'
  exit 0
fi
if [ "$1" = "--list-models" ] || [ "$1" = "models" ]; then
  printf 'Available models\\n'
  printf 'auto - Auto (default)\\n'
  printf 'composer-2 - Composer 2\\n'
  printf 'gpt-5.4 - GPT-5.4\\n'
  printf 'claude-opus-4-6 - Opus 4.6\\n'
  printf 'glm-5.3-flash - GLM 5.3 Flash\\n'
  exit 0
fi
exec ${mockAgentCommand} "$@"
`;
  yield* fileSystem.writeFileString(wrapperPath, script);
  yield* fileSystem.chmod(wrapperPath, 0o755);
  return wrapperPath;
});

const waitForFileContent = Effect.fn("waitForFileContent")(function* (
  filePath: string,
  attempts = 40,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const content = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.catch(() => Effect.void));
    if (content !== undefined) {
      if (content.trim().length > 0) {
        return content;
      }
    }
    yield* Effect.sleep("50 millis");
  }
  return yield* Effect.die(`Timed out waiting for file content at ${filePath}`);
});

const makeProviderStatusEnvFixture = Effect.fn("makeProviderStatusEnvFixture")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fileSystem.makeTempDirectory({
    directory: NodeOS.tmpdir(),
    prefix: "cursor-provider-status-env-",
  });
  return {
    requestLogPath: path.join(tempDir, "requests.ndjson"),
    wrapperPath: yield* makeMockAgentWithAboutWrapper(),
  };
});

const makeExitLogFixture = Effect.fn("makeExitLogFixture")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fileSystem.makeTempDirectory({
    directory: NodeOS.tmpdir(),
    prefix,
  });
  const exitLogPath = path.join(tempDir, "exit.log");
  return {
    exitLogPath,
    wrapperPath: yield* makeMockAgentWrapper({
      T3_ACP_EXIT_LOG_PATH: exitLogPath,
    }),
  };
});

const parameterizedGpt54ConfigOptions = [
  {
    type: "select",
    currentValue: "gpt-5.4-medium-fast",
    options: [{ name: "GPT-5.4", value: "gpt-5.4-medium-fast" }],
    category: "model",
    id: "model",
    name: "Model",
  },
  {
    type: "select",
    currentValue: "medium",
    options: [
      { name: "None", value: "none" },
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
      { name: "Extra High", value: "extra-high" },
    ],
    category: "thought_level",
    id: "reasoning",
    name: "Reasoning",
  },
  {
    type: "select",
    currentValue: "272k",
    options: [
      { name: "272K", value: "272k" },
      { name: "1M", value: "1m" },
    ],
    category: "model_config",
    id: "context",
    name: "Context",
  },
  {
    type: "select",
    currentValue: "false",
    options: [
      { name: "Off", value: "false" },
      { name: "Fast", value: "true" },
    ],
    category: "model_config",
    id: "fast",
    name: "Fast",
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

const parameterizedClaudeConfigOptions = [
  {
    type: "select",
    currentValue: "claude-4.6-opus-high-thinking",
    options: [{ name: "Opus 4.6", value: "claude-4.6-opus-high-thinking" }],
    category: "model",
    id: "model",
    name: "Model",
  },
  {
    type: "select",
    currentValue: "high",
    options: [
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
    ],
    category: "thought_level",
    id: "reasoning",
    name: "Reasoning",
  },
  {
    type: "boolean",
    currentValue: true,
    category: "model_config",
    id: "thinking",
    name: "Thinking",
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

const parameterizedClaudeModelOptionConfigOptions = [
  {
    type: "select",
    currentValue: "claude-opus-4-6",
    options: [{ name: "Opus 4.6", value: "claude-opus-4-6" }],
    category: "model",
    id: "model",
    name: "Model",
  },
  {
    type: "select",
    currentValue: "high",
    options: [
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
    ],
    category: "thought_level",
    id: "reasoning",
    name: "Reasoning",
  },
  {
    type: "select",
    currentValue: "max",
    options: [
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
      { name: "Max", value: "max" },
    ],
    category: "model_option",
    id: "effort",
    name: "Effort",
  },
  {
    type: "select",
    currentValue: "true",
    options: [
      { name: "Off", value: "false" },
      { name: "Fast", value: "true" },
    ],
    category: "model_config",
    id: "fast",
    name: "Fast",
  },
  {
    type: "select",
    currentValue: "true",
    options: [
      { name: "Off", value: "false" },
      { name: ":icon-brain:", value: "true" },
    ],
    category: "model_config",
    id: "thinking",
    name: "Thinking",
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

const baseCursorSettings: CursorSettings = {
  enabled: true,
  binaryPath: "cursor-agent",
  apiEndpoint: "",
  customModels: [],
};
const cursorAcpDiscoveryFailedMessage = [
  "Cursor ACP model discovery failed.",
  "Cursor CLI setup may be incomplete; install or enable the Cursor CLI, restart T3 Code, and try again.",
  "See https://cursor.com/docs/cli/installation.",
  "Check server logs for ACP details.",
].join(" ");
const missingCursorBinaryPath = "/definitely/not/installed/t3-cursor-agent";
const cursorCliCommandMissingMessage = [
  `Cursor CLI command \`${missingCursorBinaryPath}\` was not found.`,
  `Install or enable the Cursor CLI, make sure \`${missingCursorBinaryPath}\` is on PATH, then restart T3 Code.`,
  "See https://cursor.com/docs/cli/installation.",
].join(" ");

describe("getCursorFallbackModels", () => {
  it("does not publish any built-in cursor models before ACP discovery", () => {
    expect(
      getCursorFallbackModels({
        customModels: ["internal/cursor-model"],
      }).map((model) => model.slug),
    ).toEqual(["internal/cursor-model"]);
  });
});

describe("buildCursorProviderSnapshot", () => {
  it("downgrades ready status to warning when ACP model discovery times out", () => {
    expect(
      buildCursorProviderSnapshot({
        checkedAt: "2026-01-01T00:00:00.000Z",
        cursorSettings: baseCursorSettings,
        parsed: {
          version: "2026.04.09-f2b0fcd",
          status: "ready",
          auth: { status: "authenticated", type: "Team", label: "Cursor Team Subscription" },
        },
        discoveryWarning: "Cursor ACP model discovery timed out after 15000ms.",
      }),
    ).toMatchObject({
      status: "warning",
      message: "Cursor ACP model discovery timed out after 15000ms.",
      models: [],
    });
  });

  it("preserves provider error state while appending discovery warnings", () => {
    expect(
      buildCursorProviderSnapshot({
        checkedAt: "2026-01-01T00:00:00.000Z",
        cursorSettings: {
          ...baseCursorSettings,
          customModels: ["claude-sonnet-4-6"],
        },
        parsed: {
          version: "2026.04.09-f2b0fcd",
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
        },
        discoveryWarning: cursorAcpDiscoveryFailedMessage,
      }),
    ).toMatchObject({
      status: "error",
      message: `Cursor Agent is not authenticated. Run \`agent login\` and try again. ${cursorAcpDiscoveryFailedMessage}`,
      models: [
        {
          slug: "claude-sonnet-4-6",
          isCustom: true,
        },
      ],
    });
  });
});

describe("buildCursorCapabilitiesFromConfigOptions", () => {
  it("derives model capabilities from parameterized Cursor ACP config options", () => {
    expect(buildCursorCapabilitiesFromConfigOptions(parameterizedGpt54ConfigOptions)).toEqual(
      createModelCapabilities({
        optionDescriptors: [
          selectDescriptor("reasoning", "Reasoning", [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra High" },
          ]),
          selectDescriptor("contextWindow", "Context", [
            { id: "272k", label: "272K", isDefault: true },
            { id: "1m", label: "1M" },
          ]),
          booleanDescriptor("fastMode", "Fast", false),
        ],
      }),
    );
  });

  it("detects boolean thinking toggles from model_config options", () => {
    expect(buildCursorCapabilitiesFromConfigOptions(parameterizedClaudeConfigOptions)).toEqual(
      createModelCapabilities({
        optionDescriptors: [
          selectDescriptor("reasoning", "Reasoning", [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
          ]),
          booleanDescriptor("thinking", "Thinking", true),
        ],
      }),
    );
  });

  it("prefers the newer model_option effort control over legacy thought_level", () => {
    expect(
      buildCursorCapabilitiesFromConfigOptions(parameterizedClaudeModelOptionConfigOptions),
    ).toEqual(
      createModelCapabilities({
        optionDescriptors: [
          selectDescriptor("reasoning", "Effort", [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "max", label: "Max", isDefault: true },
          ]),
          booleanDescriptor("fastMode", "Fast", true),
          booleanDescriptor("thinking", "Thinking", true),
        ],
      }),
    );
  });

  it("maps Cursor Router Optimize For modes from Auto config options", () => {
    expect(
      buildCursorCapabilitiesFromConfigOptions([
        {
          type: "select",
          currentValue: "balanced",
          options: [
            { name: "Cost", value: "cost" },
            { name: "Balance", value: "balanced" },
            { name: "Intelligence", value: "intelligence" },
          ],
          category: "model_option",
          id: "optimize_for",
          name: "Optimize For",
        },
      ]),
    ).toEqual(
      createModelCapabilities({
        optionDescriptors: [
          {
            ...selectDescriptor("optimizeFor", "Optimize For", [
              { id: "cost", label: "Cost" },
              { id: "balanced", label: "Balance", isDefault: true },
              { id: "intelligence", label: "Intelligence" },
            ]),
            description: "Cursor Router mode for Auto: Cost, Balance, or Intelligence.",
          },
        ],
      }),
    );
  });
});

describe("enrichCursorAutoModelCapabilities", () => {
  it("synthesizes Optimize For for Auto when ACP omits the config option", () => {
    expect(enrichCursorAutoModelCapabilities(EMPTY_CAPABILITIES, "default", "Auto")).toEqual(
      createModelCapabilities({
        optionDescriptors: [
          {
            ...selectDescriptor("optimizeFor", "Optimize For", [
              { id: "cost", label: "Cost" },
              { id: "balanced", label: "Balance", isDefault: true },
              { id: "intelligence", label: "Intelligence" },
            ]),
            description: "Cursor Router mode for Auto: Cost, Balance, or Intelligence.",
          },
        ],
      }),
    );
  });

  it("leaves non-Auto models unchanged", () => {
    expect(
      enrichCursorAutoModelCapabilities(EMPTY_CAPABILITIES, "composer-2.5", "Composer 2.5"),
    ).toEqual(EMPTY_CAPABILITIES);
  });
});

describe("checkCursorProviderStatus", () => {
  it("reports the install docs when the Cursor CLI command is missing", async () => {
    const provider = await runNode(
      checkCursorProviderStatus({
        enabled: true,
        binaryPath: missingCursorBinaryPath,
        apiEndpoint: "",
        customModels: [],
      }),
    );

    expect(provider).toMatchObject({
      installed: false,
      status: "error",
      auth: { status: "unknown" },
      message: cursorCliCommandMissingMessage,
    });
  });

  it("passes the injected environment to ACP model discovery", async () => {
    const { requestLogPath, wrapperPath } = await runNode(makeProviderStatusEnvFixture());

    const provider = await runNode(
      checkCursorProviderStatus(
        {
          enabled: true,
          binaryPath: wrapperPath,
          apiEndpoint: "",
          customModels: [],
        },
        {
          ...process.env,
          T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        },
      ),
    );

    expect(provider.models.map((model) => model.slug)).toEqual([
      "default",
      "composer-2",
      "gpt-5.4",
      "claude-opus-4-6",
      "glm-5.3-flash",
    ]);
    await expect(runNode(waitForFileContent(requestLogPath))).resolves.toContain("initialize");
  });
});

describe("discoverCursorModelsViaAcp", () => {
  it("keeps the ACP probe runtime alive long enough to discover models", async () => {
    const wrapperPath = await runNode(makeMockAgentWrapper());

    const models = await runNode(
      discoverCursorModelsViaAcp({
        enabled: true,
        binaryPath: wrapperPath,
        apiEndpoint: "",
        customModels: [],
      }).pipe(Effect.scoped),
    );

    expect(models.map((model) => model.slug)).toEqual([
      "default",
      "composer-2",
      "gpt-5.4",
      "claude-opus-4-6",
    ]);
    expect(
      models
        .find((model) => model.slug === "default")
        ?.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id),
    ).toEqual(["optimizeFor"]);
  });

  it("closes the ACP probe runtime after discovery completes", async () => {
    const { exitLogPath, wrapperPath } = await runNode(
      makeExitLogFixture("cursor-provider-exit-log-"),
    );

    await runNode(
      discoverCursorModelsViaAcp({
        enabled: true,
        binaryPath: wrapperPath,
        apiEndpoint: "",
        customModels: [],
      }),
    );

    const exitLog = await runNode(waitForFileContent(exitLogPath));
    expect(exitLog).toContain("SIGTERM");
  });
});

describe("parseCursorAboutOutput", () => {
  it("parses json about output and forwards subscription metadata", () => {
    expect(
      parseCursorAboutOutput({
        code: 0,
        stdout: JSON.stringify({
          cliVersion: "2026.04.09-f2b0fcd",
          subscriptionTier: "Team",
          userEmail: "jmarminge@gmail.com",
        }),
        stderr: "",
      }),
    ).toEqual({
      version: "2026.04.09-f2b0fcd",
      status: "ready",
      auth: {
        status: "authenticated",
        email: "jmarminge@gmail.com",
        type: "Team",
        label: "Cursor Team Subscription",
      },
    });
  });

  it("treats json about output with a logged-out email as unauthenticated", () => {
    expect(
      parseCursorAboutOutput({
        code: 0,
        stdout: JSON.stringify({
          cliVersion: "2026.04.09-f2b0fcd",
          subscriptionTier: "Team",
          userEmail: "Not logged in",
        }),
        stderr: "",
      }),
    ).toEqual({
      version: "2026.04.09-f2b0fcd",
      status: "error",
      auth: {
        status: "unauthenticated",
      },
      message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
    });
  });

  it("treats json about output with a null email as unauthenticated", () => {
    expect(
      parseCursorAboutOutput({
        code: 0,
        stdout: JSON.stringify({
          cliVersion: "2026.04.09-f2b0fcd",
          subscriptionTier: null,
          userEmail: null,
        }),
        stderr: "",
      }),
    ).toEqual({
      version: "2026.04.09-f2b0fcd",
      status: "error",
      auth: {
        status: "unauthenticated",
      },
      message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
    });
  });
});

describe("Cursor parameterized model picker preview gating", () => {
  it("parses Cursor CLI version dates from build versions", () => {
    expect(parseCursorVersionDate("2026.04.08-c4e73a3")).toBe(20260408);
    expect(parseCursorVersionDate("2026.04.09")).toBe(20260409);
    expect(parseCursorVersionDate("not-a-version")).toBeUndefined();
  });

  it("parses the Cursor CLI channel from cli-config.json", () => {
    expect(parseCursorCliConfigChannel('{ "channel": "lab" }')).toBe("lab");
    expect(parseCursorCliConfigChannel('{ "channel": "stable" }')).toBe("stable");
    expect(parseCursorCliConfigChannel('{ "version": 1 }')).toBeUndefined();
    expect(parseCursorCliConfigChannel("not-json")).toBeUndefined();
  });

  it("returns no warning when the Cursor Agent is new enough", () => {
    expect(
      getCursorParameterizedModelPickerUnsupportedMessage({
        version: "2026.04.08-c4e73a3",
      }),
    ).toBeUndefined();
  });

  it("does not require the lab channel for model discovery", () => {
    expect(
      getCursorParameterizedModelPickerUnsupportedMessage({
        version: "2026.08.11-e8db854",
      }),
    ).toBeUndefined();
  });

  it("explains when the Cursor Agent version is too old", () => {
    expect(
      getCursorParameterizedModelPickerUnsupportedMessage({
        version: "2026.04.07-c4e73a3",
      }),
    ).toContain("too old");
  });
});

describe("cursor CLI model list parsing", () => {
  it("parses `cursor-agent --list-models` output including glm-5.3-flash", () => {
    expect(
      parseCursorListModelsOutput(`Available models

auto - Auto (default)
glm-5.2-high - GLM 5.2
glm-5.2-max - GLM 5.2 Max
glm-5.3-flash - GLM 5.3 Flash
composer-2.5-fast - Composer 2.5 Fast
`),
    ).toEqual([
      { slug: "default", name: "Auto" },
      { slug: "glm-5.2-high", name: "GLM 5.2" },
      { slug: "glm-5.2-max", name: "GLM 5.2 Max" },
      { slug: "glm-5.3-flash", name: "GLM 5.3 Flash" },
      { slug: "composer-2.5-fast", name: "Composer 2.5 Fast" },
    ]);
  });

  it("strips CLI effort/fast suffixes without treating flash as a variant", () => {
    expect(cursorCliVariantBaseSlug("glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(cursorCliVariantBaseSlug("glm-5.2-high")).toBe("glm-5.2");
    expect(cursorCliVariantBaseSlug("gpt-5.5-extra-high-fast")).toBe("gpt-5.5");
    expect(cursorCliVariantBaseSlug("claude-opus-5-thinking-high-fast")).toBe("claude-opus-5");
    expect(cursorCliVariantBaseSlug("composer-2.5-fast")).toBe("composer-2.5");
    expect(cursorCliVariantBaseSlug("gemini-3.7-flash")).toBe("gemini-3.7-flash");
  });

  it("adds CLI-only families without duplicating ACP parameterized bases", () => {
    const merged = mergeCursorCliModelsIntoDiscoveredModels(
      [
        {
          slug: "glm-5.2",
          name: "GLM 5.2",
          isCustom: false,
          capabilities: EMPTY_CAPABILITIES,
        },
        {
          slug: "default",
          name: "Auto",
          isCustom: false,
          capabilities: EMPTY_CAPABILITIES,
        },
      ],
      [
        { slug: "default", name: "Auto" },
        { slug: "glm-5.2-high", name: "GLM 5.2" },
        { slug: "glm-5.2-max", name: "GLM 5.2 Max" },
        { slug: "glm-5.3-flash", name: "GLM 5.3 Flash" },
      ],
    );
    expect(merged.map((model) => model.slug)).toEqual(["glm-5.2", "default", "glm-5.3-flash"]);
  });
});

describe("resolveCursorAcpBaseModelId", () => {
  it("drops bracket traits without rewriting raw ACP model ids", () => {
    expect(resolveCursorAcpBaseModelId("gpt-5.4[reasoning=medium,context=272k]")).toBe("gpt-5.4");
    expect(resolveCursorAcpBaseModelId("gpt-5.4-medium-fast")).toBe("gpt-5.4-medium-fast");
    expect(resolveCursorAcpBaseModelId("claude-4.6-opus-high-thinking")).toBe(
      "claude-4.6-opus-high-thinking",
    );
    expect(resolveCursorAcpBaseModelId("composer-2")).toBe("composer-2");
    expect(resolveCursorAcpBaseModelId("auto")).toBe("default");
    expect(resolveCursorAcpBaseModelId("auto-smart")).toBe("default");
  });
});

describe("resolveCursorAcpConfigUpdates", () => {
  it("maps Cursor model options onto separate ACP config option updates", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedGpt54ConfigOptions, [
        { id: "reasoning", value: "xhigh" },
        { id: "fastMode", value: true },
        { id: "contextWindow", value: "1m" },
      ]),
    ).toEqual([
      { configId: "reasoning", value: "extra-high" },
      { configId: "context", value: "1m" },
      { configId: "fast", value: "true" },
    ]);
  });

  it("maps boolean thinking toggles when the model exposes them separately", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedClaudeConfigOptions, [
        { id: "thinking", value: false },
      ]),
    ).toEqual([{ configId: "thinking", value: false }]);
  });

  it("maps explicit fastMode: false so the adapter can clear a prior fast selection", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedGpt54ConfigOptions, [
        { id: "fastMode", value: false },
      ]),
    ).toEqual([{ configId: "fast", value: "false" }]);
  });

  it("writes Cursor effort changes through the newer model_option config when available", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedClaudeModelOptionConfigOptions, [
        { id: "reasoning", value: "max" },
        { id: "thinking", value: false },
      ]),
    ).toEqual([
      { configId: "effort", value: "max" },
      { configId: "thinking", value: "false" },
    ]);
  });

  it("maps Optimize For selections onto the Cursor Router config option", () => {
    expect(
      resolveCursorAcpConfigUpdates(
        [
          {
            type: "select",
            currentValue: "balanced",
            options: [
              { name: "Cost", value: "cost" },
              { name: "Balance", value: "balanced" },
              { name: "Intelligence", value: "intelligence" },
            ],
            category: "model_option",
            id: "optimize_for",
            name: "Optimize For",
          },
        ],
        [{ id: "optimizeFor", value: "intelligence" }],
      ),
    ).toEqual([{ configId: "optimize_for", value: "intelligence" }]);
  });
});
