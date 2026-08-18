import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  DEFAULT_CLI_PROXY_API_URL,
  DEFAULT_MODEL,
  alreadyReviewed,
  cliProxyApiKey,
  cliProxyApiUrl,
  formatIssueBody,
  formatReviewBody,
  parseReviewResponse,
  prNumberFromEvent,
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

  it("uses Railway CLIProxyAPI instead of the xAI API", () => {
    assert.include(DEFAULT_CLI_PROXY_API_URL, "railway.app");
    assert.notInclude(DEFAULT_CLI_PROXY_API_URL, "api.x.ai");
    const previousKey = process.env.CLI_PROXY_API_KEY;
    const previousUrl = process.env.CLI_PROXY_API_URL;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
    process.env.CLI_PROXY_API_KEY = "clip_test";
    delete process.env.CLI_PROXY_API_URL;
    try {
      assert.equal(cliProxyApiKey(), "clip_test");
      assert.equal(cliProxyApiUrl(), DEFAULT_CLI_PROXY_API_URL);
    } finally {
      if (previousKey === undefined) delete process.env.CLI_PROXY_API_KEY;
      else process.env.CLI_PROXY_API_KEY = previousKey;
      if (previousUrl === undefined) delete process.env.CLI_PROXY_API_URL;
      else process.env.CLI_PROXY_API_URL = previousUrl;
    }
  });

  it("reads an explicit PR number from Origin, Buildkite, or the Actions event file", () => {
    assert.equal(resolveExplicitPr({ argvPr: "#44" }), "44");
    assert.equal(resolveExplicitPr({ env: { BUILDKITE_PULL_REQUEST: "false" } }), "");
    assert.equal(resolveExplicitPr({ env: { ORIGIN_PR: "12" } }), "12");
    assert.equal(prNumberFromEvent({ inputs: { pr: "47" } }), "47");
    assert.equal(prNumberFromEvent({ pull_request: { number: 47 } }), "47");
    assert.equal(
      resolveExplicitPr({
        env: { BUILDKITE_PULL_REQUEST: "false" },
        event: { inputs: { pr: "#47" } },
      }),
      "47",
    );
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

  it("formats one Origin review per finding plus a short summary", () => {
    const issue = {
      severity: "bug",
      path: "scripts/fork/resolve-fork-release.mjs",
      line: 63,
      title: "Non-monotonic versions",
      body: "Bump past the highest fork tag.",
    };
    const finding = formatIssueBody({ sha: "deadbeef", issue });
    assert.include(finding, reviewMarker("deadbeef"));
    assert.include(finding, "### bug — Non-monotonic versions");
    assert.include(finding, "scripts/fork/resolve-fork-release.mjs:63");
    assert.include(finding, "Bump past the highest fork tag.");

    const body = formatReviewBody({
      sha: "deadbeef",
      model: DEFAULT_MODEL,
      summary: "Versioning can go backwards.",
      issues: [issue],
      truncated: false,
      url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/44",
    });
    assert.include(body, reviewMarker("deadbeef"));
    assert.include(body, "Grok 4.6 review");
    assert.include(body, "1 bug(s)");
    assert.include(body, "separate review comment");
    assert.notInclude(body, "### bug — Non-monotonic versions");
    assert.include(body, "not a merge approval");
  });
});

describe("Origin Grok review workflow wiring", () => {
  it("runs Origin PR review from macos-release with Grok 4.6", () => {
    const reviewCi = NodeFS.readFileSync(NodePath.resolve(here, "review-origin-pr-ci.sh"), "utf8");
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
      "utf8",
    );

    assert.notInclude(pipeline, "- .github/workflows/fork-pr-review.yml");
    assert.include(pipeline, "review-origin-pr-ci.sh");
    const reviewStep = pipeline.slice(pipeline.indexOf(":mag: Origin PR Review"));
    assert.include(reviewStep.slice(0, 500), "queue: macos-release");
    assert.include(reviewStep, "build.branch =~ /^t3code\\//");
    assert.include(reviewCi, "review-origin-pr.mjs");
    assert.include(reviewCi, "grok-4.6");
    assert.include(reviewCi, "CLI_PROXY_API_KEY");
    assert.include(reviewCi, "cli-proxy-api-production-1615.up.railway.app");
    assert.include(reviewCi, "origin-forge.mjs setup-ci");
    assert.notInclude(reviewCi, "XAI_API_KEY");
    assert.notInclude(reviewCi, "api.x.ai");
    assert.notInclude(reviewCi, "gh api");
    assert.notInclude(reviewCi, "gh pr");
  });
});
