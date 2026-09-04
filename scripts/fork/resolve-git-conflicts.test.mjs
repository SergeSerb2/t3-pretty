import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  applyResolutionEdits,
  assertValidResolutionProgressSource,
  assertValidResolvedSource,
  buildConflictPrompt,
  buildValidationRetryPrompt,
  conflictResolutionEfforts,
  formatSyncReport,
  isBinaryAssetConflict,
  isGeneratedLockfile,
  isForkDeletionConflict,
  isProviderAvailabilityFailure,
  MAX_BATCHES_PER_FILE,
  MAX_PROVIDER_AVAILABILITY_ATTEMPTS,
  MAX_VALIDATION_ATTEMPTS,
  materializeResolutionProgressForValidation,
  nextProviderAvailabilityAttempt,
  prepareConflictPrompt,
  providerAvailabilityRetryDelayMs,
  pruneResolutionCache,
  quarantineCachedResolution,
  readCachedResolution,
  readResponseTextBounded,
  readReusedSyncReport,
  readTextFileBounded,
  resolutionCacheKey,
  restoreResolutionCacheMtimes,
  writePartialResolutionCheckpoint,
  writeCachedResolution,
} from "./resolve-git-conflicts.mjs";

const resolverPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "./resolve-git-conflicts.mjs",
);
const syncWorkflowPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../.github/workflows/fork-upstream-sync.yml",
);
const syncScriptPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "./run-upstream-sync.sh",
);
const currentSyncFallbackPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "./current-sync-fallback.awk",
);
const mobileReleasePath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "./publish-mobile-release.sh",
);

describe("T3 Pretty upstream conflict resolver", () => {
  it("bounds model response and cached-file reads", async () => {
    assert.equal(await readResponseTextBounded(new Response("small"), 5), "small");
    let responseFailure;
    try {
      await readResponseTextBounded(new Response("too-large"), 5);
    } catch (error) {
      responseFailure = error;
    }
    assert.match(String(responseFailure), /safety limit/u);

    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-bounds-"));
    const path = NodePath.join(directory, "entry.json");
    NodeFS.writeFileSync(path, "123456");
    assert.throws(() => readTextFileBounded(path, 5, path), /safety limit/u);
  });

  it("bounds the aggregate resolution cache and removes non-cache entries", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-cache-prune-"));
    try {
      const keys = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
      for (const [index, key] of keys.entries()) {
        const path = NodePath.join(directory, `${key}.json`);
        NodeFS.writeFileSync(path, "12345");
        NodeFS.utimesSync(path, index + 1, index + 1);
      }
      NodeFS.writeFileSync(NodePath.join(directory, "unexpected.json"), "ignored");
      NodeFS.writeFileSync(NodePath.join(directory, "active-upstream-tag"), "nightly-1\n");

      assert.deepEqual(pruneResolutionCache({ cacheDir: directory, maxEntries: 2, maxBytes: 10 }), {
        kept: 2,
        removed: 2,
        bytes: 10,
      });
      assert.isFalse(NodeFS.existsSync(NodePath.join(directory, `${keys[0]}.json`)));
      assert.isTrue(NodeFS.existsSync(NodePath.join(directory, `${keys[1]}.json`)));
      assert.isTrue(NodeFS.existsSync(NodePath.join(directory, `${keys[2]}.json`)));
      assert.isFalse(NodeFS.existsSync(NodePath.join(directory, "unexpected.json")));
      assert.equal(
        NodeFS.readFileSync(NodePath.join(directory, "active-upstream-tag"), "utf8"),
        "nightly-1\n",
      );
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to prune a broad temporary-directory root", () => {
    assert.throws(() => pruneResolutionCache({ cacheDir: NodeOS.tmpdir() }), /broad or protected/u);
  });

  it("breaks same-time cache recency ties by key", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-cache-ties-"));
    try {
      const first = `${"a".repeat(64)}.json`;
      const second = `${"b".repeat(64)}.json`;
      for (const name of [second, first]) {
        const path = NodePath.join(directory, name);
        NodeFS.writeFileSync(path, "1");
        NodeFS.utimesSync(path, 10, 10);
      }

      pruneResolutionCache({ cacheDir: directory, maxEntries: 1, maxBytes: 1 });

      assert.isTrue(NodeFS.existsSync(NodePath.join(directory, first)));
      assert.isFalse(NodeFS.existsSync(NodePath.join(directory, second)));
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores cache recency before pruning an extracted archive", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-cache-mtimes-"));
    try {
      const older = `${"1".repeat(64)}.json`;
      const newer = `${"2".repeat(64)}.json`;
      NodeFS.writeFileSync(NodePath.join(directory, older), "12345");
      NodeFS.writeFileSync(NodePath.join(directory, newer), "12345");

      restoreResolutionCacheMtimes({
        cacheDir: directory,
        manifest: `10\t${older}\n20\t${newer}\n`,
      });
      pruneResolutionCache({ cacheDir: directory, maxEntries: 1, maxBytes: 5 });

      assert.isFalse(NodeFS.existsSync(NodePath.join(directory, older)));
      assert.isTrue(NodeFS.existsSync(NodePath.join(directory, newer)));
      assert.throws(
        () => restoreResolutionCacheMtimes({ cacheDir: directory, manifest: `30\t${older}\n` }),
        /missing cache entry/u,
      );
      assert.throws(
        () =>
          restoreResolutionCacheMtimes({ cacheDir: directory, manifest: "20\t../escape.json\n" }),
        /invalid resolution-cache timestamp manifest/u,
      );
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses NUL-delimited Git output for potentially unusual conflict paths", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, '["diff", "--name-only", "--diff-filter=U", "-z"]');
    assert.include(resolver, '["ls-files", "-u", "-z"]');
    assert.include(resolver, '["ls-files", "-u", "-z", "--", path]');
  });

  it("makes fork preservation, compatible parent integration, and omission reporting explicit", () => {
    const prompt = buildConflictPrompt({
      path: "apps/web/src/components/Sidebar.tsx",
      forkHistory: "- abc123 feat(pretty): add the compact sidebar",
      conflicts: [
        {
          index: 0,
          context: "<<<<<<< ours\npretty sidebar\n=======\nparent sidebar\n>>>>>>> theirs\n",
        },
      ],
    });

    assert.include(prompt, "OURS is T3 Pretty main");
    assert.include(prompt, "parent first-party replacement");
    assert.include(prompt, "native mobile pull-request manager");
    assert.include(prompt, "Integrate every compatible parent improvement");
    assert.include(prompt, "omit only the smallest conflicting portion");
    assert.include(prompt, "An omission must never be silent");
    assert.include(prompt, "feat(pretty): add the compact sidebar");
    assert.include(prompt, "upstream_changes_omitted");
    assert.include(prompt, "fork-owned Expo project and OTA boundary");
    assert.include(prompt, "integrate compatible upstream mobile features");
    assert.include(prompt, "take upstream's implementation and keep only Pretty branding");
  });

  it("allows a large generated file when its conflict prompt remains bounded", () => {
    const unchangedPrefix = "      unchanged-dependency:\n        version: 1.0.0\n".repeat(18_000);
    const conflictedSource = `${unchangedPrefix}${"<".repeat(7)} ours
      '@lezer/highlight':
        version: 1.2.3
${"|".repeat(7)} base
${"=".repeat(7)}
      '@noble/hashes':
        version: 1.8.0
${">".repeat(7)} theirs
      trailing-dependency:
        version: 2.0.0
`;

    assert.isAbove(Buffer.byteLength(conflictedSource), 600_000);
    const { conflicts, prompt } = prepareConflictPrompt({
      path: "pnpm-lock.yaml",
      conflictedSource,
      forkHistory: "",
    });

    assert.lengthOf(conflicts, 1);
    assert.include(prompt, "@lezer/highlight");
    assert.include(prompt, "@noble/hashes");
    assert.isBelow(Buffer.byteLength(prompt), 600_000);
  });

  it("still refuses conflict context that would exceed the model input guard", () => {
    const conflictedSource = `${"<".repeat(7)} ours
${"a".repeat(600_000)}
${"|".repeat(7)} base
${"=".repeat(7)}
theirs
${">".repeat(7)} theirs
`;

    assert.throws(
      () =>
        prepareConflictPrompt({
          path: "oversized.txt",
          conflictedSource,
          forkHistory: "",
        }),
      /exceeds the 600000-byte conflict prompt limit/u,
    );
  });

  it("stops extracting conflict contexts when they exhaust the prompt budget, deferring the rest to the next batch", () => {
    const smallConflict = (ours, theirs) => `${"<".repeat(7)} ours
${ours}
${"|".repeat(7)} base
${"=".repeat(7)}
${theirs}
${">".repeat(7)} theirs
`;
    // 60 long lines of padding: the first conflict's 100-line context window
    // fits the budget, but the second conflict's window on top of it does
    // not, so it is deferred to the next batch instead of failing the file.
    const padding = `${Array.from({ length: 60 }, () => "p".repeat(9_000)).join("\n")}\n`;
    const conflictedSource = `${smallConflict("a", "b")}${padding}${smallConflict("c", "d")}`;

    const { conflicts, prompt, totalConflicts } = prepareConflictPrompt({
      path: "generated-lockfile.yaml",
      conflictedSource,
      forkHistory: "",
    });

    assert.equal(totalConflicts, 2);
    assert.lengthOf(conflicts, 1);
    assert.isBelow(Buffer.byteLength(prompt), 600_000);
  });

  it("caps how many conflicts a single model request must resolve", () => {
    const oneConflict = `${"<".repeat(7)} ours
value
${"|".repeat(7)} base
${"=".repeat(7)}
theirs
${">".repeat(7)} theirs
`;
    const conflictedSource = oneConflict.repeat(12);

    const { conflicts, totalConflicts } = prepareConflictPrompt({
      path: "crowded.ts",
      conflictedSource,
      forkHistory: "",
      maxConflicts: 5,
    });

    assert.equal(totalConflicts, 12);
    assert.lengthOf(conflicts, 5);
    assert.deepEqual(
      conflicts.map((conflict) => conflict.index),
      [0, 1, 2, 3, 4],
    );
  });

  it("never clips a neighboring conflict inside a conflict's local context", () => {
    // Conflicts ~46 lines apart: the 100-line context windows reach two
    // neighbors over, and without clamping they end mid-conflict. A clipped
    // marker block reads as a truncated, unresolvable conflict to the model.
    const unit = `${"<".repeat(7)} ours
ours code
${"|".repeat(7)} base
base code
${"=".repeat(7)}
theirs code
${">".repeat(7)} theirs
${Array.from({ length: 40 }, (_, index) => `filler line ${index}`).join("\n")}
`;
    const conflictedSource = unit.repeat(12);

    const { conflicts, totalConflicts } = prepareConflictPrompt({
      path: "dense.ts",
      conflictedSource,
      forkHistory: "",
      maxConflicts: 5,
    });

    assert.equal(totalConflicts, 12);
    assert.lengthOf(conflicts, 5);
    for (const conflict of conflicts) {
      const count = (pattern) => conflict.context.match(pattern)?.length ?? 0;
      assert.equal(count(/^<{7}/gmu), count(/^>{7}/gmu), `conflict ${conflict.index} context`);
      assert.equal(count(/^\|{7}/gmu), count(/^={7}/gmu), `conflict ${conflict.index} context`);
      assert.equal(count(/^<{7}/gmu), count(/^\|{7}/gmu), `conflict ${conflict.index} context`);
    }
  });

  it("presents a modify/delete conflict as one whole-file conflict with deletion guidance", () => {
    const prompt = buildConflictPrompt({
      path: "apps/mobile/src/features/threads/thread-settings-menu.ts",
      forkHistory: "",
      conflicts: [],
      deleteConflict: {
        deletedSide: "theirs",
        evidence:
          "- Parent commits deleting this file:\n- 85389b988 Nest mobile task settings in bottom sheets (#6224)",
      },
    });

    assert.include(prompt, "parent nightly deleted this file");
    assert.include(prompt, "empty new_text");
    assert.include(prompt, "parent first-party replacement");
    assert.include(prompt, "Parent deletion evidence");
    assert.include(prompt, "Nest mobile task settings in bottom sheets");

    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, "<<<<<<< OURS (T3 Pretty main");
    assert.include(resolver, 'git(["rm", "-q", "--", path])');
    assert.include(resolver, 'git(["ls-files", "-u", "-z", "--", path])');
    assert.include(resolver, "parentDeletionEvidence");
  });

  it("keeps every fork deletion deterministically without a model request", () => {
    // Fork deleted (no stage 2), parent modified (stage 3): established fork
    // intent, resolved deterministically. Any path qualifies — a hardcoded
    // list only ever covered the files someone already noticed blocking runs.
    assert.isTrue(
      isForkDeletionConflict(
        "apps/server/src/provider/opencodeRuntime.inventory.test.ts",
        new Set([1, 3]),
      ),
    );
    assert.isTrue(isForkDeletionConflict("apps/anything/else.ts", new Set([1, 3])));
    // Both sides survive, or the parent deleted: not a fork deletion.
    assert.isFalse(isForkDeletionConflict("apps/anything/else.ts", new Set([1, 2, 3])));
    assert.isFalse(isForkDeletionConflict("apps/anything/else.ts", new Set([1, 2])));
    // Stage-3-only is "added by them" (file/directory or rename conflict on a
    // path the fork never had), never a fork deletion.
    assert.isFalse(isForkDeletionConflict("apps/anything/else.ts", new Set([3])));
    // Merging origin/main into a reused sync branch puts the fork on THEIRS;
    // the rule must follow the fork side or it inverts on that merge.
    assert.isTrue(isForkDeletionConflict("apps/anything/else.ts", new Set([1, 2]), "theirs"));
    assert.isFalse(isForkDeletionConflict("apps/anything/else.ts", new Set([1, 3]), "theirs"));

    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, "isForkDeletionConflict(path)");
    assert.include(resolver, "kept T3 Pretty's deletion of");
  });

  it("falls back to the fork side instead of failing when no model resolution is available", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // A declined, invalid, or unreachable model must not stop the run: the
    // file keeps the fork side wholesale, the omission lands in the durable
    // report, and only a path whose fallback itself fails can fail the run.
    assert.include(resolver, "fork-side fallback for ${oneLine(path)}");
    assert.include(resolver, "the fork-side fallback then failed");
    assert.include(resolver, "leaving ${oneLine(path)} unresolved this run");
    assert.include(resolver, "could not be resolved this run");
    // A missing token fails fast into the fallback instead of retrying 401s.
    assert.include(resolver, "CLI_PROXY_API_KEY is unavailable");
  });

  it("lands a conflicted merge with zero model access: fork deletions and fork-side fallbacks", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-fallback-"));
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "sync@test");
      git("config", "user.name", "sync test");
      NodeFS.writeFileSync(NodePath.join(dir, "kept.txt"), "base\n");
      NodeFS.writeFileSync(NodePath.join(dir, "deleted.txt"), "base\n");
      git("add", ".");
      git("commit", "-qm", "base");
      git("checkout", "-qb", "theirs");
      NodeFS.writeFileSync(NodePath.join(dir, "kept.txt"), "theirs\n");
      NodeFS.writeFileSync(NodePath.join(dir, "deleted.txt"), "theirs\n");
      git("commit", "-aqm", "parent changes");
      git("checkout", "-q", "main");
      NodeFS.writeFileSync(NodePath.join(dir, "kept.txt"), "ours\n");
      git("rm", "-q", "deleted.txt");
      git("commit", "-aqm", "fork changes");
      let merged = true;
      try {
        git("merge", "theirs");
      } catch {
        merged = false;
      }
      assert.isFalse(merged, "the merge must conflict for this test to mean anything");

      // No CLI_PROXY_API_KEY: the resolver must still land every conflict —
      // the fork deletion deterministically, the content conflict through
      // the fork-side fallback — and exit 0.
      const env = {
        ...process.env,
        SYNC_RESOLUTION_CACHE_DIR: NodePath.join(dir, "cache"),
        UPSTREAM_TAG: "v0.0.0-nightly.test",
        PREVIOUS_UPSTREAM_TAG: "",
        REUSED_SYNC_RESOLUTION: "false",
      };
      delete env.CLI_PROXY_API_KEY;
      const output = NodeChildProcess.execFileSync(process.execPath, [resolverPath], {
        cwd: dir,
        encoding: "utf8",
        env,
      });

      assert.include(output, "kept T3 Pretty's deletion of deleted.txt");
      assert.include(output, "fork-side fallback for kept.txt");
      assert.equal(NodeFS.readFileSync(NodePath.join(dir, "kept.txt"), "utf8"), "ours\n");
      assert.isFalse(NodeFS.existsSync(NodePath.join(dir, "deleted.txt")));
      assert.equal(git("diff", "--name-only", "--diff-filter=U"), "");
      const report = NodeFS.readFileSync(
        NodePath.join(dir, ".t3-fork/upstream-sync-report.md"),
        "utf8",
      );
      assert.include(report, "took the fork-side fallback");
      assert.include(report, "kept T3 Pretty's intentional deletion of this file");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("summarizes fork-side fallbacks in the durable report", () => {
    const report = formatSyncReport({
      upstreamTag: "v0.0.37-nightly.20260830.1227",
      previousUpstreamTag: "v0.0.37-nightly.20260830.1226",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      protectedWorkflowPaths: [],
      resolutions: [
        {
          path: "apps/web/src/cloud/linkEnvironment.ts",
          deterministic: true,
          fallback: true,
          forkChangesPreserved: ["kept the fork side wholesale as a fork-side fallback resolution"],
          upstreamChangesIntegrated: [],
          upstreamChangesOmitted: [
            {
              change: "every parent change at this file's conflict boundaries (fork-side fallback)",
              reason: "CLIProxyAPI did not produce a completed response after 3 attempts",
            },
          ],
        },
      ],
    });

    assert.include(report, "1 file(s) took the fork-side fallback");
    assert.include(report, "fork-side fallback");
    assert.include(report, "did not produce a completed response");
    assert.notInclude(report, "`gpt-5.6-sol` with `xhigh` reasoning");
  });

  it("still refuses files large enough to risk local conflict processing", () => {
    assert.throws(
      () =>
        prepareConflictPrompt({
          path: "oversized.txt",
          conflictedSource: "a".repeat(4 * 1024 * 1024 + 1),
          forkHistory: "",
        }),
      /exceeds the 4194304-byte local file limit/u,
    );
  });

  it("treats a source file with incidental NUL bytes as text, and NUL-dense payloads as binary", () => {
    // Upstream's ChatComposer.tsx keys composer images with a "\0"-joined
    // template literal; a raw NUL in a string literal is legal TypeScript.
    const textWithNul = `${"<".repeat(7)} ours
const key = \`\${mimeType}\0\${sizeBytes}\0\${name}\`;
${"=".repeat(7)}
const key = \`\${mimeType}:\${sizeBytes}:\${name}\`;
${">".repeat(7)} theirs
`;

    const { conflicts } = prepareConflictPrompt({
      path: "apps/web/src/components/chat/ChatComposer.tsx",
      conflictedSource: textWithNul,
      forkHistory: "",
    });
    assert.lengthOf(conflicts, 1);

    const binaryPayload = `${"<".repeat(7)} ours\n${"a\0".repeat(200)}\n${"=".repeat(7)}\nb\n${">".repeat(7)} theirs\n`;
    assert.throws(
      () =>
        prepareConflictPrompt({
          path: "payload.bin",
          conflictedSource: binaryPayload,
          forkHistory: "",
        }),
      /is binary and cannot be AI-resolved/u,
    );
  });

  it("releases synced mobile changes without releasing server-only integrations", () => {
    const syncScript = NodeFS.readFileSync(syncScriptPath, "utf8");
    const mobileRelease = NodeFS.readFileSync(mobileReleasePath, "utf8");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "../../.buildkite/pipeline.yml",
      ),
      "utf8",
    );

    assert.include(syncScript, "origin-forge.mjs dispatch");
    assert.include(syncScript, "--workflow fork-release.yml");
    assert.notInclude(syncScript, "--workflow fork-mobile-release.yml");
    assert.include(syncScript, "mobile_release_needed=true");
    assert.include(syncScript, "T3CODE_MOBILE_SKIP_PATH_FILTER=1");
    assert.include(mobileRelease, "T3CODE_MOBILE_SKIP_PATH_FILTER");
    assert.include(syncScript, "bash scripts/fork/publish-mobile-release.sh");
    assert.include(syncScript, "/tmp/t3-pretty-ios-mobile.lock");
    assert.include(pipeline, "publish-mobile-release.sh");
    assert.include(pipeline, "run-upstream-sync.sh");
    assert.include(pipeline, 'build.source != "schedule"');
    assert.include(mobileRelease, "mobile path filter");
    assert.include(mobileRelease, "apps/mobile");
    assert.include(mobileRelease, '"$MODE" == "update" || "$MODE" == "release"');
    assert.include(mobileRelease, '"$MODE" != "build" && "$MODE" != "release"');
    assert.include(mobileRelease, "EXPO_ASC_API_KEY_PATH");
    assert.include(mobileRelease, "ascApiKeyIssuerId");
    assert.include(mobileRelease, "eas update");
    assert.include(mobileRelease, "--local");
    assert.include(mobileRelease, "Xcode-beta.app");
    assert.include(mobileRelease, "xcode-select -s");
    assert.include(mobileRelease, "security-eas-local-keychain");
    assert.include(mobileRelease, "eas submit");
    assert.include(mobileRelease, "eas build:list");
    assert.notInclude(mobileRelease, "--status finished");
    assert.equal((mobileRelease.match(/--no-wait/g) || []).length, 1);
    assert.isBelow(mobileRelease.indexOf("eas update"), mobileRelease.indexOf("eas submit"));
  });

  it("fetches the previous nightly tag used for fork-history context", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, '[[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]');
    assert.include(script, '"refs/tags/$current_tag:refs/tags/$current_tag"');
    assert.include(script, 'export PREVIOUS_UPSTREAM_TAG="$current_tag"');
  });

  it("finishes a persisted upstream target before advancing to a newer nightly", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, 'origin_git show "origin/$RESOLUTION_CACHE_BRANCH:active-upstream-tag"');
    assert.include(script, 'tag_is_available "$active_tag"');
    assert.include(script, 'tag_is_newer_than_current "$active_tag"');
    assert.include(script, 'latest_tag="$active_tag"');
    assert.include(script, 'printf \'%s\\n\' "$UPSTREAM_TAG" > "$target_file"');
    assert.include(script, 'entries+=("$target_file")');
  });

  it("validates an explicit upstream target before using it", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, 'if ! tag_is_available "$SYNC_TARGET_UPSTREAM_TAG"');
    assert.include(script, 'if ! tag_is_newer_than_current "$SYNC_TARGET_UPSTREAM_TAG"');
    assert.include(script, 'latest_tag="$SYNC_TARGET_UPSTREAM_TAG"');
  });

  it("removes upstream workflows before restoring the fork-owned directory", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");
    const remove = script.indexOf("git rm -r -f --ignore-unmatch -- .github/workflows");
    const restore = script.indexOf(
      "git restore --source=origin/main --staged --worktree -- .github/workflows",
    );

    assert.isAtLeast(remove, 0);
    assert.isAbove(restore, remove);
  });

  it("fetches upstream objects eagerly instead of registering a second promisor", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    // The checkout is a blob:none partial clone of the fork remote; upstream
    // tags are fetched with --no-filter so a merge never lazily backfills an
    // upstream-only object through the fork promisor ("not our ref"). A
    // registered upstream promisor would inherit the blob:none filter and
    // recreate the missing-blob state, so leftover registrations are unset.
    assert.include(script, "git config --unset-all remote.upstream.promisor");
    assert.include(script, "git config --unset-all remote.upstream.partialclonefilter");
    assert.include(script, "--no-tags --no-filter --force upstream");
  });

  it("checks upstream every four hours and supports an explicit retry", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, "workflow_dispatch:");
    assert.include(workflow, '- cron: "0 */4 * * *"');
    assert.include(workflow, "Six checks per day");
  });

  it("accepts a clustered nightly with any number of conflicted files", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "../../.buildkite/pipeline.yml",
      ),
      "utf8",
    );

    // No fixed conflict ceiling: a hard refusal strands the fork while the
    // next nightly piles more conflicts onto the same unintegrated merge.
    // Batched model requests plus a generous job timeout bound the run.
    assert.notInclude(resolver, "Refusing to resolve");
    assert.include(resolver, "const MAX_CONFLICTS_PER_REQUEST = 1");
    assert.include(resolver, "const MAX_BATCHES_PER_FILE = 32");
    assert.include(workflow, "timeout-minutes: 120");
    assert.include(pipeline, "timeout_in_minutes: 120");
  });

  it("does not gate the merge on model- or upstream-authored whitespace", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    // Only the workflow's own metadata file is whitespace-checked. Resolver
    // output is model-composed content; a blank line at EOF must not fail an
    // otherwise complete merge after all conflicts resolved.
    assert.include(script, "lockfile_conflicted=true");
    assert.notInclude(script, "resolver_paths");
    assert.include(script, "git diff --check --cached -- .t3-fork/upstream-nightly");
    assert.notInclude(script, "          git diff --check --cached\n");
  });

  it("keeps Origin pull request bodies bounded while retaining the durable report", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, "write_sync_pr_body");
    assert.include(script, "The complete conflict-resolution audit");
    assert.notInclude(script, "cat .t3-fork/upstream-sync-report.md");
    assert.include(script, "current_sync_used_fallback");
    assert.include(script, "current-sync-fallback.awk");
    assert.notInclude(script, 'grep -q "fork-side fallback" .t3-fork/upstream-sync-report.md');
  });

  it("checks fallbacks only in the current nightly report section", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-fallback-"),
    );
    const reportPath = NodePath.join(temporaryDirectory, "upstream-sync-report.md");
    const currentTag = "v0.0.39-nightly.20260902.1260";
    const check = (report) => {
      NodeFS.writeFileSync(reportPath, report);
      return NodeChildProcess.spawnSync(
        "awk",
        ["-v", `tag=${currentTag}`, "-f", currentSyncFallbackPath, reportPath],
        { encoding: "utf8" },
      ).status;
    };

    try {
      assert.equal(
        check(`# T3 Pretty upstream integration report
- Parent nightly: \`v0.0.38-nightly.20260901.1248\`
- 1 file took the fork-side fallback
- Parent nightly: \`${currentTag}\`
- None. The resolver did not omit any parent change.
`),
        1,
      );
      assert.equal(
        check(`# T3 Pretty upstream integration report
- Parent nightly: \`${currentTag}\`
- None. The resolver did not omit any parent change.
- Parent nightly: \`v0.0.38-nightly.20260901.1248\`
- 1 file took the fork-side fallback
`),
        1,
      );
      assert.equal(
        check(`# T3 Pretty upstream integration report
- Parent nightly: \`${currentTag}\` (reconciled)\r
- 1 file took the fork-side fallback
`),
        0,
      );
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it("refuses to reuse a legacy resolution branch without its durable report", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-report-"),
    );
    const reportPath = NodePath.join(temporaryDirectory, "upstream-sync-report.md");

    try {
      assert.throws(
        () => readReusedSyncReport({ reusedResolution: true, reportPath }),
        /without its integration report/u,
      );

      NodeFS.writeFileSync(reportPath, "# T3 Pretty upstream integration report\n");
      assert.equal(
        readReusedSyncReport({ reusedResolution: true, reportPath }),
        "# T3 Pretty upstream integration report",
      );

      const script = NodeFS.readFileSync(syncScriptPath, "utf8");
      assert.include(script, 'git show "origin/$local_name:.t3-fork/upstream-sync-report.md"');
      assert.include(script, '== "# T3 Pretty upstream integration report"');
      assert.include(script, "git merge --abort");
      assert.include(script, "unset NO_COLOR");
      assert.include(script, "refs/heads/automation/upstream-*");
      assert.include(script, "Reusing the previously validated AI resolution on");
      assert.include(script, "credential.https://origin.cursor.com.helper=store --file=");
      assert.include(script, "SYNC_FAIL_REASON");
      assert.include(script, "merging origin/main and retrying once");
      assert.include(script, 'git checkout --ours -- "$path"');
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it("puts every AI and workflow-policy omission into the durable release report", () => {
    const report = formatSyncReport({
      upstreamTag: "v0.0.33-nightly.20260809.1050",
      previousUpstreamTag: "v0.0.33-nightly.20260809.1049",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      protectedWorkflowPaths: [".github/workflows/release.yml"],
      resolutions: [
        {
          path: "apps/web/src/components/Sidebar.tsx",
          forkChangesPreserved: ["kept T3 Pretty compact navigation"],
          upstreamChangesIntegrated: ["adopted the parent focus fix"],
          upstreamChangesOmitted: [
            {
              change: "parent sidebar width reset",
              reason: "it would replace T3 Pretty compact navigation",
            },
          ],
        },
      ],
    });

    assert.include(report, "`gpt-5.6-sol` with `xhigh` reasoning");
    assert.include(report, "kept T3 Pretty compact navigation");
    assert.include(report, "adopted the parent focus fix");
    assert.include(report, "parent sidebar width reset");
    assert.include(report, ".github/workflows/release.yml");
    assert.include(report, "parent workflow changes were omitted");
  });

  it("states explicitly when a clean merge omitted nothing", () => {
    const report = formatSyncReport({
      upstreamTag: "v0.0.33-nightly.20260809.1050",
      previousUpstreamTag: "v0.0.33-nightly.20260809.1049",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      protectedWorkflowPaths: [],
      resolutions: [],
    });

    assert.include(report, "Conflict resolver: not invoked");
    assert.include(report, "The resolver did not omit any parent change");
  });

  it("keeps generated lockfiles out of the model and regenerates them in the workflow", () => {
    assert.isTrue(isGeneratedLockfile("pnpm-lock.yaml"));
    assert.isTrue(isGeneratedLockfile("apps/web/pnpm-lock.yaml"));
    assert.isFalse(isGeneratedLockfile("pnpm-lock.yaml.bak"));
    assert.isFalse(isGeneratedLockfile("apps/web/package.json"));

    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, 'git(["checkout", "--theirs", "--", path])');
    assert.include(resolver, 'git(["checkout", "--ours", "--", path])');

    const script = NodeFS.readFileSync(syncScriptPath, "utf8");
    assert.include(script, '[[ "$lockfile_conflicted" == "true" ]]');
    assert.include(script, "corepack pnpm install --lockfile-only --no-frozen-lockfile");
    assert.include(script, "git add pnpm-lock.yaml");
  });

  it("reports deterministic lockfile resolutions without crediting the model", () => {
    const report = formatSyncReport({
      upstreamTag: "v0.0.34-nightly.20260813.1087",
      previousUpstreamTag: "v0.0.34-nightly.20260813.1086",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      protectedWorkflowPaths: [],
      resolutions: [
        {
          path: "pnpm-lock.yaml",
          deterministic: true,
          forkChangesPreserved: [
            "fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests",
          ],
          upstreamChangesIntegrated: [
            "took the parent nightly's generated lockfile wholesale instead of AI-splicing it",
          ],
          upstreamChangesOmitted: [],
        },
      ],
    });

    assert.include(report, "conflicts resolved deterministically");
    assert.notInclude(report, "`gpt-5.6-sol` with `xhigh` reasoning");
    assert.include(report, "AI-splicing");
    assert.include(report, "fork-only dependency entries");
  });

  it("retries transient resolver failures instead of aborting the whole sync", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // Network errors, 408, non-availability 5xx, and unparseable/incomplete
    // responses retry; retries step down to high and then medium so one
    // long-think cannot burn the same five-minute gateway timeout three times.
    assert.deepEqual(conflictResolutionEfforts({ initialEffort: "xhigh" }), [
      "xhigh",
      "high",
      "medium",
    ]);
    assert.deepEqual(conflictResolutionEfforts({ initialEffort: "high" }), [
      "high",
      "medium",
      "medium",
    ]);
    assert.deepEqual(conflictResolutionEfforts({ completedBatches: 1 }), [
      "high",
      "medium",
      "medium",
    ]);
    assert.deepEqual(conflictResolutionEfforts({ widened: true }), ["medium", "medium", "medium"]);
    assert.deepEqual(conflictResolutionEfforts({ initialEffort: "low" }), ["low", "low", "low"]);
    assert.deepEqual(
      conflictResolutionEfforts({ completedBatches: 1, widened: true, initialEffort: "low" }),
      ["low", "low", "low"],
    );
    assert.include(resolver, "while (effortIndex < efforts.length)");
    assert.include(resolver, "efforts = conflictResolutionEfforts()");
    assert.include(
      resolver,
      "const efforts = conflictResolutionEfforts({ completedBatches, widened: widenNextBatch })",
    );
    assert.include(resolver, "usedEffort = efforts[0]");
    assert.include(resolver, "status !== 0 && status !== 408 && status !== 429 && status < 500");
    assert.include(resolver, "setTimeout(resolve, effortIndex * 15_000)");
    assert.include(resolver, "did not produce a completed response");
    // Non-transient HTTP failures (auth, bad request) still throw immediately.
    assert.include(resolver, "CLIProxyAPI returned HTTP ${status}");
  });

  it("waits out provider availability without consuming reasoning attempts or falling back", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    assert.equal(MAX_PROVIDER_AVAILABILITY_ATTEMPTS, 8);
    assert.isTrue(isProviderAvailabilityFailure(502, "server_is_overloaded"));
    assert.isTrue(isProviderAvailabilityFailure(503, "auth_unavailable: no auth available"));
    assert.isTrue(isProviderAvailabilityFailure(429, "rate limit exceeded"));
    assert.isTrue(isProviderAvailabilityFailure(529, "overloaded"));
    assert.isFalse(isProviderAvailabilityFailure(503, "unrelated upstream error"));
    assert.isFalse(isProviderAvailabilityFailure(0, "fetch failed"));
    assert.equal(providerAvailabilityRetryDelayMs(1), 30_000);
    assert.equal(providerAvailabilityRetryDelayMs(4), 120_000);
    assert.equal(providerAvailabilityRetryDelayMs(8), 120_000);
    let availabilityAttempts = nextProviderAvailabilityAttempt(0, true);
    availabilityAttempts = nextProviderAvailabilityAttempt(availabilityAttempts, true);
    assert.equal(availabilityAttempts, 2);
    availabilityAttempts = nextProviderAvailabilityAttempt(availabilityAttempts, false);
    assert.equal(availabilityAttempts, 0);
    assert.equal(nextProviderAvailabilityAttempt(availabilityAttempts, true), 1);
    assert.include(resolver, "waiting without consuming the ${effort} reasoning attempt");
    assert.include(resolver, "error?.providerUnavailable === true || error?.syncDeferred === true");
  });

  it("checkpoints long syncs periodically and defers instead of falling back at the deadline", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, "while sleep 300");
    assert.include(script, "checkpoint_loaded_resolutions || true");
    assert.include(script, "git read-tree --empty");
    assert.include(script, 'local replace_cache="${1:-false}"');
    assert.include(script, 'if [[ "$RESOLUTION_CACHE_LOADED" == 1 ]]');
    assert.include(
      script,
      "git log --full-history -m --format='timestamp:%ct' --name-only --no-renames",
    );
    assert.include(script, '[[ "$remote_entry_count" == "$restored_entry_count" ]]');
    assert.include(script, "resolve-git-conflicts.mjs --restore-and-prune-cache");
    assert.include(resolver, 'process.argv[2] === "--restore-and-prune-cache"');
    assert.include(script, '[[ "$sync_landed" == 1 && "$RESOLUTION_CACHE_LOADED" == 1 ]]');
    assert.include(script, "resolve-git-conflicts.mjs --prune-cache");
    assert.include(resolver, 'process.argv[2] === "--prune-cache"');
    const cacheWriter = resolver.slice(
      resolver.indexOf("export function writeCachedResolution"),
      resolver.indexOf("export function writePartialResolutionCheckpoint"),
    );
    assert.notInclude(cacheWriter, "pruneResolutionCache");
    const resolverMain = resolver.slice(
      resolver.indexOf("async function main()"),
      resolver.indexOf("const invokedPath"),
    );
    assert.notInclude(resolverMain, "pruneResolutionCache");
    assert.include(script, "run_conflict_resolver");
    assert.include(script, "stop_conflict_resolver");
    assert.include(script, 'kill "$RESOLVER_PID"');
    const resolverStart = script.indexOf("node scripts/fork/resolve-git-conflicts.mjs &");
    const checkpointStart = script.indexOf("while sleep 300", resolverStart);
    const resolverWait = script.indexOf('wait "$RESOLVER_PID"', checkpointStart);
    const checkpointStop = script.indexOf('kill "$CHECKPOINT_PID"', resolverWait);
    assert.isAtLeast(resolverStart, 0);
    assert.isAbove(checkpointStart, resolverStart);
    assert.isAbove(resolverWait, checkpointStart);
    assert.isAbove(checkpointStop, resolverWait);
    assert.isBelow(
      script.indexOf("stop_conflict_resolver\n"),
      script.indexOf('if [[ "$has_update" == 1 ]]'),
    );
    assert.include(resolver, "throw deferredSyncError");
    assert.include(resolver, "error?.syncDeferred === true");
    assert.include(resolver, "error?.syncDeferred === true ? 75 : 1");
    assert.notInclude(resolver, "taking the fork-side fallback");
    assert.include(script, "status != 75");
  });

  it("records the iOS production fingerprint without tripping the format hook", () => {
    const mobileRelease = NodeFS.readFileSync(mobileReleasePath, "utf8");

    // The staged fingerprint record is extensionless, so `vp fmt` in the
    // pre-commit hook has no target file and fails the whole release.
    assert.include(
      mobileRelease,
      'git commit --no-verify -m "chore(mobile): record iOS production fingerprint"',
    );
  });

  it("lands the iOS fingerprint record through a pull request instead of pushing to main", () => {
    const mobileRelease = NodeFS.readFileSync(mobileReleasePath, "utf8");

    // main enforces pull requests, so the bot commit rides a short-lived
    // automation branch merged through the Origin CLI, the same pattern the
    // upstream sync uses.
    assert.include(mobileRelease, "automation/ios-fingerprint-");
    assert.include(mobileRelease, 'git push --force origin "HEAD:refs/heads/$branch"');
    assert.include(mobileRelease, "origin-forge.mjs ensure-pr");
    assert.include(mobileRelease, "origin-forge.mjs merge-pr");
    assert.include(mobileRelease, ".t3-fork/ios-native-submit");
    assert.notInclude(mobileRelease, 'git push origin "HEAD:${GITHUB_REF_NAME}"');
  });

  it("round-trips a checkpointed resolution through the cache", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-cache-"),
    );
    try {
      const key = resolutionCacheKey({
        path: "apps/web/src/App.tsx",
        conflictedSource: `${"<".repeat(7)} ours\nx\n${">".repeat(7)} theirs\ny\n`,
      });
      assert.match(key, /^[0-9a-f]{64}$/u);
      assert.equal(readCachedResolution({ key, cacheDir: temporaryDirectory }), undefined);

      writeCachedResolution({
        key,
        cacheDir: temporaryDirectory,
        entry: {
          path: "apps/web/src/App.tsx",
          resolvedSource: "x\n",
          forkChangesPreserved: ["kept x"],
          upstreamChangesIntegrated: ["took y"],
          upstreamChangesOmitted: [],
        },
      });
      const cached = readCachedResolution({ key, cacheDir: temporaryDirectory });
      assert.equal(cached.resolvedSource, "x\n");
      assert.deepEqual(cached.forkChangesPreserved, ["kept x"]);

      NodeFS.writeFileSync(NodePath.join(temporaryDirectory, `${key}.json`), "not json");
      assert.equal(readCachedResolution({ key, cacheDir: temporaryDirectory }), undefined);
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("quarantines invalid completed TS/TSX checkpoints before they can replay", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-cache-poison-"),
    );
    try {
      const poisonedKey = "a".repeat(64);
      const poisonedEntry = {
        path: "apps/web/src/Poisoned.tsx",
        resolvedSource: "export const value = 1;\nexport const value = 2;\n",
        forkChangesPreserved: [],
        upstreamChangesIntegrated: [],
        upstreamChangesOmitted: [],
      };
      const poisonedPath = NodePath.join(temporaryDirectory, `${poisonedKey}.json`);
      NodeFS.writeFileSync(poisonedPath, `${JSON.stringify(poisonedEntry)}\n`);

      assert.equal(
        readCachedResolution({ key: poisonedKey, cacheDir: temporaryDirectory }),
        undefined,
      );
      assert.isFalse(NodeFS.existsSync(poisonedPath));
      assert.isTrue(NodeFS.existsSync(NodePath.join(temporaryDirectory, `${poisonedKey}.invalid`)));

      const miskeyedKey = "c".repeat(64);
      NodeFS.writeFileSync(
        NodePath.join(temporaryDirectory, `${miskeyedKey}.json`),
        `${JSON.stringify({ ...poisonedEntry, path: "notes.txt" })}\n`,
      );
      assert.equal(
        readCachedResolution({
          key: miskeyedKey,
          cacheDir: temporaryDirectory,
          expectedPath: "apps/web/src/Poisoned.tsx",
        }),
        undefined,
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(temporaryDirectory, `${miskeyedKey}.invalid`)));

      const rejectedKey = "b".repeat(64);
      assert.isFalse(
        writeCachedResolution({
          key: rejectedKey,
          cacheDir: temporaryDirectory,
          entry: {
            ...poisonedEntry,
            resolvedSource: "export function Component() { return <div />; }\n};\n",
          },
        }),
      );
      assert.isFalse(NodeFS.existsSync(NodePath.join(temporaryDirectory, `${rejectedKey}.json`)));

      assert.doesNotThrow(() =>
        assertValidResolvedSource({
          path: "apps/web/src/Valid.tsx",
          source: "export function Component() { return <div />; }\n",
        }),
      );
      assert.doesNotThrow(() =>
        assertValidResolvedSource({
          path: "apps/web/src/Decorated.ts",
          source: "class State { @tracked accessor value = 1; }\n",
        }),
      );
      assert.throws(
        () =>
          assertValidResolvedSource({
            path: "apps/web/src/Route.tsx",
            source: "export const route = true;\nreturn null;\n",
          }),
        /not syntactically valid TypeScript/u,
      );
      assert.throws(
        () =>
          assertValidResolvedSource({
            path: "apps/web/src/Settings.tsx",
            source: 'import { value } from "./value";\n} from "./value";\n',
          }),
        /not syntactically valid TypeScript/u,
      );
      assert.equal(
        quarantineCachedResolution({ key: "invalid", cacheDir: temporaryDirectory }),
        undefined,
      );
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("validates every partial TS checkpoint against both complete side candidates", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-partial-poison-"),
    );
    const partialSource = [
      "export function choose() {",
      "<<<<<<< OURS",
      '  return "fork";',
      "||||||| BASE",
      '  return "base";',
      "=======",
      '  return "parent";',
      ">>>>>>> THEIRS",
      "}",
      "",
    ].join("\n");
    const expectedForkSource = 'export function choose() {\n  return "fork";\n}\n';
    const expectedParentSource = 'export function choose() {\n  return "parent";\n}\n';
    try {
      assert.equal(
        materializeResolutionProgressForValidation({
          path: "apps/web/src/Partial.tsx",
          source: partialSource,
          forkSide: "ours",
        }),
        expectedForkSource,
      );
      assert.equal(
        materializeResolutionProgressForValidation({
          path: "apps/web/src/Partial.tsx",
          source: partialSource,
          forkSide: "theirs",
        }),
        expectedParentSource,
      );
      const twoWaySource = partialSource.replace('||||||| BASE\n  return "base";\n', "");
      assert.equal(
        materializeResolutionProgressForValidation({
          path: "apps/web/src/Partial.tsx",
          source: twoWaySource,
          forkSide: "ours",
        }),
        expectedForkSource,
      );
      assert.equal(
        materializeResolutionProgressForValidation({
          path: "apps/web/src/Partial.tsx",
          source: twoWaySource,
          forkSide: "theirs",
        }),
        expectedParentSource,
      );
      assert.doesNotThrow(() =>
        assertValidResolutionProgressSource({
          path: "apps/web/src/Partial.tsx",
          source: partialSource,
          forkSide: "ours",
        }),
      );
      assert.throws(
        () =>
          assertValidResolutionProgressSource({
            path: "apps/web/src/Partial.tsx",
            source: "export const broken = (\n",
          }),
        /not syntactically valid TypeScript/u,
      );

      const structurallyCoupledSource = [
        "export const preview =",
        "<<<<<<< OURS",
        "  expanded ? {",
        "||||||| BASE",
        "  collapsed;",
        "=======",
        "  collapsed;",
        ">>>>>>> THEIRS",
        "",
      ].join("\n");
      assert.throws(
        () =>
          assertValidResolvedSource({
            path: "apps/web/src/Partial.tsx",
            source: materializeResolutionProgressForValidation({
              path: "apps/web/src/Partial.tsx",
              source: structurallyCoupledSource,
              forkSide: "ours",
            }),
          }),
        /not syntactically valid TypeScript/u,
      );
      assert.doesNotThrow(() =>
        assertValidResolutionProgressSource({
          path: "apps/web/src/Partial.tsx",
          source: structurallyCoupledSource,
          forkSide: "ours",
        }),
      );
      const reverseStructurallyCoupledSource = [
        "export const preview =",
        "<<<<<<< OURS",
        "  collapsed;",
        "||||||| BASE",
        "  collapsed;",
        "=======",
        "  expanded ? {",
        ">>>>>>> THEIRS",
        "",
      ].join("\n");
      assert.throws(
        () =>
          assertValidResolvedSource({
            path: "apps/web/src/Partial.tsx",
            source: materializeResolutionProgressForValidation({
              path: "apps/web/src/Partial.tsx",
              source: reverseStructurallyCoupledSource,
              forkSide: "theirs",
            }),
          }),
        /not syntactically valid TypeScript/u,
      );
      assert.doesNotThrow(() =>
        assertValidResolutionProgressSource({
          path: "apps/web/src/Partial.tsx",
          source: reverseStructurallyCoupledSource,
          forkSide: "theirs",
        }),
      );

      const asymmetricKey = "c".repeat(64);
      const asymmetricEntry = {
        path: "apps/web/src/Partial.tsx",
        partialSource: structurallyCoupledSource,
        completedBatches: 1,
        forkChangesPreserved: [],
        upstreamChangesIntegrated: [],
        upstreamChangesOmitted: [],
      };
      assert.isTrue(
        writeCachedResolution({
          key: asymmetricKey,
          cacheDir: temporaryDirectory,
          entry: asymmetricEntry,
        }),
      );
      assert.equal(
        readCachedResolution({
          key: asymmetricKey,
          cacheDir: temporaryDirectory,
          expectedPath: asymmetricEntry.path,
        }).partialSource,
        structurallyCoupledSource,
      );
      assert.isFalse(
        NodeFS.existsSync(NodePath.join(temporaryDirectory, `${asymmetricKey}.invalid`)),
      );

      const provisionalDuplicate = [
        'const activeThreadShell = "upstream";',
        "<<<<<<< OURS",
        'const activeThreadShell = "fork";',
        "||||||| BASE",
        'const activeThreadShell = "base";',
        "=======",
        'const legacyThreadShell = "parent";',
        ">>>>>>> THEIRS",
        "",
      ].join("\n");
      assert.doesNotThrow(() =>
        assertValidResolutionProgressSource({
          path: "apps/web/src/Partial.tsx",
          source: provisionalDuplicate,
          forkSide: "ours",
        }),
      );
      assert.throws(
        () =>
          assertValidResolvedSource({
            path: "apps/web/src/Partial.tsx",
            source: materializeResolutionProgressForValidation({
              path: "apps/web/src/Partial.tsx",
              source: provisionalDuplicate,
              forkSide: "ours",
            }),
          }),
        /not syntactically valid TypeScript/u,
      );

      const resolvedDuplicate = provisionalDuplicate.replace(
        'const activeThreadShell = "upstream";',
        "const duplicate = 1;\nconst duplicate = 2;",
      );
      assert.throws(
        () =>
          assertValidResolutionProgressSource({
            path: "apps/web/src/Partial.tsx",
            source: resolvedDuplicate,
            forkSide: "theirs",
          }),
        /partial resolution has invalid resolved TypeScript/u,
      );

      for (const poisonedPrefix of ["export const broken = (", "export const broken = value."]) {
        assert.throws(
          () =>
            assertValidResolutionProgressSource({
              path: "apps/web/src/Partial.tsx",
              source: `${poisonedPrefix}\n${partialSource}`,
              forkSide: "ours",
            }),
          /partial resolution has invalid resolved TypeScript/u,
        );
      }

      const poisonedKey = "d".repeat(64);
      const poisonedEntry = {
        path: "apps/web/src/Partial.tsx",
        partialSource: partialSource.replace(
          "export function choose() {",
          "export function choose() {\n)",
        ),
        completedBatches: 22,
        forkChangesPreserved: [],
        upstreamChangesIntegrated: [],
        upstreamChangesOmitted: [],
      };
      NodeFS.writeFileSync(
        NodePath.join(temporaryDirectory, `${poisonedKey}.json`),
        `${JSON.stringify(poisonedEntry)}\n`,
      );
      assert.equal(
        readCachedResolution({ key: poisonedKey, cacheDir: temporaryDirectory }),
        undefined,
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(temporaryDirectory, `${poisonedKey}.invalid`)));

      const rejectedKey = "e".repeat(64);
      assert.isFalse(
        writeCachedResolution({
          key: rejectedKey,
          cacheDir: temporaryDirectory,
          entry: poisonedEntry,
        }),
      );
      assert.isFalse(NodeFS.existsSync(NodePath.join(temporaryDirectory, `${rejectedKey}.json`)));
      assert.throws(
        () =>
          assertValidResolutionProgressSource({
            path: "apps/web/src/Partial.tsx",
            source: poisonedEntry.partialSource,
            forkSide: "ours",
          }),
        /partial resolution has invalid resolved TypeScript/u,
      );

      assert.throws(
        () =>
          assertValidResolutionProgressSource({
            path: "apps/web/src/Partial.tsx",
            source: partialSource.replace("=======", "======"),
          }),
        /malformed partial conflict markers/u,
      );
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("regenerates a poisoned completed checkpoint instead of replaying it", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-poison-replay-"));
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    const conflictPath = "Poisoned.tsx";
    const source = (value) => `export const value = "${value}";\n`;
    let server;
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "sync@test");
      git("config", "user.name", "sync test");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("base"));
      git("add", conflictPath);
      git("commit", "-qm", "base");
      git("checkout", "-qb", "theirs");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("theirs"));
      git("commit", "-aqm", "parent changes");
      git("checkout", "-q", "main");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("ours"));
      git("commit", "-aqm", "fork changes");
      assert.throws(() => git("merge", "theirs"));
      git("checkout", "--conflict=diff3", "--", conflictPath);

      const conflictedSource = NodeFS.readFileSync(NodePath.join(directory, conflictPath), "utf8");
      const conflict = prepareConflictPrompt({
        path: conflictPath,
        conflictedSource,
        forkHistory: "",
        maxConflicts: 1,
      }).conflicts[0];
      const conflictText = conflictedSource.slice(conflict.start, conflict.end);
      const cacheDirectory = NodePath.join(directory, "cache");
      const cacheKey = resolutionCacheKey({ path: conflictPath, conflictedSource });
      NodeFS.mkdirSync(cacheDirectory);
      NodeFS.writeFileSync(
        NodePath.join(cacheDirectory, `${cacheKey}.json`),
        `${JSON.stringify({
          path: conflictPath,
          resolvedSource: "export const value = 1;\nexport const value = 2;\n",
          forkChangesPreserved: ["poison should not replay"],
          upstreamChangesIntegrated: [],
          upstreamChangesOmitted: [],
        })}\n`,
      );

      let requestCount = 0;
      const repairedSource =
        'export const forkValue = "ours";\nexport const upstreamValue = "theirs";\n';
      server = NodeHttp.createServer((request, response) => {
        request.resume();
        request.on("end", () => {
          requestCount += 1;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              status: "completed",
              output_text: JSON.stringify({
                safe: true,
                edits: [
                  {
                    old_text: conflictText,
                    new_text: repairedSource,
                    summary: "integrated both values",
                  },
                ],
                fork_changes_preserved: ["kept the fork value"],
                upstream_changes_integrated: ["integrated the parent value"],
                upstream_changes_omitted: [],
                summary: "repaired the poisoned resolution",
              }),
            }),
          );
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.isObject(address);

      const child = NodeChildProcess.spawn(process.execPath, [resolverPath], {
        cwd: directory,
        env: {
          ...process.env,
          CLI_PROXY_API_KEY: "test-key",
          CLI_PROXY_API_URL: `http://127.0.0.1:${address.port}`,
          PREVIOUS_UPSTREAM_TAG: "",
          REUSED_SYNC_RESOLUTION: "false",
          SYNC_RESOLUTION_CACHE_DIR: cacheDirectory,
          UPSTREAM_TAG: "v0.0.0-nightly.poison-test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitCode = await new Promise((resolve) => child.on("close", resolve));

      assert.equal(exitCode, 0, stderr);
      assert.include(stdout, "rejected and quarantined the invalid checkpointed resolution");
      assert.notInclude(stdout, "reused the checkpointed resolution");
      assert.equal(requestCount, 1);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(directory, conflictPath), "utf8"),
        repairedSource,
      );
      assert.equal(
        readCachedResolution({
          key: cacheKey,
          cacheDir: cacheDirectory,
          expectedPath: conflictPath,
        }).resolvedSource,
        repairedSource,
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(cacheDirectory, `${cacheKey}.invalid`)));
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("round-trips an in-progress file after every completed conflict batch", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-sync-partial-cache-"),
    );
    try {
      const conflictedSource = [
        "export const value =",
        "<<<<<<< ours",
        '  "x";',
        "||||||| base",
        '  "base";',
        "=======",
        '  "y";',
        ">>>>>>> theirs",
        "",
      ].join("\n");
      const key = resolutionCacheKey({
        path: "apps/mobile/src/features/threads/ThreadFeed.tsx",
        conflictedSource,
      });

      const partialEntry = {
        path: "apps/mobile/src/features/threads/ThreadFeed.tsx",
        partialSource: conflictedSource,
        completedBatches: 2,
        forkChangesPreserved: ["kept read-aloud behavior"],
        upstreamChangesIntegrated: ["integrated file-chip handling"],
        upstreamChangesOmitted: [],
      };
      assert.isTrue(
        writeCachedResolution({
          key,
          cacheDir: temporaryDirectory,
          entry: partialEntry,
        }),
      );
      assert.isFalse(
        writeCachedResolution({
          key: "invalid",
          cacheDir: temporaryDirectory,
          entry: partialEntry,
        }),
      );
      assert.throws(
        () =>
          writePartialResolutionCheckpoint({
            key: "invalid",
            cacheDir: temporaryDirectory,
            entry: partialEntry,
          }),
        /could not persist conflict batch 2/u,
      );

      const cached = readCachedResolution({ key, cacheDir: temporaryDirectory });
      assert.equal(cached.partialSource, conflictedSource);
      assert.equal(cached.completedBatches, 2);
      assert.deepEqual(cached.forkChangesPreserved, ["kept read-aloud behavior"]);

      assert.isFalse(
        writeCachedResolution({
          key,
          cacheDir: temporaryDirectory,
          entry: {
            ...cached,
            partialSource: "markers already gone\n",
          },
        }),
      );
      assert.equal(
        readCachedResolution({ key, cacheDir: temporaryDirectory }).partialSource,
        conflictedSource,
      );

      assert.isFalse(
        writeCachedResolution({
          key,
          cacheDir: temporaryDirectory,
          entry: {
            ...partialEntry,
            resolvedSource: "completed resolution\n",
            partialSource: "stale partial source\n",
          },
        }),
      );
      assert.equal(
        readCachedResolution({ key, cacheDir: temporaryDirectory }).partialSource,
        conflictedSource,
      );

      const resolver = NodeFS.readFileSync(resolverPath, "utf8");
      assert.include(resolver, "checkpointed conflict batch");
      assert.include(resolver, "resumed partial conflict resolution");
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("resumes the next model batch from a partial checkpoint", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-resume-"));
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    const conflictPath = "fixture.ts";
    const filler = Array.from(
      { length: 220 },
      (_, index) => `const filler${index} = ${index};`,
    ).join("\n");
    const source = (first, second) =>
      `const first = "${first}";\n${filler}\nconst second = "${second}";\n`;
    let server;
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "sync@test");
      git("config", "user.name", "sync test");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("base", "base"));
      git("add", conflictPath);
      git("commit", "-qm", "base");
      git("checkout", "-qb", "theirs");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("theirs", "theirs"));
      git("commit", "-aqm", "parent changes");
      git("checkout", "-q", "main");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("ours", "ours"));
      git("commit", "-aqm", "fork changes");
      assert.throws(() => git("merge", "theirs"));
      git("checkout", "--conflict=diff3", "--", conflictPath);

      const originalConflict = NodeFS.readFileSync(NodePath.join(directory, conflictPath), "utf8");
      const firstBatch = prepareConflictPrompt({
        path: conflictPath,
        conflictedSource: originalConflict,
        forkHistory: "",
        maxConflicts: 1,
      }).conflicts[0];
      const firstResolution = 'const first = "ours-and-theirs";\n';
      const partialSource =
        originalConflict.slice(0, firstBatch.start) +
        firstResolution +
        originalConflict.slice(firstBatch.end);
      const remainingBatch = prepareConflictPrompt({
        path: conflictPath,
        conflictedSource: partialSource,
        forkHistory: "",
        maxConflicts: 1,
      }).conflicts[0];
      const remainingConflict = partialSource.slice(remainingBatch.start, remainingBatch.end);
      const cacheDirectory = NodePath.join(directory, "cache");
      const cacheKey = resolutionCacheKey({
        path: conflictPath,
        conflictedSource: originalConflict,
      });
      writeCachedResolution({
        key: cacheKey,
        cacheDir: cacheDirectory,
        entry: {
          path: conflictPath,
          partialSource,
          completedBatches: MAX_BATCHES_PER_FILE,
          forkChangesPreserved: ["kept the first fork edit"],
          upstreamChangesIntegrated: ["integrated the first parent edit"],
          upstreamChangesOmitted: [],
        },
      });

      const requestBodies = [];
      server = NodeHttp.createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          requestBodies.push(JSON.parse(body));
          const poisonedAttempt = requestBodies.length === 1;
          const resolution = {
            safe: true,
            edits: [
              {
                old_text: remainingConflict,
                new_text: poisonedAttempt
                  ? 'const second = "ours-and-theirs";\n);\n'
                  : 'const second = "ours-and-theirs";\n',
                summary: "combined the remaining edit",
              },
            ],
            fork_changes_preserved: ["kept the second fork edit"],
            upstream_changes_integrated: ["integrated the second parent edit"],
            upstream_changes_omitted: [],
            summary: "resolved only the remaining conflict",
          };
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ status: "completed", output_text: JSON.stringify(resolution) }),
          );
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.isObject(address);

      const child = NodeChildProcess.spawn(process.execPath, [resolverPath], {
        cwd: directory,
        env: {
          ...process.env,
          CLI_PROXY_API_KEY: "test-key",
          CLI_PROXY_API_URL: `http://127.0.0.1:${address.port}`,
          PREVIOUS_UPSTREAM_TAG: "",
          REUSED_SYNC_RESOLUTION: "false",
          SYNC_RESOLUTION_CACHE_DIR: cacheDirectory,
          UPSTREAM_TAG: "v0.0.0-nightly.resume-test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitCode = await new Promise((resolve) => child.on("close", resolve));

      assert.equal(exitCode, 0, stderr);
      assert.include(
        stdout,
        `resumed partial conflict resolution for fixture.ts after ${MAX_BATCHES_PER_FILE}`,
      );
      assert.include(stdout, `resolved batch ${MAX_BATCHES_PER_FILE + 1} for fixture.ts`);
      assert.include(stdout, "returned an invalid edit set");
      assert.include(stdout, "requesting a fresh resolution");
      assert.lengthOf(requestBodies, 2);
      for (const requestBody of requestBodies) {
        assert.include(requestBody.input, 'const second = "ours";');
        assert.notInclude(requestBody.input, firstResolution.trim());
      }
      assert.equal(
        NodeFS.readFileSync(NodePath.join(directory, conflictPath), "utf8"),
        source("ours-and-theirs", "ours-and-theirs"),
      );
      const report = NodeFS.readFileSync(
        NodePath.join(directory, ".t3-fork/upstream-sync-report.md"),
        "utf8",
      );
      assert.include(report, "kept the first fork edit");
      assert.include(report, "integrated the first parent edit");
      assert.include(report, "kept the second fork edit");
      assert.include(report, "integrated the second parent edit");
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("defers a poisoned later batch without replacing its last valid checkpoint", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-sync-defer-poison-"));
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    const conflictPath = "fixture.ts";
    const filler = Array.from(
      { length: 220 },
      (_, index) => `const filler${index} = ${index};`,
    ).join("\n");
    const source = (first, second) =>
      `const first = "${first}";\n${filler}\nconst second = "${second}";\n`;
    let server;
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "sync@test");
      git("config", "user.name", "sync test");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("base", "base"));
      git("add", conflictPath);
      git("commit", "-qm", "base");
      git("checkout", "-qb", "theirs");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("theirs", "theirs"));
      git("commit", "-aqm", "parent changes");
      git("checkout", "-q", "main");
      NodeFS.writeFileSync(NodePath.join(directory, conflictPath), source("ours", "ours"));
      git("commit", "-aqm", "fork changes");
      assert.throws(() => git("merge", "theirs"));
      git("checkout", "--conflict=diff3", "--", conflictPath);

      const originalConflict = NodeFS.readFileSync(NodePath.join(directory, conflictPath), "utf8");
      const firstBatch = prepareConflictPrompt({
        path: conflictPath,
        conflictedSource: originalConflict,
        forkHistory: "",
        maxConflicts: 1,
      }).conflicts[0];
      const firstResolution = 'const first = "ours-and-theirs";\n';
      const partialSource =
        originalConflict.slice(0, firstBatch.start) +
        firstResolution +
        originalConflict.slice(firstBatch.end);
      const remainingBatch = prepareConflictPrompt({
        path: conflictPath,
        conflictedSource: partialSource,
        forkHistory: "",
        maxConflicts: 1,
      }).conflicts[0];
      const remainingConflict = partialSource.slice(remainingBatch.start, remainingBatch.end);
      const cacheDirectory = NodePath.join(directory, "cache");
      const cacheKey = resolutionCacheKey({
        path: conflictPath,
        conflictedSource: originalConflict,
      });
      assert.isTrue(
        writeCachedResolution({
          key: cacheKey,
          cacheDir: cacheDirectory,
          entry: {
            path: conflictPath,
            partialSource,
            completedBatches: 1,
            forkChangesPreserved: ["kept the first fork edit"],
            upstreamChangesIntegrated: ["integrated the first parent edit"],
            upstreamChangesOmitted: [],
          },
        }),
      );
      const cachePath = NodePath.join(cacheDirectory, `${cacheKey}.json`);
      const lastValidCheckpoint = NodeFS.readFileSync(cachePath, "utf8");

      const requestBodies = [];
      server = NodeHttp.createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          requestBodies.push(JSON.parse(body));
          const resolution = {
            safe: true,
            edits: [
              {
                old_text: remainingConflict,
                new_text: 'const second = "ours-and-theirs";\n);\n',
                summary: "introduced a stray token",
              },
            ],
            fork_changes_preserved: ["kept the second fork edit"],
            upstream_changes_integrated: ["integrated the second parent edit"],
            upstream_changes_omitted: [],
            summary: "poisoned the remaining conflict",
          };
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ status: "completed", output_text: JSON.stringify(resolution) }),
          );
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.isObject(address);

      const child = NodeChildProcess.spawn(process.execPath, [resolverPath], {
        cwd: directory,
        env: {
          ...process.env,
          CLI_PROXY_API_KEY: "test-key",
          CLI_PROXY_API_URL: `http://127.0.0.1:${address.port}`,
          PREVIOUS_UPSTREAM_TAG: "",
          REUSED_SYNC_RESOLUTION: "false",
          SYNC_RESOLUTION_CACHE_DIR: cacheDirectory,
          UPSTREAM_TAG: "v0.0.0-nightly.defer-test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitCode = await new Promise((resolve) => child.on("close", resolve));

      assert.equal(exitCode, 75, stderr);
      assert.lengthOf(requestBodies, MAX_VALIDATION_ATTEMPTS);
      assert.include(stderr, "keeping the last valid checkpoint");
      assert.notInclude(stdout, "fork-side fallback for fixture.ts");
      assert.equal(NodeFS.readFileSync(cachePath, "utf8"), lastValidCheckpoint);
      assert.isFalse(NodeFS.existsSync(NodePath.join(cacheDirectory, `${cacheKey}.invalid`)));
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it("checkpoints completed resolutions to a durable branch even when a sync fails", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");

    assert.include(script, "RESOLUTION_CACHE_BRANCH:-automation/sync-resolution-cache");
    assert.include(script, "trap on_exit EXIT");
    assert.include(
      script,
      'git archive "origin/$RESOLUTION_CACHE_BRANCH" | tar -x -C "$restore_cache"',
    );
    assert.include(script, 'mv "$SYNC_RESOLUTION_CACHE_DIR" "$backup_cache"');
    assert.include(script, 'mv "$candidate" "$SYNC_RESOLUTION_CACHE_DIR"');
    assert.include(script, 'mv "$backup_cache" "$SYNC_RESOLUTION_CACHE_DIR"');
    assert.include(script, '> "$restore_cache/active-upstream-tag"');
    assert.include(script, "git commit-tree");

    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, "reused the checkpointed resolution");
    assert.include(resolver, "SYNC_RESOLUTION_CACHE_DIR");
  });

  it("installs parser dependencies before resolving and gates the complete web tree", () => {
    const script = NodeFS.readFileSync(syncScriptPath, "utf8");
    const earlyInstall = script.indexOf(
      "The sync resolver could not install its validation dependencies",
    );
    const firstMerge = script.indexOf('merge_ref origin/main "chore(sync): merge origin/main');
    const validationStart = script.indexOf("validate_sync_tree() {");
    const webTypecheck = script.indexOf("vp run --filter @t3tools/web typecheck", validationStart);
    const webLint = script.indexOf("vp lint apps/web/src", validationStart);
    const webBuild = script.indexOf("vp run --filter @t3tools/web build", validationStart);

    assert.isAtLeast(earlyInstall, 0);
    assert.isBelow(earlyInstall, firstMerge);
    assert.isAbove(webTypecheck, validationStart);
    assert.isAbove(webLint, webTypecheck);
    assert.isAbove(webBuild, webLint);
    assert.include(script, "failed the web lint error gate");
  });

  it("requests a fresh resolution when a batch's edit set fails validation", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // A non-unique or missing old_text is a sampling defect, not a hard
    // failure: bounded fresh requests usually validate (seen on nightly 1093).
    assert.include(resolver, "returned an invalid edit set");
    assert.include(resolver, "requesting a fresh resolution");
    assert.include(resolver, "assertValidResolutionProgressSource({ path, source: nextSource })");
    assert.include(resolver, "keeping the last valid checkpoint");
    assert.include(resolver, "throw deferredSyncError(");
    assert.equal(MAX_VALIDATION_ATTEMPTS, 3);

    const retryPrompt = buildValidationRetryPrompt(
      "original prompt",
      new Error("old_text matching 2 locations"),
    );
    assert.include(retryPrompt, "The previous response failed validation");
    assert.include(retryPrompt, "old_text matching 2 locations");
    assert.include(retryPrompt, "Discard the previous edits");
    assert.include(retryPrompt, "only from the current conflict context");
    assert.include(retryPrompt, "Copy every old_text byte-for-byte");
    assert.include(retryPrompt, "include enough unchanged surrounding lines");
    assert.equal(buildValidationRetryPrompt("original prompt", undefined), "original prompt");
  });

  it("keeps every conflict context byte-exact against the working file", () => {
    // An earlier version joined the before-context and the conflict block
    // with an extra "\n"; old_text copied across that junction could never
    // match the file and failed the run deterministically.
    const unit = `${"<".repeat(7)} ours
value a
${"|".repeat(7)} base
value b
${"=".repeat(7)}
value c
${">".repeat(7)} theirs
${Array.from({ length: 30 }, (_, index) => `filler ${index}`).join("\n")}
`;
    const conflictedSource = unit.repeat(6);

    const { conflicts } = prepareConflictPrompt({
      path: "exact.ts",
      conflictedSource,
      forkHistory: "",
      maxConflicts: 3,
    });

    assert.lengthOf(conflicts, 3);
    for (const conflict of conflicts) {
      assert.isTrue(
        conflictedSource.includes(conflict.context),
        `conflict ${conflict.index} context is not a byte-exact slice of the file`,
      );
    }
  });

  it("resolves binary asset conflicts deterministically instead of asking the model", () => {
    const temporaryDirectory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-pretty-binary-"),
    );
    try {
      const binaryPath = NodePath.join(temporaryDirectory, "icon.png");
      const binaryContent = Buffer.alloc(2048);
      binaryContent.write("PNG");
      NodeFS.writeFileSync(binaryPath, binaryContent);
      assert.isTrue(isBinaryAssetConflict(binaryPath));

      const textPath = NodePath.join(temporaryDirectory, "component.tsx");
      NodeFS.writeFileSync(textPath, "export const value = 'hello';\n");
      assert.isFalse(isBinaryAssetConflict(textPath));

      const textWithNulPath = NodePath.join(temporaryDirectory, "dedup.tsx");
      NodeFS.writeFileSync(
        textWithNulPath,
        `const key = \`mime\0size\0name\`;\n${"// padding\n".repeat(400)}`,
      );
      assert.isFalse(isBinaryAssetConflict(textWithNulPath));

      assert.isFalse(isBinaryAssetConflict(NodePath.join(temporaryDirectory, "missing.tsx")));
    } finally {
      NodeFS.rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    // The fork's branded assets are authoritative: keep ours, record the
    // omission in the sync report, never spend a model call.
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, 'git(["checkout", "--ours", "--", path])');
    assert.include(resolver, "binary conflicts are never model input");
  });

  it("disambiguates a repeated old_text by conflict proximity", () => {
    const conflictBlock = `${"<".repeat(7)} ours
shared token
${"|".repeat(7)} base
base
${"=".repeat(7)}
theirs
${">".repeat(7)} theirs
`;
    const conflicts = [{ index: 0, start: 0, end: conflictBlock.length }];
    const edit = { old_text: "shared token\n", new_text: "resolved token\n", summary: "s" };

    // One occurrence inside the conflict, a duplicate 25 KB away: the
    // conflict-side occurrence wins and the far one stays untouched.
    const nearSource = `${conflictBlock}${"y".repeat(25_000)}shared token\n`;
    const resolved = applyResolutionEdits({
      path: "f.ts",
      source: nearSource,
      conflicts,
      resolution: { edits: [edit] },
    });
    assert.include(resolved, "resolved token");
    assert.isTrue(resolved.endsWith("shared token\n"));

    // Several occurrences next to the conflict: still ambiguous, still fatal.
    assert.throws(
      () =>
        applyResolutionEdits({
          path: "f.ts",
          source: `shared token\n${conflictBlock}shared token\n`,
          conflicts,
          resolution: { edits: [edit] },
        }),
      /\d+ locations near this batch's conflicts/u,
    );

    // Only far-away occurrences: nothing to anchor to. Use a block that does
    // not itself contain the token.
    const otherBlock = `${"<".repeat(7)} ours
aaa
${"|".repeat(7)} base
bbb
${"=".repeat(7)}
ccc
${">".repeat(7)} theirs
`;
    assert.throws(
      () =>
        applyResolutionEdits({
          path: "f.ts",
          source: `${otherBlock}${"y".repeat(25_000)}shared token\n${"z".repeat(25_000)}shared token\n`,
          conflicts: [{ index: 0, start: 0, end: otherBlock.length }],
          resolution: { edits: [edit] },
        }),
      /no location near this batch's conflicts/u,
    );

    assert.throws(
      () =>
        applyResolutionEdits({
          path: "f.ts",
          source: conflictBlock,
          conflicts,
          resolution: { edits: [{ ...edit, old_text: "absent\n" }] },
        }),
      /does not appear in the working file/u,
    );
  });

  it("ignores surplus no-op edits without weakening conflict coverage", () => {
    const conflictBlock = `${"<".repeat(7)} ours
ours
${"|".repeat(7)} base
base
${"=".repeat(7)}
theirs
${">".repeat(7)} theirs
`;
    const conflicts = [{ index: 0, start: 0, end: conflictBlock.length }];
    const resolved = applyResolutionEdits({
      path: "f.ts",
      source: conflictBlock,
      conflicts,
      resolution: {
        edits: [
          { old_text: "", new_text: "unused", summary: "empty" },
          { old_text: "ours", new_text: "ours", summary: "no-op" },
          { old_text: conflictBlock, new_text: "resolved\n", summary: "resolution" },
        ],
      },
    });
    assert.equal(resolved, "resolved\n");

    assert.throws(
      () =>
        applyResolutionEdits({
          path: "f.ts",
          source: conflictBlock,
          conflicts,
          resolution: {
            edits: [{ old_text: "ours", new_text: "ours", summary: "no-op" }],
          },
        }),
      /no edit for conflict 0/u,
    );
  });
});
