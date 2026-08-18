#!/usr/bin/env node

import * as NodePath from "node:path";

import {
  ORIGIN_FULL_NAME,
  originRepoFlag,
  parseJson,
  pullRequestNumber,
  runOrigin,
} from "./origin-forge.mjs";
import {
  findingTitle,
  isActionableGrokFinding,
  resolveBranchName,
  resolveExplicitPr,
  shouldSkipBranch,
} from "./review-origin-pr.mjs";

const FIXED_REPLY = /\b(?:fixed|addressed|resolved)\b/iu;

export function isFixedReply(body) {
  return typeof body === "string" && FIXED_REPLY.test(body);
}

export function threadComments(thread) {
  return Array.isArray(thread?.comments) ? thread.comments : [];
}

export function actionableThreadFinding(thread) {
  for (const comment of threadComments(thread)) {
    if (!isActionableGrokFinding(comment.body)) continue;
    return {
      kind: "thread",
      id: thread.id ?? comment.id,
      title: findingTitle(comment.body),
      resolved: thread.resolved === true,
      body: comment.body,
    };
  }
  return null;
}

export function actionableReviewFinding(review) {
  if (!isActionableGrokFinding(review?.body)) return null;
  return {
    kind: "review",
    id: review.id,
    title: findingTitle(review.body),
    resolved: false,
    body: review.body,
  };
}

export function followUpBodies({ threads = [], reviews = [], comments = [] } = {}) {
  const bodies = [];
  for (const comment of comments) {
    if (typeof comment?.body === "string") bodies.push({ id: comment.id, body: comment.body });
  }
  for (const review of reviews) {
    if (typeof review?.body === "string") bodies.push({ id: review.id, body: review.body });
  }
  for (const thread of threads) {
    for (const comment of threadComments(thread)) {
      if (typeof comment?.body === "string") bodies.push({ id: comment.id, body: comment.body });
    }
  }
  return bodies;
}

export function hasFixedReply(finding, payload) {
  if (!finding?.title) return false;
  for (const item of followUpBodies(payload)) {
    if (item.id === finding.id) continue;
    if (item.body.includes(finding.title) && isFixedReply(item.body)) return true;
  }
  return false;
}

export function unresolvedActionableFindings({ threads = [], reviews = [], comments = [] } = {}) {
  const payload = { threads, reviews, comments };
  const fromThreads = [];
  const threadTitles = new Set();
  for (const thread of threads) {
    const finding = actionableThreadFinding(thread);
    if (!finding) continue;
    threadTitles.add(finding.title);
    fromThreads.push(finding);
  }
  const fromReviews = [];
  for (const review of reviews) {
    const finding = actionableReviewFinding(review);
    if (!finding || threadTitles.has(finding.title)) continue;
    fromReviews.push(finding);
  }

  const unresolved = [];
  for (const finding of fromThreads) {
    if (!finding.resolved) unresolved.push(finding);
  }
  for (const finding of fromReviews) {
    if (!hasFixedReply(finding, payload)) unresolved.push(finding);
  }
  return unresolved;
}

export function formatUnresolvedReport(findings) {
  if (findings.length === 0) return "All actionable Origin review findings are resolved.";
  const lines = [`${findings.length} actionable Origin review finding(s) still open:`, ""];
  for (const finding of findings) {
    if (finding.kind === "thread") {
      lines.push(
        `- ${finding.title} (${finding.id}) — resolve with \`origin pr thread resolve ${finding.id}\``,
      );
    } else {
      lines.push(
        `- ${finding.title} (${finding.id}) — this was posted as a review, not a thread. Reply that it is fixed, naming the title.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function listThreads(target, { repo } = {}) {
  const json = runOrigin([
    "pr",
    "thread",
    "list",
    String(target),
    ...originRepoFlag(repo),
    "--json",
    "id,resolved,path,commentCount,comments",
  ]);
  const parsed = parseJson(json, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function listReviewsAndComments(target, { repo } = {}) {
  const json = runOrigin([
    "pr",
    "view",
    String(target),
    ...originRepoFlag(repo),
    "--json",
    "number,reviews,latestReviews,comments,threads",
  ]);
  const parsed = parseJson(json, {});
  return {
    number: pullRequestNumber(parsed),
    reviews: Array.isArray(parsed?.reviews)
      ? parsed.reviews
      : Array.isArray(parsed?.latestReviews)
        ? parsed.latestReviews
        : [],
    comments: Array.isArray(parsed?.comments) ? parsed.comments : [],
    threads: Array.isArray(parsed?.threads) ? parsed.threads : [],
  };
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function checkOriginPrComments({
  argv = process.argv.slice(2),
  env = process.env,
  repo = env.ORIGIN_REPO || ORIGIN_FULL_NAME,
} = {}) {
  const explicitPr = resolveExplicitPr({ env, argvPr: readFlag(argv, "--pr") });
  const head = resolveBranchName({ env, argvHead: readFlag(argv, "--head") });
  const skip = shouldSkipBranch(explicitPr ? head || "review" : head);
  if (!explicitPr && skip) {
    process.stdout.write(`${skip}\n`);
    return { skipped: skip };
  }
  const target = explicitPr || head;
  if (!target) {
    process.stdout.write("No Origin pull request to check.\n");
    return { skipped: "No Origin pull request to check." };
  }

  const listed = listThreads(target, { repo });
  const viewed = listReviewsAndComments(target, { repo });
  const threads = listed.length > 0 ? listed : viewed.threads;
  const unresolved = unresolvedActionableFindings({
    threads,
    reviews: viewed.reviews,
    comments: viewed.comments,
  });
  const report = formatUnresolvedReport(unresolved);
  process.stdout.write(`${report}\n`);
  if (unresolved.length > 0) {
    throw new Error(report.trim());
  }
  return { number: viewed.number || String(target), unresolved };
}

function isMain(argv = process.argv) {
  const invoked = argv[1] ? NodePath.basename(argv[1]) : "";
  return invoked === "check-origin-pr-comments.mjs";
}

if (isMain()) {
  try {
    checkOriginPrComments();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
