import { expect, it } from "@effect/vitest";

import { assertDesktopListenContract } from "../../../scripts/fork/check-desktop-listen-contract.mjs";
import { HTTP_ROUTER_CONFIG } from "./server.ts";

// The packaged Mac backend evaluates this module at process start. A missing
// live-layer binding (for example `GitHubCli.layer` without its import) is a
// ReferenceError in `dist/bin.mjs` and fails smoke-macos-backend. A missing
// ServerBrowser or webhooks HttpApi provide instead hangs before listen;
// the source contract below and server.desktopListen.test.ts cover that.
it("evaluates the live server module used by the packaged backend", () => {
  expect(HTTP_ROUTER_CONFIG.maxParamLength).toBeGreaterThan(0);
});

it("keeps the route-layer provides HttpRouter.serve needs before listen", () => {
  assertDesktopListenContract();
});
