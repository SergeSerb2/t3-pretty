import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, expect, it } from "vite-plus/test";

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
  reviewOriginPullRequest,
  reviewMarker,
  shouldSkipBranch,
  truncateDiff,
  viewPullRequestWithRetry,
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

  it("waits for a pull request created just after its branch push", async () => {
    let attempts = 0;
    let waits = 0;
    const pullRequest = await viewPullRequestWithRetry("t3code/fix-foo", {
      attempts: 3,
      delayMs: 0,
      view: () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('No open or draft change found for branch "t3code/fix-foo"');
        }
        return { number: 82 };
      },
      wait: async () => {
        waits += 1;
      },
    });

    assert.equal(pullRequest.number, 82);
    assert.equal(attempts, 3);
    assert.equal(waits, 2);
  });

  it("does not hide unrelated Origin failures", async () => {
    await expect(
      viewPullRequestWithRetry("t3code/fix-foo", {
        attempts: 3,
        delayMs: 0,
        view: () => {
          throw new Error("Origin authentication failed");
        },
      }),
    ).rejects.toThrow("Origin authentication failed");
  });

  it("only treats a genuinely missing branch pull request as a clean skip", async () => {
    const input = {
      env: { BUILDKITE_BRANCH: "t3code/fix-foo" },
      setupAuth: false,
      apiKey: "unused",
    };
    const skipped = await reviewOriginPullRequest({
      ...input,
      lookupPullRequest: async () => {
        throw new Error('No open or draft change found for branch "t3code/fix-foo"');
      },
    });
    assert.match(skipped.skipped, /No Origin pull request/);

    await expect(
      reviewOriginPullRequest({
        ...input,
        lookupPullRequest: async () => {
          throw new Error("401 Unauthorized");
        },
      }),
    ).rejects.toThrow("401 Unauthorized");
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
    assert.include(body, "origin pr thread resolve");
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
    assert.include(pipeline, "run-trusted-origin-pr-ci.sh");
    const trusted = NodeFS.readFileSync(
      NodePath.resolve(here, "run-trusted-origin-pr-ci.sh"),
      "utf8",
    );
    assert.notInclude(trusted, "refs/remotes/origin/main");
    assert.notInclude(trusted, "fetch --deepen=");
    assert.include(trusted, '"+refs/heads/main:${main_ref}"');
    const reviewStep = pipeline.slice(pipeline.indexOf(":mag: Origin PR Review"));
    assert.include(reviewStep.slice(0, 1200), "queue: macos-release");
    assert.include(reviewStep, "automation");
    assert.notInclude(reviewStep, "build.pull_request");
    assert.include(reviewStep, "briefly waits for the PR");
    assert.include(reviewCi, "review-origin-pr.mjs");
    assert.include(reviewCi, "grok-4.6");
    assert.include(reviewCi, "CLI_PROXY_API_KEY");
    assert.include(reviewCi, "cli-proxy-api-production-1615.up.railway.app");
    assert.include(reviewCi, "origin-forge.mjs");
    assert.include(reviewCi, "brew install node");
    assert.include(reviewCi, "HOMEBREW_NO_ASK=1");
    assert.notInclude(reviewCi, "/Users/m1-dev/");
    assert.notInclude(reviewCi, "XAI_API_KEY");
    assert.notInclude(reviewCi, "api.x.ai");
    assert.notInclude(reviewCi, "gh api");
    assert.notInclude(reviewCi, "gh pr");
  });
});
