import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CursorSettings,
  EnvironmentId,
  GrokSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpServer } from "effect/unstable/http";
import * as NetAddress from "effect/unstable/net/NetAddress";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { makeCursorAdapter } from "../provider/Layers/CursorAdapter.ts";
import { makeGrokAdapter } from "../provider/Layers/GrokAdapter.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { execScriptSource, writeFakeCli } from "../testUtils/fakeCli.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const testLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-adapters-" }),
  ServerSettingsService.layerTest(),
).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("MCP session adapter contract", (it) => {
  for (const provider of ["cursor", "grok"] as const) {
    it.effect(`${provider} starts and sends with real registry credentials`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const requestLogPath = path.join(directory, "requests.jsonl");
        const binaryPath = yield* Effect.sync(() =>
          writeFakeCli({
            directory,
            name: `fake-${provider}`,
            env: { T3_ACP_REQUEST_LOG_PATH: requestLogPath },
            source: execScriptSource({
              scriptPath: path.join(process.cwd(), "apps/server/scripts/acp-mock-agent.ts"),
            }),
          }),
        );
        const registry = yield* McpSessionRegistry.__testing.make().pipe(
          Effect.provideService(
            HttpServer.HttpServer,
            HttpServer.HttpServer.of({
              address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 43123),
              serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
            }),
          ),
          Effect.provideService(
            ServerEnvironment.ServerEnvironment,
            ServerEnvironment.ServerEnvironment.of({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("mcp-adapters")),
              getDescriptor: Effect.die("unused"),
            }),
          ),
        );
        const threadId = ThreadId.make(`mcp-${provider}`);
        const issued = yield* registry.issue({
          threadId,
          providerInstanceId: ProviderInstanceId.make(provider),
          capabilities: new Set(),
        });
        yield* Effect.acquireRelease(
          Effect.sync(() => McpProviderSession.setMcpProviderSession(issued.config)),
          () => Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
        );
        const adapter =
          provider === "cursor"
            ? yield* makeCursorAdapter(decodeCursorSettings({ binaryPath }))
            : yield* makeGrokAdapter(decodeGrokSettings({ binaryPath }));
        yield* adapter.startSession({
          provider: ProviderDriverKind.make(provider),
          threadId,
          cwd: directory,
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "first message" });
        yield* adapter.sendTurn({ threadId, input: "follow-up message" });
        yield* adapter.stopSession(threadId);
        const requests = yield* fs.readFileString(requestLogPath);
        expect(requests).toContain("http://127.0.0.1:43123/mcp");
        expect(requests).toContain("t3-code");
        expect(requests).not.toContain("/computer-use");
        expect(requests).not.toContain("/automations");
      }).pipe(Effect.scoped),
    );
  }
});
