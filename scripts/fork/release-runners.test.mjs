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
  it("keeps imported desktop CI on hosted Linux without GitHub actions", () => {
    const preflight = jobBlock(desktopWorkflow, "preflight");
    const wsl = jobBlock(desktopWorkflow, "build_wsl_node_pty");

    assert.include(preflight, "runs-on: ubuntu-latest");
    assert.include(wsl, "runs-on: ubuntu-latest");
    assert.notInclude(desktopWorkflow, "\n  build_macos:\n");
    assert.notInclude(desktopWorkflow, "\n  build_windows:\n");
    assert.notInclude(desktopWorkflow, "\n  release:\n");
    assert.isFalse(/\n\s+uses:/u.test(desktopWorkflow));
    assert.notInclude(wsl, "docker run");
    assert.include(wsl, "npx --yes node-gyp rebuild");
    assert.include(wsl, "sudo apt-get install -y python3 make g++ file");
    assert.include(preflight, "Use the importer checkout");
    assert.include(preflight, "continue-on-error: true");
    assert.include(preflight, "ensure-linux-node.sh");
    const nodeHelper = NodeFS.readFileSync(NodePath.resolve(here, "ensure-linux-node.sh"), "utf8");
    assert.include(nodeHelper, 'elif [[ -n "${GITHUB_ENV:-}" ]]');
    assert.notInclude(nodeHelper, 'tar -xzf "${tmp}/${name}" -C /usr/local');
    assert.include(wsl, "PREFLIGHT_REF");
    assert.include(wsl, "ensure-linux-node.sh");
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

  it("publishes mobile OTA on macos-release and compiles iOS only when asked", () => {
    const ota = jobBlock(mobileWorkflow, "ota");
    const ios = jobBlock(mobileWorkflow, "ios");

    assert.include(ota, "runs-on: macos-latest");
    assert.include(ota, "checkout-origin.sh");
    assert.include(ota, "- name: Publish OTA update");
    assert.include(ota, "Decide whether a new iOS binary is required");
    assert.notInclude(ota, "scripts/fork/origin-forge.mjs");
    assert.include(ota, "--max-old-space-size=8192");
    assert.notInclude(ota, "Not failing the pipeline.");
    assert.notInclude(ota, "eas build --");
    assert.notInclude(ota, "--local");
    assert.include(ios, "runs-on: macos-latest");
    assert.include(ios, "needs.ota.outputs.should_build == 'true'");
    assert.include(ios, "--local");
    assert.include(mobileWorkflow, '"$MODE" == "build" || "$FORCE_IOS" == "true"');
    assert.isFalse(/\n\s+uses:/u.test(mobileWorkflow));
    assert.include(ota, "npm install -g eas-cli");
    assert.include(ios, "npm install -g eas-cli");
  });

  it("deploys the relay on macos-release with baked public IDs", () => {
    const relay = jobBlock(relayWorkflow, "deploy_relay");
    assert.include(relay, "runs-on: macos-latest");
    assert.include(relay, "checkout-origin.sh");
    assert.notInclude(relayWorkflow, "t3code-fork");
    assert.notInclude(relayWorkflow, "sparse-checkout:");
    assert.notInclude(relayWorkflow, "vars.FORK_RELAY_DEPLOY_ENABLED");
    assert.notInclude(relayWorkflow, "actions/github-script");
    assert.notInclude(relayWorkflow, "secrets.CLERK_SECRET_KEY");
    assert.notInclude(relayWorkflow, "secrets.PLANETSCALE_API_TOKEN");
    assert.include(relayWorkflow, "secrets.CLOUDFLARE_API_TOKEN");
    assert.include(relayWorkflow, "secrets.APNS_PRIVATE_KEY");
    assert.include(relayWorkflow, "relay.sergeserbinenko.com");
    assert.include(relayWorkflow, "load-buildkite-secrets.sh");
    assert.include(relayWorkflow, "Require relay deploy credentials");
  });
});
