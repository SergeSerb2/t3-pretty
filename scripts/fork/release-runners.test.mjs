import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/fork-release.yml"),
  "utf8",
);
const mobileRelease = NodeFS.readFileSync(
  NodePath.resolve(here, "publish-mobile-release.sh"),
  "utf8",
);
const pipeline = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
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
    const persistHelper = NodeFS.readFileSync(NodePath.resolve(here, "persist-ci-path.sh"), "utf8");
    assert.include(nodeHelper, '. "${HERE}/persist-ci-path.sh" "${prefix}/bin"');
    assert.include(persistHelper, 'echo "PATH=${PATH}" >> "$GITHUB_ENV"');
    assert.include(persistHelper, "Source this file");
    assert.notInclude(nodeHelper, 'tar -xzf "${tmp}/${name}" -C /usr/local');
    assert.include(wsl, "PREFLIGHT_REF");
    assert.include(wsl, "ensure-linux-node.sh");
    assert.include(wsl, "needs.preflight.result == 'success'");
    assert.equal((desktopWorkflow.match(/needs: preflight/g) || []).length, 1);
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
    assert.include(pipeline, "publish-mobile-release.sh");
    assert.include(pipeline, "iOS OTA + TestFlight");
    assert.include(pipeline, 'concurrency_group: "t3-pretty/ios-mobile"');
    assert.isBelow(
      mobileRelease.indexOf("checkout-origin.sh"),
      mobileRelease.indexOf("does not change mobile-relevant paths"),
    );
    assert.notInclude(pipeline, "- .github/workflows/fork-mobile-release.yml");
    assert.isBelow(
      pipeline.indexOf("build-macos-dmg.sh"),
      pipeline.indexOf("publish-mobile-release.sh"),
    );
    assert.include(mobileRelease, "macos-release (m1-dev)");
    assert.include(mobileRelease, "load_secret EXPO_TOKEN");
    assert.include(mobileRelease, "EXPO_TOKEN is required to publish OTA");
    assert.include(mobileRelease, "eas update");
    assert.include(mobileRelease, "eas build");
    assert.include(mobileRelease, "--local");
    assert.include(mobileRelease, "eas submit");
    assert.include(mobileRelease, "Xcode-beta.app");
    assert.include(mobileRelease, "security-eas-local-keychain");
    assert.include(mobileRelease, "origin-forge.mjs merge-pr");
    assert.include(mobileRelease, "--github-output");
    assert.include(mobileRelease, "did not write should_build");
    assert.include(mobileRelease, "load_secret APPLE_TEAM_ID");
    assert.include(mobileRelease, "git fetch --deepen=50");
    assert.include(mobileRelease, "refusing to publish OTA without a path diff");
    assert.include(mobileRelease, "git checkout -- apps/mobile/eas.json");
    assert.include(mobileRelease, "restore_eas_json");
    assert.include(mobileRelease, "checkout-origin.sh");
    assert.include(mobileRelease, "--full");
    assert.include(mobileRelease, 'export GITHUB_OUTPUT="$gate_file"');
    assert.include(mobileRelease, "load_secret CURSOR_API_KEY 0");
    assert.include(mobileRelease, '"$MODE" == "build" || "$FORCE_IOS" == "true"');
    assert.notInclude(mobileRelease, '"$MODE" == "build" || "$MODE" == "release"');
    assert.notInclude(mobileRelease, "t3_require_ota");
    assert.notInclude(mobileRelease, "t3-ota-present");
    assert.notInclude(mobileRelease, "keeping importer tree");
    assert.notInclude(mobileRelease, "Not failing the pipeline.");
    assert.notInclude(mobileRelease, "continue-on-error: true");
    assert.notInclude(mobileRelease, "secrets.EXPO_TOKEN");
    assert.notInclude(mobileRelease, "secrets.APPLE_API_KEY");
    assert.notInclude(mobileRelease, "GITHUB_WORKSPACE:-${HOME}");
    assert.include(mobileRelease, "$(npm prefix -g)/bin");
    const dmg = NodeFS.readFileSync(NodePath.resolve(here, "build-macos-dmg.sh"), "utf8");
    assert.notInclude(dmg, "python3 -c");
    assert.notInclude(dmg, "process.stdin.on");
    assert.include(dmg, "git fetch --force --tags origin");
    assert.include(dmg, "resolve-fork-release.mjs --print version");
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
