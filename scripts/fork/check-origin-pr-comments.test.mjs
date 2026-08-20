import { assert, describe, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  checkOriginPrComments,
  formatUnresolvedReport,
  hasFixedReply,
  isFixedReply,
  unresolvedActionableFindings,
} from "./check-origin-pr-comments.mjs";
import { formatIssueBody, isActionableGrokFinding } from "./review-origin-pr.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const findingBody = formatIssueBody({
  sha: "abc",
  issue: {
    severity: "bug",
    path: "scripts/fork/a.mjs",
    line: 4,
    title: "Missing tag fetch",
    body: "Fetch Origin tags.",
  },
});

describe("Origin review comment resolution check", () => {
  it("treats Grok finding threads as resolved only when Origin marks them resolved", () => {
    assert.equal(isActionableGrokFinding(findingBody), true);
    assert.equal(isActionableGrokFinding("## Grok 4.6 review\n\nLooks fine."), false);
    assert.equal(
      isActionableGrokFinding(`${findingBody.replace("### bug", "## Grok 4.6 review\n\n### bug")}`),
      false,
    );
    assert.equal(isFixedReply("Fixed in the next commit."), true);

    const openThread = {
      id: "cth_open",
      resolved: false,
      comments: [{ id: "c1", body: findingBody }],
    };
    const closedThread = { ...openThread, id: "cth_closed", resolved: true };
    assert.equal(unresolvedActionableFindings({ threads: [openThread] }).length, 1);
    assert.equal(unresolvedActionableFindings({ threads: [closedThread] }).length, 0);
  });

  it("accepts a fixed reply for review-style findings that have no thread", () => {
    const review = { id: "rev_1", body: findingBody };
    assert.equal(unresolvedActionableFindings({ reviews: [review] }).length, 1);
    assert.equal(
      hasFixedReply(
        { id: "rev_1", title: "Missing tag fetch" },
        { comments: [{ id: "c2", body: "Fixed Missing tag fetch in c3." }] },
      ),
      true,
    );
    assert.equal(
      unresolvedActionableFindings({
        reviews: [review],
        comments: [{ id: "c2", body: "Fixed Missing tag fetch in c3." }],
      }).length,
      0,
    );
  });

  it("tells the reader how to resolve an open thread", () => {
    const report = formatUnresolvedReport([
      { kind: "thread", id: "cth_1", title: "Missing tag fetch" },
    ]);
    assert.include(report, "origin pr thread resolve cth_1");
    assert.include(report, "Missing tag fetch");
  });

  it("skips a branch build when no pull request was opened", () => {
    const result = checkOriginPrComments({
      env: { BUILDKITE_BRANCH: "t3code/no-pr" },
      listThreadsForTarget: () => {
        throw new Error('No open or draft change found for branch "t3code/no-pr"');
      },
    });
    assert.match(result.skipped, /No Origin pull request/);
  });
});

describe("Origin comment-resolution job wiring", () => {
  it("runs the resolve check on macos-release after review", () => {
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );
    const ci = NodeFS.readFileSync(NodePath.resolve(here, "review-origin-pr-ci.sh"), "utf8");
    assert.include(pipeline, "run-trusted-origin-pr-ci.sh check");
    assert.include(pipeline, "Origin PR comments resolved");
    assert.notInclude(pipeline, "build.pull_request");
    assert.include(ci, "check-origin-pr-comments.mjs");
    assert.match(ci, /if \[\[ "\$mode" != "check" \]\]; then\s+trap report_failure ERR\s+fi/u);
  });
});
