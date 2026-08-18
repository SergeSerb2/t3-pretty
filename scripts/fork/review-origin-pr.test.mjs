import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  DEFAULT_MODEL,
  alreadyReviewed,
  formatReviewBody,
  parseReviewResponse,
  resolveExplicitPr,
  reviewMarker,
  shouldSkipBranch,
  truncateDiff,
} from "./review-origin-pr.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

describe("Origin Grok PR review", () => {
  it("skips main and automation branches unless forced", () => {
    assert.match(shouldSkipBranch(""), /No Origin pull request/);
    assert.match(shouldSkipBranch("main"), /main/);
    assert.match(shouldSkipBranch("automation/upstream-v1"), /automation/);
    assert.equal(shouldSkipBranch("t3code/fix-foo"), "");
  });

  it("reads an explicit PR number from Origin or Buildkite env", () => {
    assert.equal(resolveExplicitPr({ argvPr: "#44" }), "44");
    assert.equal(resolveExplicitPr({ env: { BUILDKITE_PULL_REQUEST: "false" } }), "");
    assert.equal(resolveExplicitPr({ env: { ORIGIN_PR: "12" } }), "12");
  });

  it("parses Grok JSON even when wrapped in a fence", () => {
    const parsed = parseReviewResponse(`
here you go
\`\`\`json
{"summary":"Looks safe.","issues":[{"severity":"bug","path":"scripts/fork/a.mjs","line":9,"title":"Missing tag fetch","body":"Fetch Origin tags."}]}
\`\`\`
`);
    assert.equal(parsed.summary, "Looks safe.");
    assert.equal(parsed.issues.length, 1);
    assert.equal(parsed.issues[0].severity, "bug");
    assert.equal(parsed.issues[0].path, "scripts/fork/a.mjs");
    assert.equal(parsed.issues[0].line, 9);
  });

  it("truncates large diffs and recognizes a prior review marker", () => {
    const { diff, truncated } = truncateDiff("abcd", 3);
    assert.equal(truncated, true);
    assert.match(diff, /truncated/);
    const sha = "abc123";
    assert.equal(alreadyReviewed([{ body: `hello\n${reviewMarker(sha)}\n` }], sha), true);
    assert.equal(alreadyReviewed([{ body: "other" }], sha), false);
  });

  it("formats a review that Origin CLI can post as a comment", () => {
    const body = formatReviewBody({
      sha: "deadbeef",
      model: DEFAULT_MODEL,
      summary: "Versioning can go backwards.",
      issues: [
        {
          severity: "bug",
          path: "scripts/fork/resolve-fork-release.mjs",
          line: 63,
          title: "Non-monotonic versions",
          body: "Bump past the highest fork tag.",
        },
      ],
      truncated: false,
      url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/44",
    });
    assert.include(body, reviewMarker("deadbeef"));
    assert.include(body, "Grok 4.6 review");
    assert.include(body, "1 bug(s)");
    assert.include(body, "scripts/fork/resolve-fork-release.mjs:63");
    assert.include(body, "not a merge approval");
  });
});

describe("Origin Grok review workflow wiring", () => {
  it("runs on Origin PRs from hosted Linux with Grok 4.6", () => {
    const workflow = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.github/workflows/fork-pr-review.yml"),
      "utf8",
    );
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );

    assert.notInclude(workflow, "pull_request:");
    assert.include(workflow, "branches-ignore:");
    assert.include(workflow, "runs-on: ubuntu-latest");
    assert.include(workflow, "review-origin-pr.mjs");
    assert.include(workflow, "grok-4.6");
    assert.include(workflow, "load-buildkite-secrets.sh");
    assert.include(workflow, "origin-forge.mjs setup-ci");
    assert.notInclude(workflow, "secrets.CURSOR_API_KEY");
    assert.notInclude(workflow, "secrets.XAI_API_KEY");
    assert.notInclude(workflow, "gh api");
    assert.notInclude(workflow, "gh pr");
    assert.notInclude(workflow, "macos-latest");
    assert.include(pipeline, "fork-pr-review.yml");
  });
});
