import { expect, it } from "@effect/vitest";

import { HTTP_ROUTER_CONFIG } from "./server.ts";

// The packaged Mac backend evaluates this module at process start. A missing
// live-layer binding (for example `GitHubCli.layer` without its import) is a
// ReferenceError in `dist/bin.mjs` and fails smoke-macos-backend.
it("evaluates the live server module used by the packaged backend", () => {
  expect(HTTP_ROUTER_CONFIG.maxParamLength).toBeGreaterThan(0);
});
