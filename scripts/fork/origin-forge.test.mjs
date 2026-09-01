import * as NodeBuffer from "node:buffer";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const { Buffer } = NodeBuffer;
const process = NodeProcess.default;
const { fileURLToPath } = NodeURL;

import {
  ORIGIN_FULL_NAME,
  ORIGIN_GIT_URL,
  ORIGIN_WEB_URL,
  UPSTREAM_GIT_URL,
  assertPullRequestHeadSha,
  blockedSyncBranch,
  defaultUpdateFeedUrl,
  describeMergeConflicts,
  hasMergeConflicts,
  isGitHubFeedUrl,
  isMergeableState,
  isPullRequestMerged,
  originChildEnv,
  originInstallerEnvironment,
  originUnknownOption,
  parseRemoteTagCommit,
  prepareReleaseNotesFile,
  pullRequestHeadName,
  pullRequestItems,
  pullRequestNumber,
  pullRequestUrl,
  readOriginBodyFile,
  readPositional,
  readReleaseNotesFile,
  redactCommandArgs,
  redactCommandOutput,
  releaseUploaderEnvironment,
  releaseAssetObjectKeys,
  releaseAssetUploadPlan,
  retryReleaseUpload,
  resolveCloudflareAccountId,
  resolveReleaseAssetObjectKey,
  resolveReleaseBucket,
  resolveReleaseCredential,
  resolveReleaseEndpointUrl,
  resolveReleaseObjectKey,
  resolveReleaseObjectPath,
  resolveReleaseRegion,
  resolveNpxCli,
  resolveUpdateFeedUrl,
  safeCommandDiagnostic,
  selectPullRequest,
  usableGitCredentialStore,
  writeGitHubOutput,
} from "./origin-forge.mjs";

const here = NodePath.dirname(fileURLToPath(import.meta.url));

function workflow(name) {
  return NodeFS.readFileSync(NodePath.resolve(here, `../../.github/workflows/${name}`), "utf8");
}

describe("usableGitCredentialStore", () => {
  it("rejects missing and empty stores that make git fetch exit 128", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-git-store-"));
    try {
      const missing = NodePath.join(dir, "missing");
      const empty = NodePath.join(dir, "empty");
      const filled = NodePath.join(dir, "filled");
      NodeFS.writeFileSync(empty, "");
      NodeFS.writeFileSync(filled, "https://x-access-token:token@origin.cursor.com\n");
      assert.equal(usableGitCredentialStore(""), false);
      assert.equal(usableGitCredentialStore(missing), false);
      assert.equal(usableGitCredentialStore(empty), false);
      assert.equal(usableGitCredentialStore(filled), true);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Origin CLI child environment", () => {
  it("drops NO_COLOR and turns off FORCE_COLOR so bun Origin does not 255", () => {
    const env = originChildEnv({
      PATH: "/usr/bin",
      NO_COLOR: "1",
      FORCE_COLOR: "1",
      GIT_TERMINAL_PROMPT: "1",
    });
    assert.equal("NO_COLOR" in env, false);
    assert.equal(env.FORCE_COLOR, "0");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  });
});

describe("Origin forge constants", () => {
  it("points the fork at the Origin codebase, not GitHub", () => {
    assert.equal(ORIGIN_FULL_NAME, "serbinenko/t3-pretty");
    assert.equal(ORIGIN_GIT_URL, "https://origin.cursor.com/serbinenko/t3-pretty.git");
    assert.equal(ORIGIN_WEB_URL, "https://cursor.com/codebase/serbinenko/t3-pretty");
    assert.equal(UPSTREAM_GIT_URL, "https://github.com/pingdotgg/t3code.git");
  });
});

describe("release uploads", () => {
  it("retries a failed object once", () => {
    let attempts = 0;
    let retries = 0;
    const result = retryReleaseUpload(
      () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return "uploaded";
      },
      () => {
        retries += 1;
      },
    );

    assert.equal(result, "uploaded");
    assert.equal(attempts, 2);
    assert.equal(retries, 1);
  });
});

describe("Origin pull request parsing", () => {
  it("reads numbers from Origin CLI list and view payloads", () => {
    assert.deepEqual(pullRequestItems([{ number: "13" }]), [{ number: "13" }]);
    assert.deepEqual(pullRequestItems({ pullRequests: [{ number: 4 }] }), [{ number: 4 }]);
    assert.equal(pullRequestNumber({ number: "13" }), "13");
    assert.equal(pullRequestNumber({ pullRequest: { number: 7 } }), "7");
    assert.isUndefined(pullRequestNumber({ number: "7\nfeed=attacker" }));
    assert.equal(pullRequestUrl("13"), "https://cursor.com/codebase/serbinenko/t3-pretty/pull/13");
  });

  it("never falls back to an unrelated pull request when a head is requested", () => {
    const matches = [
      { number: 4, headRefName: "automation/other" },
      { number: 7, headRefName: "serbinenko:automation/target" },
    ];
    assert.deepEqual(selectPullRequest(matches, "automation/target"), matches[1]);
    assert.isUndefined(selectPullRequest(matches, "automation/missing"));
    assert.isUndefined(
      selectPullRequest(
        [{ number: 9, headRefName: "another-owner:automation/target" }],
        "automation/target",
      ),
    );
    assert.deepEqual(selectPullRequest([{ number: 11 }], "automation/target"), { number: 11 });
    assert.deepEqual(selectPullRequest(matches), matches[0]);
  });

  it("does not treat option values as positional merge targets", () => {
    assert.equal(readPositional(["13", "--repo", "owner/repo"], ["--repo"]), "13");
    assert.equal(readPositional(["--repo", "owner/repo", "13"], ["--repo"]), "13");
    assert.isUndefined(readPositional(["--repo", "owner/repo"], ["--repo"]));
  });

  it("does not pass --sha to origin pr merge", () => {
    const forge = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    assert.notInclude(forge, 'args.push("--sha", sha)');
    assert.include(forge, "Origin CLI has no --sha on `pr merge`");
    assert.include(forge, "A SHA-pinned call must not arm asynchronous auto-merge");
    assert.include(forge, "const mergeAttempts = sha ?");
    assert.include(forge, '["--merge"]');
    assert.include(forge, "did not merge");
    assert.include(forge, "has merge conflicts");
    assert.isTrue(originUnknownOption("Unknown argument: sha", "sha"));
    assert.isTrue(originUnknownOption("unknown flag: auto", "auto"));
    assert.isFalse(originUnknownOption("merge failed", "sha"));
  });

  it("fails closed when an expected merge head is absent or different", () => {
    const expected = "a".repeat(40);
    assert.doesNotThrow(() => assertPullRequestHeadSha("198", { headSha: expected }, expected));
    assert.throws(
      () => assertPullRequestHeadSha("198", { status: "open" }, expected),
      /refusing an unpinned merge/u,
    );
    assert.throws(
      () => assertPullRequestHeadSha("198", { headSha: "b".repeat(40) }, expected),
      /expected/u,
    );
    assert.throws(
      () => assertPullRequestHeadSha("198", { headSha: expected }, "abc123"),
      /full commit object ID/u,
    );
  });

  it("matches Origin list payloads by headRef", () => {
    assert.equal(
      pullRequestHeadName({ headRef: "automation/upstream-v1" }),
      "automation/upstream-v1",
    );
    assert.equal(pullRequestHeadName({ headRefName: "legacy" }), "legacy");
    const forge = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const listFn = forge.slice(
      forge.indexOf("export function listPullRequests"),
      forge.indexOf("export function findPullRequest"),
    );
    assert.include(listFn, "number,title,status,headRef,headSha");
    assert.include(listFn, '"number,title,status"');
    assert.include(listFn, "fields.at(-1)");
  });

  it("treats Origin mergeability variants as mergeable", () => {
    assert.isTrue(isMergeableState("clean"));
    assert.isTrue(isMergeableState("unstable"));
    assert.isTrue(isMergeableState("MERGEABLE"));
    assert.isTrue(isMergeableState("mergeable"));
    assert.isTrue(isMergeableState({ state: "ready" }));
    assert.isTrue(isMergeableState({ verdict: "mergeable" }));
    assert.isTrue(isMergeableState({ mergeable: true, hasMergeConflicts: false }));
    assert.isFalse(isMergeableState("blocked"));
    assert.isFalse(isMergeableState("dirty"));
    assert.isFalse(isMergeableState({ mergeable: false }));
    assert.isFalse(isMergeableState({ hasMergeConflicts: true, mergeable: true }));
    assert.isFalse(
      isMergeableState({
        mergeability: { verdict: "blocked" },
      }),
    );
  });

  it("reads Origin nested mergeability for conflicts and merged status", () => {
    const conflicted = {
      status: "open",
      mergeability: {
        mergeable: false,
        hasMergeConflicts: true,
        conflictedPaths: ["apps/web/src/index.css"],
        mergeability: {
          verdict: "blocked",
          blockers: [{ kind: "stack-conflicts-with-root-base" }],
        },
      },
    };
    assert.isTrue(hasMergeConflicts(conflicted));
    assert.isFalse(isPullRequestMerged(conflicted));
    assert.include(describeMergeConflicts("104", conflicted), "apps/web/src/index.css");

    assert.isTrue(
      isPullRequestMerged({
        status: "merged",
        mergedAt: "2026-08-21T16:00:00Z",
        mergeCommitSha: "abc",
      }),
    );
    assert.isFalse(isPullRequestMerged({ status: "open", mergeCommitSha: "abc" }));
    assert.isFalse(hasMergeConflicts({ status: "open", mergeability: { mergeable: true } }));
  });

  it("keeps polling while Origin computes mergeability", () => {
    const forge = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const waitFn = forge.slice(
      forge.indexOf("export function waitForMergeable"),
      forge.indexOf("export function originUnknownOption"),
    );
    assert.notInclude(waitFn, "if (state == null) return viewed;");
    assert.include(waitFn, "while it computes");
    assert.include(waitFn, "if (!last) return lastViewed;");
    assert.include(waitFn, "safeCommandDiagnostic");
  });

  it("preserves isolated command environments and strict PR list parsing", () => {
    const forge = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const runCommandFn = forge.slice(
      forge.indexOf("export function runCommand"),
      forge.indexOf("export function runOrigin"),
    );
    const listFn = forge.slice(
      forge.indexOf("export function listPullRequests"),
      forge.indexOf("export function findPullRequest"),
    );
    assert.include(runCommandFn, "env: originChildEnv(commandEnv)");
    assert.notInclude(runCommandFn, "originChildEnv(process.env)");
    assert.include(listFn, 'parseOriginJson(runOrigin(args), "listing pull requests")');
    assert.notInclude(listFn, "parseJson(runOrigin(args), [])");
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

  it("writes the blocked-sync report blob and always removes temporary files", () => {
    const forge = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const reportFn = forge.slice(
      forge.indexOf("export function reportBlockedSync"),
      forge.indexOf("export function dispatchWorkflow"),
    );
    assert.include(reportFn, '["hash-object", "-w", reportFile]');
    assert.include(reportFn, '"update-index"');
    assert.include(reportFn, "finally");
    assert.include(reportFn, "NodeFS.rmSync(reportFile, { force: true })");
    assert.include(reportFn, "NodeFS.rmSync(indexFile, { force: true })");
    assert.isBelow(reportFn.indexOf("try {"), reportFn.indexOf("NodeFS.rmSync(indexFile"));
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
    assert.equal(resolveUpdateFeedUrl("http://updates.example.test/feed"), undefined);
    assert.equal(resolveUpdateFeedUrl("https://updates.example.test/feed\nPATH=/tmp"), undefined);
    assert.equal(resolveUpdateFeedUrl("https://user:secret@updates.example.test/feed"), undefined);
    assert.equal(resolveUpdateFeedUrl("https://updates.example.test/feed?token=secret"), undefined);
    assert.equal(resolveUpdateFeedUrl("https://updates.example.test/feed#latest"), undefined);
    assert.equal(
      resolveUpdateFeedUrl(`https://updates.example.test/${"a".repeat(4096)}`),
      undefined,
    );
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
    assert.deepEqual(redactCommandArgs(["s3://private-bucket/T3.dmg"], ["private-bucket"]), [
      "s3://***/T3.dmg",
    ]);
    assert.equal(
      redactCommandOutput("request failed for cursor-secret", {
        CURSOR_API_KEY: "cursor-secret",
        PATH: "/usr/bin",
      }),
      "request failed for ***",
    );
    assert.equal(
      redactCommandOutput("request failed for argument-secret", { PATH: "/usr/bin" }, [
        "auth",
        "login",
        "--api-key",
        "argument-secret",
      ]),
      "request failed for ***",
    );
  });

  it("collapses control-bearing command diagnostics under a fixed ceiling", () => {
    assert.equal(
      safeCommandDiagnostic("first\n::error::forged\u001b[31m", 24),
      "first ::error::forged [3",
    );
    assert.throws(() => safeCommandDiagnostic("text", 20_001), /safety limit/u);
  });

  it("does not expose release credentials to the remote CLI installer", () => {
    assert.deepEqual(
      originInstallerEnvironment({
        CURSOR_API_KEY: "cursor-secret",
        HOME: "/home/runner",
        PATH: "/usr/bin",
        T3CODE_RELEASE_S3_SECRET_ACCESS_KEY: "s3-secret",
      }),
      { HOME: "/home/runner", PATH: "/usr/bin" },
    );
    assert.deepEqual(
      releaseUploaderEnvironment({
        APPDATA: "C:\\Users\\runner\\AppData\\Roaming",
        CLOUDFLARE_API_TOKEN: "cloudflare-secret",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\Windows\\System32",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\runner",
      }),
      {
        APPDATA: "C:\\Users\\runner\\AppData\\Roaming",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\Windows\\System32",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\runner",
      },
    );
  });

  it("resolves npm's JavaScript npx entrypoint for shell-free Windows uploads", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "origin-npx-"));
    try {
      const nodeExecutable = NodePath.join(directory, "node.exe");
      const npxCli = NodePath.join(directory, "node_modules", "npm", "bin", "npx-cli.js");
      NodeFS.mkdirSync(NodePath.dirname(npxCli), { recursive: true });
      NodeFS.writeFileSync(npxCli, "// fixture\n");
      assert.equal(resolveNpxCli(nodeExecutable), npxCli);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes the remote release tag only after every updater asset", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const publishStart = source.indexOf("export function publishOriginRelease");
    const publishEnd = source.indexOf("export function uploadReleaseAsset", publishStart);
    const publish = source.slice(publishStart, publishEnd);
    const uploadCall = "uploadReleaseAsset(asset, resolveReleaseObjectKey(objectKey))";
    const pushCall = 'runReleaseGit(["push", "origin", `refs/tags/${tag}`])';

    assert.isAtLeast(publish.indexOf(uploadCall), 0);
    assert.isAtLeast(publish.indexOf(pushCall), 0);
    assert.isBelow(publish.indexOf(uploadCall), publish.indexOf(pushCall));
    assert.isBelow(publish.indexOf("`${target}^{commit}`"), publish.indexOf(uploadCall));
    assert.isBelow(publish.indexOf('"ls-remote"'), publish.indexOf(uploadCall));
    assert.isBelow(publish.indexOf('runReleaseGit(["fetch"'), publish.indexOf(uploadCall));
    assert.include(publish, "user.name=t3-pretty-release[bot]");
  });

  it("uses a peeled remote tag commit and rejects malformed tag references", () => {
    const tagObject = "a".repeat(40);
    const commit = "b".repeat(40);
    assert.equal(
      parseRemoteTagCommit(
        `${tagObject}\trefs/tags/v1.2.3\n${commit}\trefs/tags/v1.2.3^{}\n`,
        "v1.2.3",
      ),
      commit,
    );
    assert.equal(parseRemoteTagCommit(`${commit}\trefs/tags/v1.2.3\n`, "v1.2.3"), commit);
    assert.isUndefined(parseRemoteTagCommit("", "v1.2.3"));
    assert.isUndefined(parseRemoteTagCommit(`${commit}\trefs/tags/another-version\n`, "v1.2.3"));
    assert.throws(
      () => parseRemoteTagCommit("not-an-object refs/tags/v1.2.3", "v1.2.3"),
      /invalid remote tag reference/u,
    );
  });

  it("rejects ambiguous updater asset object names before publication", () => {
    assert.deepEqual(releaseAssetObjectKeys(["release/T3.dmg", "release/latest-mac.yml"]), [
      "T3.dmg",
      "latest-mac.yml",
    ]);
    assert.throws(
      () => releaseAssetObjectKeys(["mac/T3.zip", "windows/T3.zip"]),
      /duplicate object name/u,
    );
    assert.throws(() => releaseAssetObjectKeys(["release/bad\nname.yml"]), /invalid object name/u);
    assert.throws(() => releaseAssetObjectKeys(["release/bad\\name.yml"]), /invalid object name/u);
    assert.throws(() => releaseAssetObjectKeys([]), /at least one updater asset/u);
    assert.equal(resolveReleaseAssetObjectKey("latest-mac.yml"), "latest-mac.yml");
    assert.isUndefined(resolveReleaseAssetObjectKey("nested/latest-mac.yml"));
    assert.isUndefined(resolveReleaseAssetObjectKey("bad\nname.yml"));
  });

  it("rejects control-bearing or oversized GitHub output values", () => {
    const previousOutput = process.env.GITHUB_OUTPUT;
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "origin-output-"));
    try {
      process.env.GITHUB_OUTPUT = NodePath.join(tempDir, "output");
      assert.throws(() => writeGitHubOutput({ release: "ok\nforged=true" }), /safety boundary/u);
      assert.throws(() => writeGitHubOutput({ release: "x".repeat(8193) }), /safety boundary/u);
    } finally {
      if (previousOutput === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = previousOutput;
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads Origin request bodies through a bounded UTF-8 handle", () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "origin-body-"));
    try {
      const bodyPath = NodePath.join(tempDir, "body.md");
      NodeFS.writeFileSync(bodyPath, "hello");
      assert.equal(readOriginBodyFile(bodyPath, 5), "hello");
      NodeFS.writeFileSync(bodyPath, "123456");
      assert.throws(() => readOriginBodyFile(bodyPath, 5), /bounded regular file/u);
    } finally {
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uploads updater manifests only after their referenced payloads", () => {
    assert.deepEqual(
      releaseAssetUploadPlan([
        "release/nightly.yml",
        "release/T3.exe",
        "release/T3.exe.blockmap",
        "release/nightly-mac.yml",
        "release/T3.zip",
      ]),
      [
        { asset: "release/T3.exe", objectKey: "T3.exe" },
        { asset: "release/T3.exe.blockmap", objectKey: "T3.exe.blockmap" },
        { asset: "release/T3.zip", objectKey: "T3.zip" },
        { asset: "release/nightly.yml", objectKey: "nightly.yml" },
        { asset: "release/nightly-mac.yml", objectKey: "nightly-mac.yml" },
      ],
    );
  });

  it("bounds object-store addressing without accepting credential-bearing URLs", () => {
    assert.equal(resolveReleaseBucket("t3-pretty-releases"), "t3-pretty-releases");
    assert.isUndefined(resolveReleaseBucket("t3-pretty/releases"));
    assert.isUndefined(resolveReleaseBucket(`bucket-${"a".repeat(256)}`));

    assert.equal(resolveReleaseRegion("auto"), "auto");
    assert.equal(resolveReleaseRegion("us-east-1"), "us-east-1");
    assert.isUndefined(resolveReleaseRegion("us-east-1\nAWS_PROFILE=attacker"));

    assert.equal(
      resolveReleaseEndpointUrl("https://account.r2.cloudflarestorage.com"),
      "https://account.r2.cloudflarestorage.com/",
    );
    assert.isUndefined(resolveReleaseEndpointUrl("https://user:secret@example.test"));
    assert.isUndefined(resolveReleaseEndpointUrl("https://example.test?token=secret"));
    assert.isUndefined(resolveReleaseEndpointUrl("https://example.test/#fragment"));
    assert.isUndefined(resolveReleaseEndpointUrl(`https://example.test/${"a".repeat(4096)}`));

    assert.equal(resolveReleaseCredential("secret+/=", 32), "secret+/=");
    assert.isUndefined(resolveReleaseCredential("secret\nvalue", 32));
    assert.isUndefined(resolveReleaseCredential("a".repeat(33), 32));
    assert.equal(
      resolveCloudflareAccountId("a6f705b8c6459d937d32d31555f9fbf6"),
      "a6f705b8c6459d937d32d31555f9fbf6",
    );
    assert.equal(
      resolveCloudflareAccountId(
        undefined,
        "https://a6f705b8c6459d937d32d31555f9fbf6.r2.cloudflarestorage.com",
      ),
      "a6f705b8c6459d937d32d31555f9fbf6",
    );
    assert.isUndefined(resolveCloudflareAccountId("not-an-account"));
  });

  it("bounds release notes reads and fails when an explicit file is missing", () => {
    const notesPath = NodePath.resolve(here, "origin-forge.test.mjs");
    assert.include(readReleaseNotesFile(notesPath), "Origin forge constants");
    assert.throws(() => readReleaseNotesFile(notesPath, 8), /safety limit/u);
    assert.throws(() => readReleaseNotesFile(`${notesPath}.missing`), /does not exist/u);
  });

  it("clips a large integration report to the publisher's release-note limit", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "origin-notes-"));
    try {
      const reportPath = NodePath.join(directory, "report.md");
      const outputPath = NodePath.join(directory, "notes.md");
      NodeFS.writeFileSync(reportPath, `# Integration\n${"é".repeat(1024 * 1024)}`);
      const notes = prepareReleaseNotesFile({
        outputPath,
        target: "a".repeat(40),
        upstreamTag: "v0.0.34-nightly.20260823.1",
        reportPath,
      });

      assert.isAtMost(Buffer.byteLength(notes, "utf8"), 1024 * 1024);
      assert.include(notes, "complete report remains in the repository");
      assert.equal(readReleaseNotesFile(outputPath), notes);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the fork release and sync workflows off the GitHub CLI", () => {
    const sync = workflow("fork-upstream-sync.yml");
    const syncScript = NodeFS.readFileSync(NodePath.resolve(here, "run-upstream-sync.sh"), "utf8");
    const desktop = workflow("fork-release.yml");
    const mobile = NodeFS.readFileSync(NodePath.resolve(here, "publish-mobile-release.sh"), "utf8");
    const reviewCi = NodeFS.readFileSync(NodePath.resolve(here, "review-origin-pr-ci.sh"), "utf8");

    for (const source of [sync, syncScript, desktop, mobile]) {
      assert.notInclude(source, "gh api");
      assert.notInclude(source, "gh release");
      assert.notInclude(source, "gh workflow");
    }
    assert.include(sync, "run-upstream-sync.sh");
    assert.include(syncScript, "origin-forge.mjs");
    assert.include(mobile, "origin-forge.mjs");
    assert.include(syncScript, "https://github.com/pingdotgg/t3code.git");
    assert.include(syncScript, "git remote get-url upstream");
    assert.include(syncScript, "git remote set-url upstream");
    assert.notInclude(syncScript, '>> "$GITHUB_OUTPUT"');
    assert.include(syncScript, "Do not write GITHUB_OUTPUT");
    assert.include(syncScript, "GIT_TERMINAL_PROMPT");
    assert.include(syncScript, "unset NO_COLOR");
    assert.include(syncScript, "git merge --abort");
    assert.include(syncScript, "refs/heads/automation/upstream-*");
    assert.include(syncScript, "same_first_parent_line");
    assert.include(sync, 'GIT_TERMINAL_PROMPT: "0"');
    const preparePath = sync.slice(
      sync.indexOf("Prepare macOS runner PATH"),
      sync.indexOf("Checkout fork main"),
    );
    assert.notInclude(preparePath, "persist-ci-path.sh");
    assert.include(preparePath, "writing t3-pretty-ci.env under /tmp");
    assert.isBelow(
      preparePath.indexOf('mkdir -p "$dir" || dir="/tmp"'),
      preparePath.indexOf('ci_env="${dir}/t3-pretty-ci.env"'),
    );
    assert.include(preparePath, 'echo "PATH=${PATH}" >> "$GITHUB_ENV"');
    assert.notInclude(preparePath, "GITHUB_WORKSPACE:-${HOME}");
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
    assert.include(mobile, "macos-release (m5-dev)");
    assert.notInclude(mobile, "keeping importer tree");
    assert.notInclude(mobile, "t3_require_ota");
    assert.include(desktop, "ensure-linux-node.sh");
    assert.include(desktop, "PREFLIGHT_REF");
    assert.include(desktop, "needs.preflight.result == 'success'");
    assert.notInclude(desktop, "/usr/local --strip-components=1");
    assert.include(preflight, "Could not fetch Origin fork tags");
    assert.include(preflight, "origin_tags_ok");
    assert.include(preflight, "No fork tags are present; refusing to mint a version.");
    assert.include(preflight, "can_mint=false");
    assert.include(preflight, "can_mint=true");
    assert.include(preflight, "steps.checkout.outputs.ready == 'true'");
    assert.include(preflight, "steps.tags.outputs.can_mint == 'true'");
    assert.include(preflight, "steps.release.outcome == 'success'");
    assert.include(preflight, "steps.release.outputs.minted == 'true'");
    assert.include(preflight, "steps.release.outputs.version != ''");
    assert.include(preflight, "steps.release.outputs.version != '-'");
    assert.include(preflight, "continue-on-error: true");
    assert.notInclude(mobile, "GITHUB_ENV is required");
    assert.notInclude(mobile, "grep -vE '^[[:space:]]*(#|$)' ../../.env.local >> \"$GITHUB_ENV\"");
    assert.include(mobile, "load_dotenv");
    assert.include(sync, ". scripts/fork/macos-ci-prelude.sh");
    assert.include(
      sync,
      ". scripts/fork/load-buildkite-secrets.sh CURSOR_API_KEY CLI_PROXY_API_KEY",
    );
    assert.notInclude(sync, "bash scripts/fork/load-buildkite-secrets.sh");
    assert.include(mobile, "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65");
    assert.notInclude(mobile, "vars.T3CODE_MOBILE_EAS_PROJECT_ID");
    assert.notInclude(mobile, "vars.APPLE_TEAM_ID");
    assert.notInclude(mobile, "secrets.EXPO_TOKEN");
    assert.notInclude(mobile, "secrets.APPLE_API_KEY");
    assert.notInclude(mobile, "secrets.APPLE_API_KEY_ID");
    assert.notInclude(mobile, "secrets.APPLE_API_ISSUER");
    assert.include(sync, "load-buildkite-secrets.sh");
    assert.include(mobile, "load_secret EXPO_TOKEN");
    const secretsHelper = NodeFS.readFileSync(
      NodePath.resolve(here, "load-buildkite-secrets.sh"),
      "utf8",
    );
    assert.include(
      secretsHelper,
      "buildkite-agent is not on PATH; leaving existing environment in place.",
    );
    assert.notInclude(secretsHelper, "GITHUB_ENV is required");
    assert.include(secretsHelper, "t3_ci_env_path");
    assert.include(secretsHelper, "BASH_SOURCE[0]");
    assert.notInclude(secretsHelper, "GITHUB_WORKSPACE:-${HOME}");
    const prelude = NodeFS.readFileSync(NodePath.resolve(here, "macos-ci-prelude.sh"), "utf8");
    const ciEnv = NodeFS.readFileSync(NodePath.resolve(here, "ci-env.sh"), "utf8");
    assert.include(prelude, "__T3_CI_ENV_EOF__");
    assert.include(prelude, "t3_persist_dotenv_file");
    assert.notInclude(prelude, 'printf \'%s=%s\\n\' "$name" "$value" >> "$GITHUB_ENV"');
    assert.notInclude(prelude, "GITHUB_WORKSPACE:-${HOME}");
    assert.include(ciEnv, "writing t3-pretty-ci.env under /tmp");
    assert.notInclude(ciEnv, "return 1");
    assert.notInclude(mobile, "t3_persist_dotenv_file");
    assert.notInclude(mobile, "GITHUB_WORKSPACE:-${HOME}");
    assert.include(mobile, "load_secret APPLE_API_KEY");
    assert.include(mobile, "load_secret APPLE_API_KEY_ID");
    assert.include(mobile, "load_secret APPLE_API_ISSUER");
    assert.include(mobile, "load_secret APPLE_TEAM_ID");
    assert.include(preflight, "Create a monotonic fork version");
    const releaseStep = preflight.slice(
      preflight.indexOf("id: release"),
      preflight.indexOf("id: changelog"),
    );
    assert.include(releaseStep, "T3_SKIP_UNRESOLVABLE_MINT");
    assert.notInclude(releaseStep, "continue-on-error:");
    assert.include(preflight, "Mac signing secrets are resolved on macos-release");
    assert.include(preflight, "git fetch --force --tags origin");
    assert.include(mobile, "origin-forge.mjs merge-pr");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );
    assert.include(pipeline, "run-upstream-sync.sh");
    assert.include(pipeline, "t3-pretty/upstream-sync");
    assert.include(
      pipeline,
      'build.branch == "main" && (build.source == "schedule" || build.source == "ui" || build.source == "api")',
    );
    assert.notInclude(pipeline, "- .github/workflows/fork-upstream-sync.yml");
    assert.include(pipeline, "soft_fail: true");
    assert.include(pipeline, "fork-release.yml");
    assert.notInclude(pipeline, "- .github/workflows/fork-mobile-release.yml");
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
    assert.notInclude(pipeline, "queue: macos-package");
    assert.include(pipeline, "queue: windows-release");
    assert.include(pipeline, "queue: linux-small");
    const dmgStep = pipeline.slice(pipeline.indexOf(":mac: macOS arm64 DMG"));
    assert.include(dmgStep.slice(0, 900), "queue: macos-release");
    const linuxStep = pipeline.slice(pipeline.indexOf(":linux: Linux x64 AppImage"));
    assert.include(linuxStep.slice(0, 900), "queue: linux-small");
    const reviewStep = pipeline.slice(pipeline.indexOf(":mag: Origin PR Review"));
    assert.include(reviewStep.slice(0, 900), "queue: macos-release");
    assert.include(pipeline, "github-actions#v0.13.0");
    assert.include(pipeline, 'version: "0.35.1"');
    assert.include(pipeline, "runs-on: macos-latest");
    assert.notInclude(pipeline, "runs-on: self-hosted");
    assert.include(pipeline, "build-windows-nsis.ps1");
    assert.include(pipeline, "build-macos-dmg.sh");
    assert.include(pipeline, "build-linux-appimage.sh");
    assert.include(pipeline, "publish-mobile-release.sh");
    assert.include(pipeline, 'build.source != "schedule"');
    assert.notInclude(pipeline, "depends_on: origin-workflows");
    assert.notInclude(pipeline, "\n    secrets:");
    const nsis = NodeFS.readFileSync(NodePath.resolve(here, "build-windows-nsis.ps1"), "utf8");
    assert.include(nsis, "corepack pnpm");
    assert.include(nsis, "Invoke-Pnpm install");
    assert.include(nsis, "${LASTEXITCODE}");
    assert.include(nsis, "$env:RUSTUP_TOOLCHAIN");
    assert.include(nsis, "upload-assets");
    assert.notInclude(nsis, "$env:VP_HOME");
    assert.notInclude(nsis, "Test-OfficialVp");
    assert.notInclude(nsis, "VITE_PLUS_BIN_DIR");
    assert.notInclude(nsis, "AppData\\Roaming\\npm");
  });

  it("uploads updater assets through bounded isolated AWS or Wrangler invocations", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    assert.include(source, "T3CODE_RELEASE_S3_ACCESS_KEY_ID");
    assert.include(source, "T3CODE_RELEASE_S3_SECRET_ACCESS_KEY");
    assert.include(source, 'const args = ["s3", "cp"');
    assert.include(source, '"--only-show-errors"');
    assert.include(source, "CLOUDFLARE_API_TOKEN");
    assert.include(source, "const wranglerArgs = [");
    assert.include(source, 'runCommand("wrangler", wranglerArgs, options)');
    assert.include(source, 'runCommand("npx", ["--yes", "wrangler", ...wranglerArgs], options)');
    assert.include(source, "runCommand(process.execPath, [npxCli");
    assert.include(source, "releaseUploaderEnvironment");
    assert.include(source, "inheritEnv: false");
    assert.notInclude(source, "const env = { ...process.env }");
    assert.include(source, 'case "upload-assets"');
    assert.include(source, 'case "prepare-release-notes"');
    assert.include(source, "originGitConfigArgs");
    assert.include(source, "credential.https://origin.cursor.com.helper");
    assert.include(source, "maxBuffer");
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
      process.env.T3CODE_RELEASE_S3_PREFIX = "../escape";
      assert.isUndefined(resolveReleaseObjectKey("latest.yml"));
      process.env.T3CODE_RELEASE_S3_PREFIX = "nested//empty";
      assert.isUndefined(resolveReleaseObjectKey("latest.yml"));
      process.env.T3CODE_RELEASE_S3_PREFIX = `prefix/${"a".repeat(1024)}`;
      assert.isUndefined(resolveReleaseObjectKey("latest.yml"));
      assert.equal(
        resolveReleaseObjectPath("t3-pretty/latest/latest.yml"),
        "t3-pretty/latest/latest.yml",
      );
      assert.isUndefined(resolveReleaseObjectPath("../latest.yml"));
      assert.isUndefined(resolveReleaseObjectPath("nested//latest.yml"));
      assert.isUndefined(resolveReleaseObjectPath("nested/latest\n.yml"));
    } finally {
      if (previousFeed === undefined) delete process.env.T3CODE_DESKTOP_UPDATE_FEED_URL;
      else process.env.T3CODE_DESKTOP_UPDATE_FEED_URL = previousFeed;
      if (previousPrefix === undefined) delete process.env.T3CODE_RELEASE_S3_PREFIX;
      else process.env.T3CODE_RELEASE_S3_PREFIX = previousPrefix;
    }
  });

  it("pushes the release tag only after asset uploads succeed", () => {
    const source = NodeFS.readFileSync(NodePath.resolve(here, "origin-forge.mjs"), "utf8");
    const uploadAt = source.indexOf(
      "uploadReleaseAsset(asset, resolveReleaseObjectKey(objectKey))",
    );
    const pushAt = source.indexOf('runReleaseGit(["push", "origin", `refs/tags/${tag}`])');
    assert.isTrue(uploadAt > 0);
    assert.isTrue(pushAt > uploadAt);
  });
});
