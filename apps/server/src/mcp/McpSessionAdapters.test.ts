import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  GrokSettings,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import { ChildProcessSpawner } from "effect/process";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../orchestration-v2/ProviderAdapter.ts";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { cursorMcpServers } from "../orchestration-v2/Adapters/CursorAdapterV2.ts";
import { makeGrokAdapterV2 } from "../orchestration-v2/Adapters/GrokAdapterV2.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { execScriptSource, writeFakeCli } from "../testUtils/fakeCli.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const testLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-adapters-" }),
  ServerSettingsService.layerTest(),
  IdAllocator.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("MCP session adapter contract", (it) => {
  for (const provider of ["cursor", "grok"] as const) {
    it.effect(`${provider} configures V2 sessions with real registry credentials`, () =>
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
        if (provider === "cursor") {
          const servers = cursorMcpServers(threadId);
          expect(servers?.["t3-code"]).toMatchObject({
            type: "http",
            url: issued.config.endpoint,
            headers: { Authorization: issued.config.authorizationHeader },
          });
          expect(Object.keys(servers ?? {})).toEqual(["t3-code"]);
          return;
        }
        const instanceId = ProviderInstanceId.make(provider);
        const adapter = makeGrokAdapterV2({
          instanceId,
          settings: decodeGrokSettings({ binaryPath }),
          environment: {},
          hostPlatform: "darwin",
          childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
          crypto: yield* Crypto.Crypto,
          fileSystem: fs,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig,
          selfInvocation: yield* resolveSelfInvocation(),
        });
        yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make(`mcp-${provider}`),
          modelSelection: { instanceId, model: "grok-build" },
          runtimePolicy: ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: directory,
          }),
        });
        const requests = yield* fs.readFileString(requestLogPath);
        expect(requests).toContain("http://127.0.0.1:43123/mcp");
        expect(requests).toContain("t3-code");
        expect(requests).not.toContain("/computer-use");
        expect(requests).not.toContain("/automations");
      }).pipe(Effect.scoped),
    );
  }
});
