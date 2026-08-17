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

    for (const source of [sync, desktop, mobile]) {
      assert.notInclude(source, "gh api");
      assert.notInclude(source, "gh release");
      assert.notInclude(source, "gh workflow");
      assert.include(source, "origin-forge.mjs");
    }
    assert.include(sync, "https://github.com/pingdotgg/t3code.git");
    assert.include(desktop, "T3CODE_DESKTOP_UPDATE_FEED_URL");
    assert.include(desktop, "T3CODE_RELEASE_S3_BUCKET");
    assert.include(mobile, "origin-forge.mjs merge-pr");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );
    assert.include(pipeline, "fork-upstream-sync.yml");
    assert.include(pipeline, "fork-release.yml");
    assert.include(pipeline, "fork-mobile-release.yml");
    assert.include(pipeline, "queue: macos-release");
    assert.include(pipeline, "queue: windows-release");
    assert.include(pipeline, "build-windows-nsis.ps1");
    assert.include(pipeline, "CURSOR_API_KEY");
  });

  it("uploads updater assets with aws when keys exist and wrangler otherwise", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    assert.include(source, "T3CODE_RELEASE_S3_ACCESS_KEY_ID");
    assert.include(source, "T3CODE_RELEASE_S3_SECRET_ACCESS_KEY");
    assert.include(source, '"r2", "object", "put"');
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
    const pushAt = source.indexOf('runCommand("git", ["push", "origin", `refs/tags/${tag}`])');
    assert.isTrue(uploadAt > 0);
    assert.isTrue(pushAt > uploadAt);
  });
});
