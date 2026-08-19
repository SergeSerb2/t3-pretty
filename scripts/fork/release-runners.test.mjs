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
    const persistHelper = NodeFS.readFileSync(NodePath.resolve(here, "persist-ci-path.sh"), "utf8");
    assert.include(nodeHelper, '. "${HERE}/persist-ci-path.sh" "${prefix}/bin"');
    assert.include(persistHelper, 'echo "PATH=${PATH}" >> "$GITHUB_ENV"');
    assert.include(persistHelper, "Source this file");
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
    assert.include(ota, "keeping importer tree");
    assert.notInclude(ota, 'test -x "$helper"');
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
    assert.include(ota, ". scripts/fork/persist-ci-path.sh");
    assert.include(ios, ". scripts/fork/persist-ci-path.sh");
    assert.notInclude(ota, "bash scripts/fork/persist-ci-path.sh");
    assert.include(ota, "t3_persist_dotenv_file");
    assert.include(ios, "t3_persist_dotenv_file");
    assert.notInclude(ota, "GITHUB_WORKSPACE:-${HOME}");
    assert.notInclude(ios, "GITHUB_WORKSPACE:-${HOME}");
    const otaPath = ota.slice(
      ota.indexOf("Prepare macOS runner PATH"),
      ota.indexOf("Checkout Origin and load Expo token"),
    );
    assert.notInclude(otaPath, "persist-ci-path.sh");
    assert.include(otaPath, "writing t3-pretty-ci.env under /tmp");
    assert.include(otaPath, 'printf \'export PATH=%q\\n\' "$PATH" > "$ci_env"');
    assert.isBelow(
      otaPath.indexOf('mkdir -p "$dir" || dir="/tmp"'),
      otaPath.indexOf('ci_env="${dir}/t3-pretty-ci.env"'),
    );
    assert.include(ota, "steps.expo-token.outputs.present == 'true'");
    assert.include(ota, "continue-on-error: true");
    const dmg = NodeFS.readFileSync(NodePath.resolve(here, "build-macos-dmg.sh"), "utf8");
    assert.notInclude(dmg, "python3 -c");
    assert.include(dmg, "git fetch --force --tags origin");
    assert.include(ota, '[[ -n "${GITHUB_OUTPUT:-}" ]]');
    assert.notInclude(ios, "secrets.APPLE_API_KEY");
    assert.include(ios, "APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_TEAM_ID");
    assert.notInclude(ota, "grep -vE '^[[:space:]]*(#|$)' ../../.env.local >> \"$GITHUB_ENV\"");
    assert.include(ota, "$(npm prefix -g)/bin");
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
