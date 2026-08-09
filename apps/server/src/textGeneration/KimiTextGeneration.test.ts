// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { KimiSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { makeKimiTextGeneration } from "./KimiTextGeneration.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const PromptResponseJson = Schema.fromJsonString(
  Schema.Struct({
    subject: Schema.String,
    body: Schema.String,
  }),
);
const encodePromptResponse = Schema.encodeSync(PromptResponseJson);
const RequestLogEntryJson = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.optional(Schema.String),
    params: Schema.optional(
      Schema.Struct({
        configId: Schema.optional(Schema.String),
        value: Schema.optional(Schema.Unknown),
      }),
    ),
  }),
);
const decodeRequestLogEntry = Schema.decodeUnknownSync(RequestLogEntryJson);
const currentDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(currentDirectory, "../../scripts/acp-mock-agent.ts");

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function makeKimiWrapper(directory: string, environment: Record<string, string>) {
  const binaryPath = NodePath.join(directory, "kimi");
  NodeFS.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      "export T3_ACP_KIMI=1",
      ...Object.entries(environment).map(
        ([key, value]) => `export ${key}=${shellSingleQuote(value)}`,
      ),
      'if [ "$1" != "acp" ]; then exit 11; fi',
      `exec node ${JSON.stringify(mockAgentPath)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

const testLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-kimi-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("KimiTextGeneration", (it) => {
  it.effect("generates structured text through Kimi ACP and applies model options", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-kimi-text-acp-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      );
      const requestLogPath = NodePath.join(directory, "requests.ndjson");
      const binaryPath = makeKimiWrapper(directory, {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: encodePromptResponse({
          subject: "Integrate Kimi through ACP",
          body: "- preserve provider lifecycle behavior",
        }),
      });
      const textGeneration = yield* makeKimiTextGeneration(decodeKimiSettings({ binaryPath }));

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "feature/kimi",
        stagedSummary: "M apps/server/src/provider/Layers/KimiAdapter.ts",
        stagedPatch:
          "diff --git a/apps/server/src/provider/Layers/KimiAdapter.ts b/apps/server/src/provider/Layers/KimiAdapter.ts",
        modelSelection: {
          instanceId: ProviderInstanceId.make("kimi"),
          model: "kimi-code/k3-256k",
          options: [{ id: "thinking", value: "max" }],
        },
      });
      expect(generated).toEqual({
        subject: "Integrate Kimi through ACP",
        body: "- preserve provider lifecycle behavior",
      });

      const requests = NodeFS.readFileSync(requestLogPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => decodeRequestLogEntry(line));
      expect(
        requests.some(
          (request) =>
            request.method === "session/set_config_option" &&
            request.params?.configId === "model" &&
            request.params?.value === "kimi-code/k3-256k",
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.method === "session/set_config_option" &&
            request.params?.configId === "thinking" &&
            request.params?.value === "max",
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.method === "session/set_config_option" &&
            request.params?.configId === "mode" &&
            request.params?.value === "yolo",
        ),
      ).toBe(true);
    }).pipe(Effect.scoped),
  );
});
