import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  ORIGIN_FULL_NAME,
  ORIGIN_GIT_URL,
  ORIGIN_WEB_URL,
  UPSTREAM_GIT_URL,
  blockedSyncBranch,
  defaultUpdateFeedUrl,
  isGitHubFeedUrl,
  isMergeableState,
  redactCommandArgs,
  pullRequestItems,
  pullRequestNumber,
  pullRequestUrl,
  resolveReleaseObjectKey,
  resolveUpdateFeedUrl,
} from "./origin-forge.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

function workflow(name) {
  return NodeFS.readFileSync(NodePath.resolve(here, `../../.github/workflows/${name}`), "utf8");
}

describe("Origin forge constants", () => {
  it("points the fork at the Origin codebase, not GitHub", () => {
    assert.equal(ORIGIN_FULL_NAME, "serbinenko/t3-pretty");
    assert.equal(ORIGIN_GIT_URL, "https://origin.cursor.com/serbinenko/t3-pretty.git");
    assert.equal(ORIGIN_WEB_URL, "https://cursor.com/codebase/serbinenko/t3-pretty");
    assert.equal(UPSTREAM_GIT_URL, "https://github.com/pingdotgg/t3code.git");
  });
});

describe("Origin pull request parsing", () => {
  it("reads numbers from Origin CLI list and view payloads", () => {
    assert.deepEqual(pullRequestItems([{ number: "13" }]), [{ number: "13" }]);
    assert.deepEqual(pullRequestItems({ pullRequests: [{ number: 4 }] }), [{ number: 4 }]);
    assert.equal(pullRequestNumber({ number: "13" }), "13");
    assert.equal(pullRequestNumber({ pullRequest: { number: 7 } }), "7");
    assert.equal(pullRequestUrl("13"), "https://cursor.com/codebase/serbinenko/t3-pretty/pull/13");
  });

  it("treats Origin mergeability variants as mergeable", () => {
    assert.isTrue(isMergeableState("clean"));
    assert.isTrue(isMergeableState("unstable"));
    assert.isTrue(isMergeableState("MERGEABLE"));
    assert.isTrue(isMergeableState({ state: "ready" }));
    assert.isFalse(isMergeableState("blocked"));
    assert.isFalse(isMergeableState("dirty"));
  });
});

describe("Origin release and blocked-sync helpers", () => {
  it("names a blocked-sync branch from the upstream nightly tag", () => {
    assert.equal(
      blockedSyncBranch("v0.0.34-nightly.20260813.1086"),
      "automation/sync-blocked-v0.0.34-nightly.20260813.1086",
    );
    assert.equal(blockedSyncBranch("v1.0.0+build/1"), "automation/sync-blocked-v1.0.0-build-1");
  });

  it("keeps a trailing slash on generic updater feeds and rejects GitHub leftovers", () => {
    assert.equal(
      resolveUpdateFeedUrl("https://updates.example.test/t3-pretty/latest"),
      "https://updates.example.test/t3-pretty/latest/",
    );
    assert.equal(
      resolveUpdateFeedUrl("https://updates.example.test/t3-pretty/latest/"),
      "https://updates.example.test/t3-pretty/latest/",
    );
    assert.equal(resolveUpdateFeedUrl("not a url"), undefined);
    assert.isTrue(
      isGitHubFeedUrl("https://github.com/SergeSerb2/t3-pretty/releases/latest/download/"),
    );
    assert.isFalse(isGitHubFeedUrl("https://updates.example.test/t3-pretty/latest/"));
    assert.deepEqual(redactCommandArgs(["auth", "login", "--api-key", "secret", "--local"]), [
      "auth",
      "login",
      "--api-key",
      "***",
      "--local",
    ]);
  });

  it("keeps the fork release and sync workflows off the GitHub CLI", () => {
    const sync = workflow("fork-upstream-sync.yml");
    const desktop = workflow("fork-release.yml");
    const mobile = workflow("fork-mobile-release.yml");
    const reviewCi = NodeFS.readFileSync(NodePath.resolve(here, "review-origin-pr-ci.sh"), "utf8");

    for (const source of [sync, desktop, mobile]) {
      assert.notInclude(source, "gh api");
      assert.notInclude(source, "gh release");
      assert.notInclude(source, "gh workflow");
    }
    assert.include(sync, "origin-forge.mjs");
    assert.include(mobile, "origin-forge.mjs");
    assert.include(sync, "https://github.com/pingdotgg/t3code.git");
    assert.include(sync, "git remote get-url upstream");
    assert.include(sync, "git remote set-url upstream");
    const preparePath = sync.slice(
      sync.indexOf("Prepare macOS runner PATH"),
      sync.indexOf("Checkout fork main"),
    );
    assert.include(preparePath, "GITHUB_PATH");
    assert.include(preparePath, "GITHUB_ENV");
    assert.include(preparePath, "wrote=0");
    assert.include(preparePath, 'echo "PATH=${PATH}" >> "$GITHUB_ENV"');
    assert.notInclude(preparePath, 'elif [[ -n "${GITHUB_ENV:-}" ]]');
    assert.include(desktop, "T3CODE_DESKTOP_UPDATE_FEED_URL");
    assert.include(desktop, "T3CODE_RELEASE_S3_BUCKET");
    assert.include(desktop, "pub-8033bcab5baf492b81c605581ff028e0.r2.dev");
    assert.notInclude(desktop, "dtolnay/rust-toolchain");
    assert.notInclude(desktop, "sparse-checkout:");
    assert.notInclude(desktop, "secrets.AZURE_");
    assert.notInclude(desktop, "secrets.MACOS_PROVISIONING_PROFILE");
    assert.notInclude(desktop, "\n  build_macos:\n");
    assert.notInclude(desktop, "\n  build_windows:\n");
    assert.notInclude(desktop, "\n  release:\n");
    assert.isFalse(/\n\s+uses:/u.test(desktop));
    const preflight = desktop.slice(
      desktop.indexOf("\n  preflight:\n"),
      desktop.indexOf("\n  build_wsl_node_pty:\n"),
    );
    assert.notInclude(preflight, "secrets.CURSOR_API_KEY");
    assert.notInclude(preflight, "secrets.CSC_");
    assert.notInclude(preflight, "secrets.APPLE_API_");
    assert.include(preflight, "Read Buildkite pipeline env directly");
    assert.include(preflight, "continue-on-error: true");
    assert.include(sync, "runs-on: macos-latest");
    assert.notInclude(sync, "secrets.CURSOR_API_KEY");
    assert.notInclude(sync, "secrets.CLI_PROXY_API_KEY");
    assert.notInclude(sync, "mapfile ");
    assert.include(sync, "Prepare macOS runner PATH");
    assert.include(sync, "checkout-origin.sh");
    assert.include(mobile, "checkout-origin.sh");
    assert.isFalse(/\n\s+uses:/u.test(mobile));
    assert.include(mobile, '"$helper" "$CHECKOUT_SHA" --full');
    assert.notInclude(mobile, '"$helper" main --full');
    assert.include(desktop, "ensure-linux-node.sh");
    assert.include(desktop, "PREFLIGHT_REF");
    assert.notInclude(desktop, "/usr/local --strip-components=1");
    assert.notInclude(desktop, "git fetch --force --tags origin || true");
    assert.include(preflight, "origin_tags_ok");
    assert.include(mobile, "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65");
    assert.notInclude(mobile, "vars.T3CODE_MOBILE_EAS_PROJECT_ID");
    assert.notInclude(mobile, "vars.APPLE_TEAM_ID");
    assert.notInclude(mobile, "secrets.EXPO_TOKEN");
    assert.include(sync, "load-buildkite-secrets.sh");
    assert.include(mobile, "load-buildkite-secrets.sh EXPO_TOKEN");
    assert.include(preflight, "Mac signing secrets are resolved on macos-release");
    assert.include(preflight, "git fetch --force --tags origin");
    assert.include(mobile, "origin-forge.mjs merge-pr");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );
    assert.include(pipeline, "fork-upstream-sync.yml");
    assert.include(pipeline, "fork-release.yml");
    assert.include(pipeline, "fork-mobile-release.yml");
    assert.notInclude(pipeline, "- .github/workflows/fork-pr-review.yml");
    assert.include(pipeline, "run-trusted-origin-pr-ci.sh");
    assert.include(pipeline, "run-trusted-origin-pr-ci.sh check");
    assert.include(pipeline, "automation");
    assert.include(reviewCi, "review-origin-pr.mjs");
    assert.include(reviewCi, "grok-4.6");
    assert.include(reviewCi, "CLI_PROXY_API_KEY");
    assert.include(reviewCi, "cli-proxy-api-production-1615.up.railway.app");
    assert.notInclude(reviewCi, "api.x.ai");
    assert.include(pipeline, "deploy-relay-ci.sh");
    assert.notInclude(pipeline, "deploy-relay.yml");
    assert.include(pipeline, "queue: macos-release");
    assert.include(pipeline, "queue: windows-release");
    assert.include(pipeline, "queue: linux-small");
    assert.include(pipeline, "github-actions#v0.13.0");
    assert.include(pipeline, "runs-on: macos-latest");
    assert.notInclude(pipeline, "runs-on: self-hosted");
    assert.include(pipeline, "build-windows-nsis.ps1");
    assert.include(pipeline, "build-macos-dmg.sh");
    assert.include(pipeline, 'build.source != "schedule"');
    assert.notInclude(pipeline, "depends_on: origin-workflows");
    assert.notInclude(pipeline, "\n    secrets:");
    const nsis = NodeFS.readFileSync(NodePath.resolve(here, "build-windows-nsis.ps1"), "utf8");
    assert.include(nsis, "C:\\buildkite-agent\\vite-plus");
    assert.include(nsis, "$env:VP_HOME");
    assert.include(nsis, "Test-OfficialVp");
    assert.include(nsis, "${LASTEXITCODE}");
    assert.include(nsis, "rustup default stable");
    assert.include(nsis, "upload-assets");
    assert.notInclude(nsis, "VITE_PLUS_BIN_DIR");
    assert.notInclude(nsis, "AppData\\Roaming\\npm");
  });

  it("uploads updater assets with aws when keys exist and wrangler otherwise", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    assert.include(source, "T3CODE_RELEASE_S3_ACCESS_KEY_ID");
    assert.include(source, "T3CODE_RELEASE_S3_SECRET_ACCESS_KEY");
    assert.include(source, '"r2", "object", "put"');
    assert.include(source, 'case "upload-assets"');
    assert.include(source, "originGitConfigArgs");
    assert.include(source, "credential.https://origin.cursor.com.helper");
  });

  it("reads the baked updater feed from T3CODE_DESKTOP_UPDATE_FEED_URL", () => {
    const previous = process.env.T3CODE_DESKTOP_UPDATE_FEED_URL;
    process.env.T3CODE_DESKTOP_UPDATE_FEED_URL = "https://updates.example.test/feed";
    try {
      assert.equal(defaultUpdateFeedUrl(), "https://updates.example.test/feed/");
    } finally {
      if (previous === undefined) delete process.env.T3CODE_DESKTOP_UPDATE_FEED_URL;
      else process.env.T3CODE_DESKTOP_UPDATE_FEED_URL = previous;
    }
  });

  it("prefixes S3 object keys with the updater feed path", () => {
    const previousFeed = process.env.T3CODE_DESKTOP_UPDATE_FEED_URL;
    const previousPrefix = process.env.T3CODE_RELEASE_S3_PREFIX;
    delete process.env.T3CODE_RELEASE_S3_PREFIX;
    process.env.T3CODE_DESKTOP_UPDATE_FEED_URL = "https://updates.example.test/t3-pretty/latest";
    try {
      assert.equal(
        resolveReleaseObjectKey("/tmp/release-assets/nightly.yml"),
        "t3-pretty/latest/nightly.yml",
      );
      process.env.T3CODE_RELEASE_S3_PREFIX = "/custom/prefix/";
      assert.equal(resolveReleaseObjectKey("latest.yml"), "custom/prefix/latest.yml");
    } finally {
      if (previousFeed === undefined) delete process.env.T3CODE_DESKTOP_UPDATE_FEED_URL;
      else process.env.T3CODE_DESKTOP_UPDATE_FEED_URL = previousFeed;
      if (previousPrefix === undefined) delete process.env.T3CODE_RELEASE_S3_PREFIX;
      else process.env.T3CODE_RELEASE_S3_PREFIX = previousPrefix;
    }
  });

  it("pushes the release tag only after asset uploads succeed", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const uploadAt = source.indexOf("uploadReleaseAsset(asset, resolveReleaseObjectKey(asset))");
    const pushAt = source.indexOf(
      'runCommand("git", [...originGitConfigArgs(), "push", "origin", `refs/tags/${tag}`])',
    );
    assert.isTrue(uploadAt > 0);
    assert.isTrue(pushAt > uploadAt);
  });
});
