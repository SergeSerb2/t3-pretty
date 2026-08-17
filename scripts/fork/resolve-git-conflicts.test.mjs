import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  applyResolutionEdits,
  buildConflictPrompt,
  formatSyncReport,
  isBinaryAssetConflict,
  isGeneratedLockfile,
  prepareConflictPrompt,
  readCachedResolution,
  readReusedSyncReport,
  resolutionCacheKey,
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
const mobileWorkflowPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../.github/workflows/fork-mobile-release.yml",
);

describe("T3 Pretty upstream conflict resolver", () => {
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
    assert.include(resolver, 'git(["ls-files", "-u", "--", path])');
    assert.include(resolver, "parentDeletionEvidence");
  });

  it("resolves every resolvable file before reporting the ones that failed", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // A declined or repeatedly invalid file must not stop the run: later
    // files still resolve and checkpoint, so the next run only faces the
    // paths that failed this one.
    assert.include(resolver, "leaving ${path} unresolved this run");
    assert.include(resolver, "could not be resolved this run");
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
    const syncWorkflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");
    const mobileWorkflow = NodeFS.readFileSync(mobileWorkflowPath, "utf8");

    assert.include(syncWorkflow, "git diff --quiet origin/main...HEAD");
    assert.include(syncWorkflow, "mobile_release_needed=true");
    assert.include(syncWorkflow, "origin-forge.mjs dispatch");
    assert.include(syncWorkflow, "--workflow fork-mobile-release.yml");
    assert.include(syncWorkflow, "--input mode=release");
    assert.include(mobileWorkflow, "paths:");
    assert.include(mobileWorkflow, "- apps/mobile/**");
    assert.include(mobileWorkflow, "env.MODE == 'build' || env.MODE == 'release'");
    assert.include(mobileWorkflow, "env.MODE == 'update' || env.MODE == 'release'");
    assert.include(mobileWorkflow, "EXPO_ASC_API_KEY_PATH");
    assert.include(mobileWorkflow, "ascApiKeyIssuerId");
    assert.include(mobileWorkflow, "Publish OTA update");
    assert.include(mobileWorkflow, "self-hosted");
    assert.include(mobileWorkflow, "macOS");
    assert.include(mobileWorkflow, "t3code-fork");
    assert.include(mobileWorkflow, "--local");
    assert.include(mobileWorkflow, "Xcode-beta.app");
    assert.include(mobileWorkflow, "xcode-select -s");
    assert.include(mobileWorkflow, "security-eas-local-keychain");
    assert.include(mobileWorkflow, "eas submit");
    assert.include(mobileWorkflow, "eas build:list");
    assert.notInclude(mobileWorkflow, "--status finished");
    assert.include(mobileWorkflow, "ubuntu-latest");
    assert.include(mobileWorkflow, "name: Publish OTA");
    assert.include(mobileWorkflow, "name: Build and submit iOS");
    assert.notInclude(mobileWorkflow, "--no-wait");
    assert.isBelow(
      mobileWorkflow.indexOf("- name: Publish OTA update"),
      mobileWorkflow.indexOf("- name: Build and submit"),
    );
  });

  it("fetches the previous nightly tag used for fork-history context", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, '[[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]');
    assert.include(workflow, '"refs/tags/$current_tag:refs/tags/$current_tag"');
    assert.include(workflow, "PREVIOUS_UPSTREAM_TAG: ${{ steps.discover.outputs.previous_tag }}");
  });

  it("backfills upstream-only objects from the upstream promisor, not the fork", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    // The sparse checkout is a blob:none partial clone; blobs a nightly adds
    // under .repos/ exist only upstream, and the fork promisor answers
    // "not our ref" for them, killing the merge before it starts.
    assert.include(workflow, "git config remote.upstream.promisor true");
    assert.include(workflow, "git config remote.upstream.partialclonefilter blob:none");
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

    // No fixed conflict ceiling: a hard refusal strands the fork while the
    // next nightly piles more conflicts onto the same unintegrated merge.
    // Batched model requests plus a generous job timeout bound the run.
    assert.notInclude(resolver, "Refusing to resolve");
    assert.include(resolver, "const MAX_CONFLICTS_PER_REQUEST = 5");
    assert.include(resolver, "const MAX_BATCHES_PER_FILE = 32");
    assert.include(workflow, "timeout-minutes: 120");
  });

  it("does not gate the merge on model- or upstream-authored whitespace", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    // Only the workflow's own metadata file is whitespace-checked. Resolver
    // output is model-composed content; a blank line at EOF must not fail an
    // otherwise complete merge after all conflicts resolved.
    assert.include(workflow, "mapfile -d '' -t resolver_paths");
    assert.include(workflow, "git diff --check --cached -- .t3-fork/upstream-nightly");
    assert.notInclude(workflow, '"${resolver_paths[@]}" \\');
    assert.notInclude(workflow, "          git diff --check --cached\n");
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

      const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");
      assert.include(workflow, 'git show "origin/$SYNC_BRANCH:.t3-fork/upstream-sync-report.md"');
      assert.include(workflow, '== "# T3 Pretty upstream integration report"');
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

    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");
    assert.include(workflow, 'grep -qx "pnpm-lock.yaml"');
    assert.include(workflow, "corepack pnpm install --lockfile-only --no-frozen-lockfile");
    assert.include(workflow, "git add pnpm-lock.yaml");
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

    assert.include(report, "generated lockfiles resolved deterministically");
    assert.notInclude(report, "`gpt-5.6-sol` with `xhigh` reasoning");
    assert.include(report, "AI-splicing");
    assert.include(report, "fork-only dependency entries");
  });

  it("retries transient resolver failures instead of aborting the whole sync", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // Network errors, 429, 5xx, and unparseable/incomplete responses retry;
    // the last attempt drops to high effort so one long-think cannot 502.
    assert.include(resolver, "const maxAttempts = 3");
    assert.include(resolver, 'attempt < maxAttempts ? REASONING_EFFORT : "high"');
    assert.include(resolver, "status !== 0 && status !== 429 && status < 500");
    assert.include(resolver, "setTimeout(resolve, attempt * 15_000)");
    assert.include(resolver, "did not produce a completed response");
    // Non-transient HTTP failures (auth, bad request) still throw immediately.
    assert.include(resolver, "CLIProxyAPI returned HTTP ${status}");
  });

  it("records the iOS production fingerprint without tripping the format hook", () => {
    const mobileWorkflow = NodeFS.readFileSync(mobileWorkflowPath, "utf8");

    // The staged fingerprint record is extensionless, so `vp fmt` in the
    // pre-commit hook has no target file and fails the whole release.
    assert.include(
      mobileWorkflow,
      'git commit --no-verify -m "chore(mobile): record iOS production fingerprint"',
    );
  });

  it("lands the iOS fingerprint record through a pull request instead of pushing to main", () => {
    const mobileWorkflow = NodeFS.readFileSync(mobileWorkflowPath, "utf8");

    // main enforces pull requests, so the bot commit rides a short-lived
    // automation branch merged through the Origin CLI, the same pattern the
    // upstream sync uses.
    assert.include(mobileWorkflow, "pull-requests: write");
    assert.include(mobileWorkflow, "automation/ios-fingerprint-");
    assert.include(mobileWorkflow, 'git push --force origin "HEAD:refs/heads/$branch"');
    assert.include(mobileWorkflow, "origin-forge.mjs ensure-pr");
    assert.include(mobileWorkflow, "origin-forge.mjs merge-pr");
    assert.notInclude(mobileWorkflow, 'git push origin "HEAD:${GITHUB_REF_NAME}"');
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

  it("checkpoints completed resolutions to a durable branch even when a sync fails", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, "RESOLUTION_CACHE_BRANCH: automation/sync-resolution-cache");
    assert.include(workflow, "if: always() && steps.discover.outputs.has_update == 'true'");
    assert.include(
      workflow,
      'git archive "origin/$RESOLUTION_CACHE_BRANCH" | tar -x -C "$SYNC_RESOLUTION_CACHE_DIR"',
    );
    assert.include(workflow, "git commit-tree");

    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    assert.include(resolver, "reused the checkpointed resolution");
    assert.include(resolver, "SYNC_RESOLUTION_CACHE_DIR");
  });

  it("requests a fresh resolution when a batch's edit set fails validation", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");

    // A non-unique or missing old_text is a sampling defect, not a hard
    // failure: one fresh request usually validates (seen on nightly 1093).
    assert.include(resolver, "returned an invalid edit set");
    assert.include(resolver, "requesting a fresh resolution");
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
});
