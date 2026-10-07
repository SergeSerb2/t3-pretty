#!/usr/bin/env node
// PR builds skip desktop packaging. This reads the live route-layer source
// and fails if a 2735-style flatten drops a provide that HttpRouter.serve
// needs before it can log Listening and answer /.well-known/t3/environment.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const root = NodePath.resolve(here, "../..");

const required = [
  {
    file: "apps/server/src/ws.ts",
    needle: "yield* ServerBrowser.ServerBrowser",
    message:
      "Ws.layer must still yield ServerBrowser while building. If that changed, update this contract and the route-layer provides together.",
  },
  {
    file: "apps/server/src/server.ts",
    needle: "Layer.provide(ServerBrowser.layer.pipe(Layer.provide(DesktopBrowserChannel.layer)))",
    message:
      "makeRoutesLayer must provide ServerBrowser. Dropping it leaves HttpRouter.serve unfinished and the packaged backend never logs Listening.",
  },
  {
    file: "apps/server/src/server.ts",
    needle: "ServerBrowserStream.routeLayer",
    message: "makeRoutesLayer must keep ServerBrowserStream.routeLayer next to the WebSocket route.",
  },
  {
    file: "apps/server/src/server.ts",
    needle: "Layer.provide(PreviewBrowser.layer)",
    message: "ServerBrowser construction requires PreviewBrowser on the same route layer.",
  },
  {
    file: "apps/server/src/server.ts",
    needle: "Layer.provide(WebhookRoute.layer.pipe(Layer.provide(RelayDeliveryProof.layer)))",
    message:
      "HttpApiBuilder.layer(EnvironmentHttpApi) must provide the webhooks group. Omitting it hangs route construction the same way a missing ServerBrowser does.",
  },
];

export function assertDesktopListenContract(sourceRoot = root) {
  const failures = [];
  for (const check of required) {
    const path = NodePath.join(sourceRoot, check.file);
    const source = NodeFS.readFileSync(path, "utf8");
    if (!source.includes(check.needle)) {
      failures.push(`${check.file}: ${check.message}\n  missing: ${check.needle}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Desktop listen contract failed.\n\n${failures.join("\n\n")}`);
  }
}

if (import.meta.url === NodeURL.pathToFileURL(process.argv[1] ?? "").href) {
  assertDesktopListenContract();
  console.log("Desktop listen contract ok.");
}
