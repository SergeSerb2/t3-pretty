import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { GrokSettings } from "@t3tools/provider-grok/settings";
import * as Effect from "effect/Effect";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { cursorMcpServers } from "@t3tools/provider-cursor/testing";
import { makeGrokAdapterV2 } from "@t3tools/provider-grok/testing";
import { ServerSettingsService } from "../serverSettings.ts";
import { execScriptSource, writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import { layerTestProviderHost } from "@t3tools/provider-testing/host";
import * as McpProviderSession from "@t3tools/provider-core/server/mcpSession";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const testLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-adapters-" }),
  ServerSettingsService.layerTest(),
  IdAllocator.layer,
  layerTestProviderHost().pipe(Layer.provide(NodeServices.layer)),
).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("MCP session adapter contract", (it) => {
  it.effect.each(["cursor", "grok"] as const)(
    "%s configures V2 sessions with real registry credentials",
    (provider) =>
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
        const adapter = yield* makeGrokAdapterV2({
          instanceId,
          settings: decodeGrokSettings({ binaryPath }),
          environment: {},
          hostPlatform: "darwin",
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
});
