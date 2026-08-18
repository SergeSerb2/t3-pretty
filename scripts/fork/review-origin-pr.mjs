#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ORIGIN_FULL_NAME,
  originRepoFlag,
  parseJson,
  pullRequestNumber,
  runOrigin,
  setupOriginAuth,
} from "./origin-forge.mjs";

export const REVIEW_MARKER = "t3-pretty-grok-review";
export const DEFAULT_MODEL = "grok-4.6";
export const DEFAULT_XAI_API_URL = "https://api.x.ai/v1";
export const MAX_DIFF_CHARS = 120_000;
export const MAX_ISSUES = 12;
const REQUEST_TIMEOUT_MS = 180_000;
const SEVERITIES = new Set(["bug", "suggestion", "nit"]);

export function grokApiKey() {
  return (
    process.env.XAI_API_KEY?.trim() ||
    process.env.GROK_API_KEY?.trim() ||
    process.env.XAI_KEY?.trim() ||
    ""
  );
}

export function grokApiUrl() {
  return (process.env.XAI_API_URL ?? DEFAULT_XAI_API_URL).replace(/\/$/u, "");
}

export function grokModel() {
  return process.env.XAI_REVIEW_MODEL?.trim() || DEFAULT_MODEL;
}

export function reviewMarker(sha) {
  return `<!-- ${REVIEW_MARKER} sha=${sha} -->`;
}

export function alreadyReviewed(reviews, sha) {
  const needle = reviewMarker(sha);
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const body = review?.body ?? review?.description ?? review?.text ?? "";
    if (typeof body === "string" && body.includes(needle)) return true;
  }
  return false;
}

export function resolveBranchName({ env = process.env, argvHead } = {}) {
  if (argvHead) return argvHead.replace(/^refs\/heads\//u, "");
  for (const raw of [
    env.ORIGIN_PR_HEAD,
    env.GITHUB_HEAD_REF,
    env.BUILDKITE_BRANCH,
    env.GITHUB_REF_NAME,
  ]) {
    const value = raw?.trim();
    if (!value || value === "main") continue;
    return value.replace(/^refs\/heads\//u, "");
  }
  return "";
}

export function resolveExplicitPr({ env = process.env, argvPr } = {}) {
  for (const raw of [argvPr, env.ORIGIN_PR, env.INPUT_PR, env.BUILDKITE_PULL_REQUEST]) {
    const value = String(raw ?? "").trim();
    if (!value || value === "false" || value === "null") continue;
    const digits = value.replace(/^#/u, "");
    if (/^\d+$/u.test(digits)) return digits;
  }
  return "";
}

export function shouldSkipBranch(head) {
  if (!head) return "No Origin pull request head branch was resolved.";
  if (head === "main") return "Skipping review on main.";
  if (head.startsWith("automation/") && process.env.ORIGIN_PR_REVIEW_AUTOMATION !== "1") {
    return `Skipping automation branch ${head}.`;
  }
  return "";
}

export function truncateDiff(diff, maxChars = MAX_DIFF_CHARS) {
  const text = diff ?? "";
  if (text.length <= maxChars) {
    return { diff: text, truncated: false };
  }
  return {
    diff: `${text.slice(0, maxChars)}\n\n[diff truncated after ${maxChars} characters]`,
    truncated: true,
  };
}

export function parseReviewResponse(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Grok review response did not contain a JSON object");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const issues = [];
  for (const issue of Array.isArray(parsed.issues) ? parsed.issues : []) {
    if (typeof issue?.title !== "string" || issue.title.trim() === "") continue;
    issues.push({
      severity: SEVERITIES.has(issue.severity) ? issue.severity : "suggestion",
      path: typeof issue.path === "string" ? issue.path.trim() : "",
      line: Number.isInteger(issue.line) ? issue.line : undefined,
      title: issue.title.trim(),
      body: typeof issue.body === "string" ? issue.body.trim() : "",
    });
    if (issues.length >= MAX_ISSUES) break;
  }
  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Grok 4.6 reviewed this Origin pull request.",
    issues,
  };
}

export function formatReviewBody({ sha, model, summary, issues, truncated, url }) {
  const counts = { bug: 0, suggestion: 0, nit: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  const lines = [
    reviewMarker(sha),
    "",
    `## Grok 4.6 review`,
    "",
    summary,
    "",
    `- Model: \`${model}\``,
    `- Head: \`${sha}\``,
    `- Findings: ${counts.bug} bug(s), ${counts.suggestion} suggestion(s), ${counts.nit} nit(s)`,
  ];
  if (url) lines.push(`- Pull request: ${url}`);
  if (truncated) {
    lines.push(
      "- The diff was truncated before review. Large generated files may be under-reviewed.",
    );
  }
  if (issues.length === 0) {
    lines.push("", "No blocking issues stood out in the provided diff.");
  } else {
    lines.push("", "## Findings");
    for (const issue of issues) {
      const location = issue.path
        ? `${issue.path}${issue.line ? `:${issue.line}` : ""}`
        : "general";
      lines.push("", `### ${issue.severity} — ${issue.title}`, "", `\`${location}\``);
      if (issue.body) lines.push("", issue.body);
    }
  }
  lines.push(
    "",
    "_Automated Origin review. This is not a merge approval. Humans still own the merge._",
    "",
  );
  return lines.join("\n");
}

export function buildReviewPrompt({ title, description, head, base, sha, diff, truncated }) {
  return [
    "You are reviewing a Cursor Origin pull request for the T3 Pretty fork of T3 Code.",
    "Find real bugs, regressions, missing reverse states, and release/CI mistakes.",
    "Do not praise. Do not invent issues. Skip style nits unless they change meaning.",
    "T3 Pretty keeps fork-owned release/sync workflows and Origin source-control support.",
    "Return ONLY a JSON object with this shape:",
    '{"summary":"2-4 sentences","issues":[{"severity":"bug|suggestion|nit","path":"file","line":1,"title":"short","body":"what and how to fix"}]}',
    "Use empty issues when the diff looks correct. Line numbers are right-side/new-file lines.",
    "",
    `Title: ${title}`,
    `Branch: ${head} -> ${base}`,
    `Head SHA: ${sha}`,
    description ? `Description:\n${description}` : "Description: (none)",
    truncated ? "Note: the diff below is truncated." : "",
    "",
    "Diff:",
    diff || "(empty diff)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function callGrokReview({
  prompt,
  apiKey,
  apiUrl = grokApiUrl(),
  model = grokModel(),
}) {
  if (!apiKey) throw new Error("XAI_API_KEY or GROK_API_KEY is required for Grok 4.6 reviews.");
  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You review git diffs for correctness. Reply with a single JSON object and no extra prose.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Grok request failed with ${response.status}: ${body.slice(0, 500)}`);
  }
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Grok response did not contain message content");
  }
  return parseReviewResponse(text);
}

export function viewPullRequest(target, { repo } = {}) {
  const json = runOrigin([
    "pr",
    "view",
    String(target),
    ...originRepoFlag(repo),
    "--json",
    "number,title,description,headRef,baseRef,headSha,baseSha,status,url,latestReviews,changedFiles",
  ]);
  return parseJson(json, null);
}

export function pullRequestDiff(target, { repo } = {}) {
  return runOrigin(["pr", "diff", String(target), ...originRepoFlag(repo), "--patch"]);
}

export function postReview(target, body, { repo } = {}) {
  const bodyFile = NodePath.join(
    NodeOS.tmpdir(),
    `t3-pretty-grok-review-${process.pid}-${Date.now()}.md`,
  );
  NodeFS.writeFileSync(bodyFile, body);
  try {
    return runOrigin([
      "pr",
      "review",
      String(target),
      ...originRepoFlag(repo),
      "--comment",
      "--body-file",
      bodyFile,
    ]);
  } finally {
    NodeFS.rmSync(bodyFile, { force: true });
  }
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function reviewOriginPullRequest({
  argv = process.argv.slice(2),
  env = process.env,
  repo = env.ORIGIN_REPO || ORIGIN_FULL_NAME,
  dryRun = argv.includes("--dry-run"),
  setupAuth = true,
  apiKey = grokApiKey(),
} = {}) {
  const explicitPr = resolveExplicitPr({ env, argvPr: readFlag(argv, "--pr") });
  const head = resolveBranchName({ env, argvHead: readFlag(argv, "--head") });
  const skip = shouldSkipBranch(explicitPr ? head || "review" : head);
  if (!explicitPr && skip) {
    process.stdout.write(`${skip}\n`);
    return { skipped: skip };
  }

  if (setupAuth) setupOriginAuth();

  const target = explicitPr || head;
  if (!target) {
    process.stdout.write("No Origin pull request to review.\n");
    return { skipped: "No Origin pull request to review." };
  }

  let pullRequest;
  try {
    pullRequest = viewPullRequest(target, { repo });
  } catch (error) {
    if (explicitPr) throw error;
    const message = `No Origin pull request is open for ${target}.`;
    process.stdout.write(`${message}\n`);
    return { skipped: message };
  }
  const number = pullRequestNumber(pullRequest);
  if (!number) throw new Error(`Could not load Origin pull request ${target}`);
  const sha = pullRequest.headSha || "";
  if (alreadyReviewed(pullRequest.latestReviews, sha)) {
    const message = `Already posted a Grok review for ${sha} on Origin PR #${number}.`;
    process.stdout.write(`${message}\n`);
    return { skipped: message, number, sha };
  }

  const rawDiff = pullRequestDiff(number, { repo });
  const { diff, truncated } = truncateDiff(rawDiff);
  if (!diff.trim()) {
    const message = `Origin PR #${number} has an empty diff.`;
    process.stdout.write(`${message}\n`);
    return { skipped: message, number, sha };
  }

  const model = grokModel();
  const review = await callGrokReview({
    prompt: buildReviewPrompt({
      title: pullRequest.title ?? "",
      description: pullRequest.description ?? "",
      head: pullRequest.headRef ?? head,
      base: pullRequest.baseRef ?? "main",
      sha,
      diff,
      truncated,
    }),
    apiKey,
    model,
  });
  const body = formatReviewBody({
    sha,
    model,
    summary: review.summary,
    issues: review.issues,
    truncated,
    url: pullRequest.url,
  });

  if (dryRun) {
    process.stdout.write(body);
    return { dryRun: true, number, sha, issues: review.issues };
  }

  const posted = postReview(number, body, { repo });
  process.stdout.write(`Posted Grok 4.6 review on Origin PR #${number}.\n`);
  if (posted) process.stdout.write(`${posted}\n`);
  return { number, sha, issues: review.issues, url: pullRequest.url };
}

function isMain(argv = process.argv) {
  const invoked = argv[1] ? NodePath.basename(argv[1]) : "";
  return invoked === "review-origin-pr.mjs";
}

if (isMain()) {
  reviewOriginPullRequest().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
