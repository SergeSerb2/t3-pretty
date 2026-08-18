import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/fork-release.yml"),
  "utf8",
);
const mobileWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/fork-mobile-release.yml"),
  "utf8",
);
const relayWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/deploy-relay.yml"),
  "utf8",
);

function jobBlock(source, jobId) {
  const start = source.indexOf(`\n  ${jobId}:\n`);
  assert.isAtLeast(start, 0, `missing job ${jobId}`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n  [a-z][a-z0-9_]*:\n/u);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("T3 Pretty release runner placement", () => {
  it("keeps Mac and Windows runners only for native packaging", () => {
    const preflight = jobBlock(desktopWorkflow, "preflight");
    const wsl = jobBlock(desktopWorkflow, "build_wsl_node_pty");
    const mac = jobBlock(desktopWorkflow, "build_macos");
    const win = jobBlock(desktopWorkflow, "build_windows");
    const publish = jobBlock(desktopWorkflow, "release");

    assert.include(preflight, "runs-on: ubuntu-latest");
    assert.include(wsl, "runs-on: ubuntu-latest");
    assert.include(publish, "runs-on: macos-latest");
    assert.include(mac, "runs-on: macos-latest");
    assert.include(mac, "rustup toolchain install stable");
    assert.notInclude(mac, "dtolnay/rust-toolchain");
    assert.include(win, "if: false");
    assert.include(win, "runs-on: ubuntu-latest");
    assert.notInclude(wsl, "docker run");
    assert.include(wsl, "npx --yes node-gyp rebuild");
    assert.include(wsl, "sudo apt-get install -y python3 make g++ file");
    assert.include(mac, "is not an actions-runner tree; skipping externals repair.");
    assert.include(mac, "/var/folders/*");
    assert.include(publish, "--experimental-strip-types");
    assert.notInclude(publish, "voidzero-dev/setup-vp");
  });

  it("does not rebuild desktop for mobile-only or docs-only commits", () => {
    // Buildkite rejects on.push.paths, so the skip lives in the preflight job.
    assert.include(desktopWorkflow, "Skip desktop-irrelevant pushes");
    assert.include(desktopWorkflow, "apps/desktop");
    assert.include(desktopWorkflow, "apps/web");
    assert.notInclude(desktopWorkflow, "apps/mobile");
    assert.notInclude(desktopWorkflow, '"docs/**"');
    assert.include(desktopWorkflow, "workflow_dispatch:");
  });

  it("publishes mobile OTA on ubuntu and compiles iOS only when asked", () => {
    const ota = jobBlock(mobileWorkflow, "ota");
    const ios = jobBlock(mobileWorkflow, "ios");

    assert.include(ota, "runs-on: ubuntu-latest");
    assert.include(ota, "- name: Publish OTA update");
    assert.include(ota, "Decide whether a new iOS binary is required");
    assert.notInclude(ota, "eas build --");
    assert.notInclude(ota, "--local");
    assert.include(ios, "runs-on: macos-latest");
    assert.include(ios, "needs.ota.outputs.should_build == 'true'");
    assert.include(ios, "--local");
    assert.include(mobileWorkflow, '"$MODE" == "build" || "$FORCE_IOS" == "true"');
  });

  it("deploys the relay on free hosted ubuntu instead of the Mac release runner", () => {
    assert.include(relayWorkflow, "runs-on: ubuntu-latest");
    assert.notInclude(relayWorkflow, "t3code-fork");
  });
});
