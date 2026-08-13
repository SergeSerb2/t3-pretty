import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  buildConflictPrompt,
  formatSyncReport,
  prepareConflictPrompt,
  readReusedSyncReport,
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

  it("stops extracting repeated conflict contexts when they exhaust the prompt budget", () => {
    const nearbyConflict = `${"<".repeat(7)} ours
${"a".repeat(40_000)}
${"|".repeat(7)} base
${"=".repeat(7)}
theirs
${">".repeat(7)} theirs
`;
    const conflictedSource = nearbyConflict.repeat(20);

    assert.throws(
      () =>
        prepareConflictPrompt({
          path: "generated-lockfile.yaml",
          conflictedSource,
          forkHistory: "",
        }),
      /exceeds the 600000-byte conflict prompt limit/u,
    );
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

  it("releases synced mobile changes without releasing server-only integrations", () => {
    const syncWorkflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");
    const mobileWorkflow = NodeFS.readFileSync(mobileWorkflowPath, "utf8");

    assert.include(syncWorkflow, "git diff --quiet origin/main...HEAD");
    assert.include(syncWorkflow, "mobile_release_needed=true");
    assert.include(syncWorkflow, "gh workflow run fork-mobile-release.yml");
    assert.include(syncWorkflow, "-f mode=release");
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
    assert.notInclude(mobileWorkflow, "ubuntu-latest");
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

  it("checks upstream every four hours and supports an explicit retry", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, "workflow_dispatch:");
    assert.include(workflow, '- cron: "0 */4 * * *"');
    assert.include(workflow, "Six checks per day");
  });

  it("accepts a clustered nightly that exceeds a dozen conflicted files", () => {
    const resolver = NodeFS.readFileSync(resolverPath, "utf8");
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(resolver, "const MAX_CONFLICTS = 24");
    assert.include(workflow, "timeout-minutes: 45");
  });

  it("does not reject untouched upstream patch payload whitespace", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, "mapfile -d '' -t resolver_paths");
    assert.include(workflow, 'git diff --check --cached -- \\\n            "${resolver_paths[@]}"');
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
});
