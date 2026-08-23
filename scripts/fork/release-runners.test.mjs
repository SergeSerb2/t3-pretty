import * as NodeChildProcess from "node:child_process";
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
const publicReleaseWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/public-release.yml"),
  "utf8",
);
const upstreamSyncWorkflow = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.github/workflows/fork-upstream-sync.yml"),
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
    assert.include(preflight, "Importer left no git checkout");
    assert.include(preflight, "BUILDKITE_BUILD_CHECKOUT_PATH");
    assert.include(preflight, "GIT_TERMINAL_PROMPT=0");
    assert.include(preflight, "Hosted linux-small cannot clone Origin over HTTPS");
    assert.include(desktopWorkflow, 'GIT_TERMINAL_PROMPT: "0"');
    assert.include(desktopWorkflow, 'GIT_ASKPASS: "/bin/true"');
    assert.notInclude(desktopWorkflow, "git fetch --depth 1 origin");
    assert.notInclude(desktopWorkflow, "unshallow origin");
    assert.include(preflight, "No git checkout; skipping imported preflight.");
    assert.include(preflight, "relevant=false");
    assert.include(preflight, "id: checkout");
    assert.include(preflight, "ready=false");
    assert.include(preflight, "ready=true");
    assert.include(preflight, "rm -rf .git");
    assert.include(preflight, "steps.checkout.outputs.ready == 'true'");
    assert.include(
      preflight,
      "if: steps.checkout.outputs.ready == 'true' && steps.paths.outputs.relevant == 'true' && steps.tags.outputs.can_mint == 'true' && steps.existing.outputs.should_release == 'true' && steps.signing.outputs.configured == 'true'",
    );
    assert.include(preflight, "windows_release: ${{ steps.signing.outputs.windows || 'false' }}");
    assert.include(preflight, "version: ${{ steps.release.outputs.version || '-' }}");
    assert.include(preflight, "steps.release.outcome == 'success'");
    assert.include(preflight, "steps.release.outputs.minted == 'true'");
    assert.include(preflight, "steps.release.outputs.version != ''");
    assert.include(preflight, "steps.release.outputs.version != '-'");
    assert.include(preflight, "continue-on-error: true");
    const releaseStep = preflight.slice(preflight.indexOf("id: release"));
    assert.include(releaseStep, "T3_SKIP_UNRESOLVABLE_MINT");
    assert.notInclude(releaseStep, "continue-on-error:");
    assert.include(preflight, "ensure-linux-node.sh");
    const nodeHelper = NodeFS.readFileSync(NodePath.resolve(here, "ensure-linux-node.sh"), "utf8");
    const persistHelper = NodeFS.readFileSync(NodePath.resolve(here, "persist-ci-path.sh"), "utf8");
    assert.include(nodeHelper, '. "${HERE}/persist-ci-path.sh" "${prefix}/bin"');
    assert.include(persistHelper, 'echo "PATH=${PATH}" >> "$GITHUB_ENV"');
    assert.include(persistHelper, "Source this file");
    assert.notInclude(nodeHelper, 'tar -xzf "${tmp}/${name}" -C /usr/local');
    assert.include(wsl, "PREFLIGHT_REF");
    assert.include(wsl, "Importer left no git checkout");
    assert.include(wsl, "BUILDKITE_BUILD_CHECKOUT_PATH");
    assert.include(wsl, "GIT_TERMINAL_PROMPT=0");
    assert.include(wsl, "Hosted linux-small cannot clone Origin over HTTPS");
    assert.include(wsl, "ensure-linux-node.sh");
    assert.include(wsl, "needs.preflight.result == 'success'");
    assert.include(wsl, "needs.preflight.outputs.should_release == 'true'");
    assert.include(preflight, "ref: ${{ github.sha || env.BUILDKITE_COMMIT }}");
    assert.notInclude(preflight, "github.sha || '-'");
    assert.include(wsl, 'ref="${PREFLIGHT_REF:-${GITHUB_SHA:-${BUILDKITE_COMMIT:-}}}"');
    assert.include(wsl, "WSL prebuild needs a commit SHA; preflight ref is missing.");
    assert.include(wsl, 'if [[ -z "$ref" || "$ref" == "-" ]]; then');
    assert.notInclude(wsl, "exit 0");
    assert.include(wsl, 'git cat-file -e "${ref}^{commit}"');
    assert.include(wsl, 'git checkout --force "$ref"');
    assert.equal((desktopWorkflow.match(/needs: preflight/g) || []).length, 1);
  });

  it("does not rebuild desktop for mobile-only or docs-only commits", () => {
    // Buildkite rejects on.push.paths, so the skip lives in the preflight job.
    assert.include(desktopWorkflow, "Skip desktop-irrelevant pushes");
    assert.notInclude(desktopWorkflow, "Changelog-only commit; skipping imported preflight.");
    // Hosted preflight cannot push notes and nothing there consumes them;
    // generation belongs to the native packagers.
    assert.notInclude(desktopWorkflow, "generate-changelog.mjs");
    assert.include(desktopWorkflow, "apps/desktop");
    assert.include(desktopWorkflow, "apps/web");
    assert.notInclude(desktopWorkflow, "apps/mobile");
    assert.notInclude(desktopWorkflow, '"docs/**"');
    assert.include(desktopWorkflow, "workflow_dispatch:");
  });

  it("publishes the headless CLI tarball from linux-small", () => {
    assert.include(pipeline, "publish-cli.sh");
    assert.include(pipeline, "key: publish-cli");
    assert.include(pipeline, "CLI tarball");
    assert.include(pipeline, "depends_on: macos-dmg");
    const publishCli = NodeFS.readFileSync(NodePath.resolve(here, "publish-cli.sh"), "utf8");
    assert.include(publishCli, "cli.ts pack");
    assert.include(publishCli, "bash scripts/fork/ensure-linux-node.sh");
    assert.notInclude(publishCli, ". scripts/fork/ensure-linux-node.sh");
    assert.include(publishCli, "Do not git fetch origin");
    assert.notInclude(publishCli, "git fetch --force --tags origin");
    assert.include(publishCli, "GIT_TERMINAL_PROMPT=0");
    assert.notInclude(publishCli, "git fetch --force --tags upstream");
    assert.notInclude(publishCli, "T3_FORK_BUILD_FLOOR");
    assert.notInclude(publishCli, "resolve-fork-release.mjs");
    assert.include(publishCli, "T3CODE_BUILD_FLAVOR=internal");
    assert.include(publishCli, "latest-mac.yml");
    assert.include(publishCli, "https://vite.plus");
    const installCli = NodeFS.readFileSync(NodePath.resolve(here, "install-cli.sh"), "utf8");
    assert.include(installCli, "https://github.com/SergeSerb2/t3-pretty/releases/latest/download");
    assert.include(installCli, "turn on T3 Connect");
    assert.include(installCli, "publish-cli.sh renders the internal R2/Surge copy");
    assert.include(publishCli, 'scripts/fork/install-cli.sh >"$tmp/install.sh"');
    assert.notInclude(publishCli, 'cp scripts/fork/install-cli.sh "$tmp/install.sh"');
    assert.include(publishCli, "s|T3 Connect|Surge Connect|g");
    assert.include(publishCli, "pub-8033bcab5baf492b81c605581ff028e0.r2.dev");
  });

  it("pins macos-release packaging steps to os=macos agents", () => {
    // m1-linux-t3code-fork shares the macos-release queue as a review-only
    // agent; DMG/iOS/relay/sync must never be assigned to a Linux box.
    // upstream-sync, macos-dmg, ios-mobile, deploy-relay — reviews stay
    // queue-wide.
    assert.equal((pipeline.match(/\n      os: macos\n/g) || []).length, 5);
  });

  it("publishes mobile OTA on macos-release and compiles iOS only when asked", () => {
    assert.include(pipeline, "publish-mobile-release.sh");
    assert.include(pipeline, "iOS OTA + TestFlight");
    assert.include(pipeline, 'concurrency_group: "t3-pretty/ios-mobile"');
    assert.include(pipeline, "priority: 20");
    assert.notInclude(pipeline, "interruptible:");
    assert.include(pipeline, "timeout_in_minutes: 30");
    assert.isBelow(
      mobileRelease.indexOf("checkout-origin.sh"),
      mobileRelease.indexOf('base="$(mobile_release_base)"'),
    );
    assert.notInclude(pipeline, "- .github/workflows/fork-mobile-release.yml");
    assert.isBelow(
      pipeline.indexOf("build-macos-dmg.sh"),
      pipeline.indexOf("publish-mobile-release.sh"),
    );
    assert.include(mobileRelease, "macos-release (m5-dev)");
    assert.include(mobileRelease, "load_secret EXPO_TOKEN");
    assert.include(mobileRelease, "EXPO_TOKEN is required to publish OTA");
    assert.include(mobileRelease, "eas update");
    assert.include(mobileRelease, "eas build");
    assert.include(mobileRelease, "--local");
    assert.include(mobileRelease, "eas submit");
    assert.include(mobileRelease, "Xcode-beta.app");
    assert.include(mobileRelease, "security-eas-local-keychain");
    assert.include(mobileRelease, "origin-forge.mjs merge-pr");
    assert.include(mobileRelease, "did not write should_build");
    assert.include(mobileRelease, "load_secret APPLE_TEAM_ID");
    assert.include(mobileRelease, 'git fetch --depth=50 origin "${commit}" main');
    assert.include(mobileRelease, "git fetch --deepen=50");
    assert.include(mobileRelease, "Never fetch");
    assert.include(mobileRelease, "--depth=1 afterward");
    assert.notInclude(mobileRelease, "git fetch --depth=1 origin main");
    assert.include(mobileRelease, "No parent commit after history fetch");
    assert.include(mobileRelease, "refusing to publish OTA without a path diff");
    assert.include(mobileRelease, "git checkout -- apps/mobile/eas.json");
    assert.include(mobileRelease, "restore_eas_json");
    assert.include(mobileRelease, "checkout-origin.sh");
    assert.include(mobileRelease, "--full");
    assert.include(mobileRelease, "would reset to the scheduled starting SHA");
    assert.include(mobileRelease, 'export GITHUB_OUTPUT="$gate_file"');
    assert.notInclude(mobileRelease, "--github-output");
    assert.include(mobileRelease, "APPLE_TEAM_ID:-78A5P57U23");
    assert.include(mobileRelease, "load_secret CURSOR_API_KEY 0");
    assert.include(mobileRelease, 'lockdir="/tmp/t3-pretty-ios-mobile.lock"');
    assert.include(mobileRelease, 'mkdir "$lockdir"');
    assert.include(mobileRelease, "Removing stale ios-mobile lock");
    assert.include(mobileRelease, "Timed out waiting for another ios-mobile publish");
    assert.include(mobileRelease, ".cache/t3-pretty-release/ios-native-submit");
    assert.include(mobileRelease, "origin/main already records a macos-release TestFlight submit");
    assert.include(mobileRelease, "Runner already submitted a TestFlight IPA");
    assert.notInclude(mobileRelease, "git fetch --unshallow");
    assert.include(mobileRelease, "generating after TestFlight submit");
    assert.include(mobileRelease, "--builds-file");
    assert.include(mobileRelease, "Skipping the fingerprint record PR");
    assert.include(mobileRelease, '"$MODE" == "build" || "$FORCE_IOS" == "true"');
    assert.notInclude(mobileRelease, '"$MODE" == "build" || "$MODE" == "release"');
    assert.include(mobileRelease, ".t3-fork/ios-native-submit");
    assert.include(mobileRelease, "is_full_xcode");
    assert.include(mobileRelease, "/Applications/Xcode-beta.app");
    assert.include(mobileRelease, 'DEVELOPER_DIR="$1" "$1/usr/bin/xcodebuild" -version');
    assert.include(mobileRelease, "This is not App Store review");
    assert.include(mobileRelease, "ipa_via_cloud");
    assert.include(mobileRelease, "--wait");
    assert.include(mobileRelease, '--json > "$cloud_build_json"');
    assert.include(mobileRelease, "eas build --json did not include a build id");
    assert.include(mobileRelease, '--id "$build_id"');
    assert.notInclude(mobileRelease, "--latest");
    assert.include(mobileRelease, "Submitted TestFlight IPA via EAS cloud");
    assert.include(mobileRelease, "No full Xcode on this Mac");
    assert.notInclude(mobileRelease, "Skipping a new IPA");
    assert.notInclude(mobileRelease, "xcode_is_store_supported");
    assert.notInclude(mobileRelease, "No native macos-release TestFlight submit recorded");
    assert.notInclude(mobileRelease, "t3_require_ota");
    assert.notInclude(mobileRelease, "t3-ota-present");
    assert.notInclude(mobileRelease, "keeping importer tree");
    assert.notInclude(mobileRelease, "Not failing the pipeline.");
    assert.notInclude(mobileRelease, "continue-on-error: true");
    assert.notInclude(mobileRelease, "secrets.EXPO_TOKEN");
    assert.notInclude(mobileRelease, "secrets.APPLE_API_KEY");
    assert.notInclude(mobileRelease, "GITHUB_WORKSPACE:-${HOME}");
    assert.include(mobileRelease, "$(npm prefix -g)/bin");
    const macosAgent = NodeFS.readFileSync(
      NodePath.resolve(here, "setup-buildkite-macos-agent.sh"),
      "utf8",
    );
    assert.include(macosAgent, "COMPANION_NAME");
    assert.include(macosAgent, "${AGENT_NAME}-2");
    assert.include(macosAgent, "REVIEW_ONLY");
    assert.include(macosAgent, "macos-review-only-hook.sh");
    assert.include(macosAgent, "T3_PRETTY_REVIEW_ONLY");
    assert.include(macosAgent, "GIT_CONFIG_GLOBAL");
    assert.include(macosAgent, "persist-ios-native-submit-hook.sh");
    assert.include(macosAgent, "refresh-origin-git-credentials.sh");
    const persistHook = NodeFS.readFileSync(
      NodePath.resolve(here, "persist-ios-native-submit-hook.sh"),
      "utf8",
    );
    assert.include(persistHook, 'BUILDKITE_STEP_KEY:-}" == "ios-mobile"');
    assert.include(persistHook, ".cache/t3-pretty-release/ios-native-submit");
    assert.include(persistHook, "refresh_macos_agent_hooks");
    assert.include(persistHook, 'grep -q "helpers_ready" "$src/macos-origin-git.sh"');
    assert.include(persistHook, "origin_cli_helper_ready");
    assert.include(persistHook, "macos-review-only-hook.sh");
    assert.include(
      persistHook,
      'grep -q "refresh_macos_agent_hooks" "$src/persist-ios-native-submit-hook.sh"',
    );
    assert.isBelow(
      persistHook.indexOf("refresh_macos_agent_hooks"),
      persistHook.indexOf('BUILDKITE_STEP_KEY:-}" == "ios-mobile"'),
    );
    const originGit = NodeFS.readFileSync(NodePath.resolve(here, "macos-origin-git.sh"), "utf8");
    assert.include(originGit, "helpers_ready");
    assert.include(originGit, "gitconfig.write.lock");
    assert.include(originGit, "Removing stale");
    assert.include(originGit, "could not lock config file");
    const dmg = NodeFS.readFileSync(NodePath.resolve(here, "build-macos-dmg.sh"), "utf8");
    assert.notInclude(dmg, "python3 -c");
    assert.notInclude(dmg, "process.stdin.on");
    assert.include(dmg, "git fetch --force --tags origin");
    assert.include(dmg, "resolve-fork-release.mjs --print version");
  });

  it("packages a Linux x64 AppImage on linux-small without fetching Origin", () => {
    assert.include(pipeline, "build-linux-appimage.sh");
    assert.include(pipeline, "Linux x64 AppImage");
    assert.include(pipeline, "key: linux-appimage");
    assert.isBelow(
      pipeline.indexOf("build-windows-nsis.ps1"),
      pipeline.indexOf("build-linux-appimage.sh"),
    );
    assert.isBelow(
      pipeline.indexOf("build-linux-appimage.sh"),
      pipeline.indexOf("build-macos-dmg.sh"),
    );
    const linux = NodeFS.readFileSync(NodePath.resolve(here, "build-linux-appimage.sh"), "utf8");
    assert.include(linux, "Do not git fetch origin");
    assert.notInclude(linux, "git fetch --force --tags origin");
    assert.notInclude(linux, "git fetch --unshallow");
    assert.include(linux, "GIT_TERMINAL_PROMPT=0");
    assert.include(linux, 'GIT_ASKPASS="${GIT_ASKPASS:-/bin/true}"');
    assert.include(linux, "git fetch --force --tags upstream");
    assert.include(linux, "ensure-linux-node.sh");
    assert.include(linux, "x86_64-unknown-linux-gnu");
    assert.include(linux, "--platform linux --target AppImage --arch x64");
    assert.include(linux, "upload-assets");
    assert.include(linux, "T3_FORK_BUILD_FLOOR");
    assert.include(linux, "latest-linux.yml");
    assert.include(linux, "nightly-linux.yml");
    assert.include(linux, "-name '*-linux.yml'");
    assert.notInclude(linux, "-o -name '*.yml'");
    assert.notInclude(linux, '"$publish"/nightly*.yml');
    assert.include(linux, "imagemagick");
    assert.include(linux, "https://vite.plus");
    assert.include(linux, "npx vp");
    assert.include(linux, "load-buildkite-secrets.sh");
    assert.include(linux, "buildkite-agent secret get");
    assert.include(linux, "Hosted linux-small has no file-store fallback");
    assert.include(linux, "T3CODE_RELEASE_S3_BUCKET");
    assert.include(linux, "T3CODE_RELEASE_S3_ENDPOINT");
    assert.include(linux, "refusing to guess an upload target");
    assert.isBelow(
      linux.indexOf("Hosted linux-small has no file-store fallback"),
      linux.indexOf("rustup toolchain install"),
    );
    assert.notInclude(linux, "checkout-origin.sh");
    assert.notInclude(linux, "CURSOR_API_KEY");
    assert.notInclude(pipeline, "\n    secrets:");
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

  it("keeps public releases manual and internal automation off the GitHub mirror", () => {
    const publicPreflight = jobBlock(publicReleaseWorkflow, "preflight");
    const publicWeb = jobBlock(publicReleaseWorkflow, "web");
    const publicPages = jobBlock(publicReleaseWorkflow, "deploy_pages");

    assert.notInclude(publicReleaseWorkflow, "\n  push:");
    assert.notInclude(publicReleaseWorkflow, "\n  schedule:");
    assert.include(publicReleaseWorkflow, "T3CODE_BUILD_FLAVOR: public");
    assert.include(publicReleaseWorkflow, "T3CODE_WEB_BASE_PATH: /t3-pretty/");
    assert.include(publicReleaseWorkflow, '[[ "$REF" == "refs/heads/main" ]]');
    assert.include(publicReleaseWorkflow, "name: wsl-node-pty-x64");
    assert.include(publicReleaseWorkflow, "pattern: public-*");
    assert.include(publicReleaseWorkflow, "cp scripts/fork/install-cli.sh public-cli/install.sh");
    assert.notInclude(publicReleaseWorkflow, "sed -i");
    assert.include(publicPreflight, "github.repository == 'SergeSerb2/t3-pretty'");
    assert.notInclude(publicWeb, "configure-pages");
    assert.notInclude(publicWeb, "upload-pages-artifact");
    assert.include(publicPages, "pages: write");
    assert.include(publicPages, "id-token: write");
    assert.include(publicPages, "actions/download-artifact@v8");
    assert.include(publicPages, "actions/configure-pages@v5");
    assert.include(publicPages, "actions/upload-pages-artifact@v5");
    assert.include(
      publicReleaseWorkflow,
      "github.repository == 'SergeSerb2/t3-pretty' && inputs.publish_release",
    );
    for (const workflow of [desktopWorkflow, relayWorkflow, upstreamSyncWorkflow]) {
      assert.include(workflow, "github.repository != 'SergeSerb2/t3-pretty'");
    }
  });
});

describe("macos review-only pre-command hook", () => {
  const hook = NodePath.resolve(here, "macos-review-only-hook.sh");

  function run(env) {
    return NodeChildProcess.spawnSync("bash", [hook], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...env },
    });
  }

  it("no-ops without T3_PRETTY_REVIEW_ONLY", () => {
    assert.equal(run({ BUILDKITE_STEP_KEY: "macos-dmg" }).status, 0);
  });

  it("allows Origin PR review steps and refuses packaging", () => {
    assert.equal(
      run({ T3_PRETTY_REVIEW_ONLY: "1", BUILDKITE_STEP_KEY: "origin-pr-review" }).status,
      0,
    );
    assert.equal(
      run({ T3_PRETTY_REVIEW_ONLY: "1", BUILDKITE_STEP_KEY: "origin-pr-comments" }).status,
      0,
    );
    const refused = run({ T3_PRETTY_REVIEW_ONLY: "1", BUILDKITE_STEP_KEY: "macos-dmg" });
    assert.equal(refused.status, 1);
    assert.include(refused.stderr, "review-only");
  });
});
