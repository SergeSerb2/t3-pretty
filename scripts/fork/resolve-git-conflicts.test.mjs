import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  buildConflictPrompt,
  formatSyncReport,
  readReusedSyncReport,
} from "./resolve-git-conflicts.mjs";

const syncWorkflowPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../.github/workflows/fork-upstream-sync.yml",
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
    assert.include(prompt, "Integrate every compatible parent improvement");
    assert.include(prompt, "omit only the smallest conflicting portion");
    assert.include(prompt, "An omission must never be silent");
    assert.include(prompt, "feat(pretty): add the compact sidebar");
    assert.include(prompt, "upstream_changes_omitted");
  });

  it("fetches the previous nightly tag used for fork-history context", () => {
    const workflow = NodeFS.readFileSync(syncWorkflowPath, "utf8");

    assert.include(workflow, '[[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]');
    assert.include(workflow, '"refs/tags/$current_tag:refs/tags/$current_tag"');
    assert.include(workflow, "PREVIOUS_UPSTREAM_TAG: ${{ steps.discover.outputs.previous_tag }}");
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
