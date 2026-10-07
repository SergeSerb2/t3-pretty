import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import { assertDesktopListenContract } from "./check-desktop-listen-contract.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const pipeline = NodeFS.readFileSync(new URL("../../.buildkite/pipeline.yml", import.meta.url), "utf8");
const steps = pipeline.split(/(?=^  - label:)/mu).filter((block) => block.startsWith("  - label:"));
const contract = steps.find((block) => /^    key: desktop-listen-contract$/mu.test(block));

describe("desktop listen contract", () => {
  it("passes on this checkout", () => {
    assertDesktopListenContract();
  });

  it("fails when the webhooks HttpApi provide is dropped", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-listen-contract-"));
    const serverDir = NodePath.join(root, "apps/server/src");
    NodeFS.mkdirSync(serverDir, { recursive: true });
    NodeFS.copyFileSync(NodePath.join(here, "../../apps/server/src/ws.ts"), NodePath.join(serverDir, "ws.ts"));
    NodeFS.copyFileSync(
      NodePath.join(here, "../../apps/server/src/server.ts"),
      NodePath.join(serverDir, "server.ts"),
    );
    const broken = NodeFS.readFileSync(NodePath.join(serverDir, "server.ts"), "utf8").replace(
      "Layer.provide(WebhookRoute.layer.pipe(Layer.provide(RelayDeliveryProof.layer))),\n",
      "",
    );
    NodeFS.writeFileSync(NodePath.join(serverDir, "server.ts"), broken);
    assert.throws(() => assertDesktopListenContract(root), /webhooks group/u);
    NodeFS.rmSync(root, { recursive: true, force: true });
  });

  it("runs on PR branches so packaging skips cannot hide a listen hang", () => {
    assert.isString(contract);
    assert.include(contract, "node scripts/fork/check-desktop-listen-contract.mjs");
    assert.match(contract, /build\.branch != "main"/u);
    assert.notInclude(contract, "build.branch == \"main\"");
  });
});
