#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const API_URL = (
  process.env.CLI_PROXY_API_URL ?? "https://cli-proxy-api-production-1615.up.railway.app/v1"
).replace(/\/$/u, "");
const MODEL = process.env.CLI_PROXY_MODEL ?? "gpt-5.6-sol";
// Changelog prose needs far less reasoning than conflict resolution, so the
// default effort is lower than the resolver's xhigh.
const REASONING_EFFORT = process.env.CLI_PROXY_CHANGELOG_EFFORT ?? "high";
const SERVICE_TIER = process.env.CLI_PROXY_SERVICE_TIER ?? "priority";
const CHANGELOG_PATH = "apps/web/src/changelog/changelogData.ts";
const CHANGELOG_MARKER = "export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [";
const COMMIT_SUBJECT_PREFIX = "docs(changelog):";
const FORK_TAG_PATTERN = /^v(\d+\.\d+\.\d+-nightly\.\d+\.\d+)\.fork$/u;
const MAX_RELEASES_PER_RUN = 60;
const MAX_VERSIONS_PER_REQUEST = 4;
const MAX_FORK_COMMITS = 40;
const MAX_UPSTREAM_COMMITS = 60;
const PRINT_WIDTH = 100;
// Model calls must stay comfortably below the 15-minute preflight deadline:
// each request times out on its own, and an overall budget stops further
// chunk requests so the fallback path always runs before GitHub kills the job.
const REQUEST_TIMEOUT_MS = 150_000;
const MODEL_TIME_BUDGET_MS = 600_000;

function git(args, options = {}) {
  return NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  }).trim();
}

/** Numeric segments of a version, including dotted-numeric prerelease parts
    ("0.0.34-nightly.20260810.1059000052" → [0, 0, 34, 20260810, 1059000052]).
    Mirrors parseVersionSegments in apps/web/src/changelog/changelog.logic.ts. */
export function parseVersionSegments(version) {
  const match = version?.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }
  const segments = match[1].split(".").map(Number);
  if (match[2]) {
    for (const identifier of match[2].split(".")) {
      if (/^\d+$/u.test(identifier)) {
        segments.push(Number(identifier));
      }
    }
  }
  return segments;
}

export function compareVersions(a, b) {
  const left = parseVersionSegments(a);
  const right = parseVersionSegments(b);
  if (!left || !right) {
    return null;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index] ?? 0;
    const rightSegment = right[index] ?? 0;
    if (leftSegment !== rightSegment) {
      return leftSegment < rightSegment ? -1 : 1;
    }
  }
  return 0;
}

/** Every `version: "..."` literal in changelogData.ts, in file order. */
export function extractChangelogVersions(source) {
  return [...source.matchAll(/^\s+version:\s*"([^"]+)",$/gmu)].map((match) => match[1]);
}

/** Versions that still need a changelog entry, oldest first and bounded:
    every shipped fork build without one — including gaps below the newest
    present entry, which overlapping release runs can leave behind — plus the
    release currently being cut. */
export function planReleases({ presentVersions, forkVersions, currentVersion }) {
  const present = new Set(presentVersions);
  const planned = forkVersions.filter((version) => !present.has(version));
  if (currentVersion && !present.has(currentVersion) && !planned.includes(currentVersion)) {
    planned.push(currentVersion);
  }
  return planned.sort((a, b) => compareVersions(a, b) ?? 0).slice(0, MAX_RELEASES_PER_RUN);
}

/** Serialize one release to the exact changelogData.ts entry style. Property
    lines that would exceed the print width use the two-line string form the
    formatter produces. */
export function serializeReleaseEntry(entry) {
  const property = (indent, name, value) => {
    const inline = `${indent}${name}: ${JSON.stringify(value)},`;
    if (inline.length <= PRINT_WIDTH) {
      return [inline];
    }
    return [`${indent}${name}:`, `${indent}  ${JSON.stringify(value)},`];
  };

  const lines = ["  {", ...property("    ", "version", entry.version)];
  lines.push(...property("    ", "date", entry.date));
  if (entry.headline) {
    lines.push(...property("    ", "headline", entry.headline));
  }
  lines.push("    items: [");
  for (const item of entry.items) {
    lines.push("      {");
    lines.push(...property("        ", "kind", item.kind));
    lines.push(...property("        ", "title", item.title));
    if (item.description) {
      lines.push(...property("        ", "description", item.description));
    }
    lines.push("      },");
  }
  lines.push("    ],", "  },");
  return lines.join("\n");
}

// Entry blocks are the only lines at exactly two-space indent inside the
// array; item objects sit deeper, so this boundary is unambiguous.
const ENTRY_BLOCK_PATTERN = /^  \{[\s\S]*?^  \},$/gmu;

/** Split the releases array into its raw entry blocks, preserving each
    block's exact text so existing entries move untouched. */
function splitChangelogEntries(source) {
  const markerIndex = source.indexOf(CHANGELOG_MARKER);
  if (markerIndex === -1) {
    throw new Error(`Could not find the CHANGELOG_RELEASES array in ${CHANGELOG_PATH}`);
  }
  const arrayStart = markerIndex + CHANGELOG_MARKER.length;
  const arrayEnd = source.indexOf("\n];", arrayStart);
  if (arrayEnd === -1) {
    throw new Error(`Could not find the end of CHANGELOG_RELEASES in ${CHANGELOG_PATH}`);
  }
  const body = source.slice(arrayStart, arrayEnd);
  const blocks = [];
  for (const match of body.matchAll(ENTRY_BLOCK_PATTERN)) {
    const versionMatch = /^\s+version:\s*"([^"]+)",$/mu.exec(match[0]);
    if (!versionMatch) {
      throw new Error(`A CHANGELOG_RELEASES entry is missing its version`);
    }
    blocks.push({ version: versionMatch[1], text: match[0] });
  }
  if (body.replace(ENTRY_BLOCK_PATTERN, "").trim() !== "") {
    throw new Error(`Unrecognized content inside CHANGELOG_RELEASES in ${CHANGELOG_PATH}`);
  }
  return { prefix: source.slice(0, arrayStart), blocks, suffix: source.slice(arrayEnd) };
}

/** Merge new entries ({version, text}) into the releases array, keeping the
    whole list sorted newest first so gap-filling entries land at their
    sorted position instead of only ever prepending. */
export function mergeChangelogEntries(source, newEntries) {
  const { prefix, blocks, suffix } = splitChangelogEntries(source);
  const present = new Set(blocks.map((block) => block.version));
  const merged = [...blocks];
  for (const entry of newEntries) {
    if (!present.has(entry.version)) {
      merged.push(entry);
    }
  }
  merged.sort((a, b) => -(compareVersions(a.version, b.version) ?? 0));
  return `${prefix}\n${merged.map((entry) => entry.text).join("\n")}${suffix}`;
}

export function buildChangelogPrompt({ releases }) {
  const sections = releases.map((release) => {
    const lines = [`### v${release.version} (${release.date})`, "T3 Pretty commits:"];
    if (release.forkCommits.length > 0) {
      lines.push(...release.forkCommits.map((subject) => `- ${subject}`));
    } else {
      lines.push("- (none)");
    }
    if (release.upstream) {
      lines.push(
        `Parent T3 Code commits (${release.upstream.fromTag} → ${release.upstream.toTag}):`,
      );
      lines.push(...release.upstream.commits.map((subject) => `- ${subject}`));
    }
    return lines.join("\n");
  });

  return `You are writing the "What's New" changelog for T3 Pretty, a desktop and web app that gives coding agents (Codex, Claude Code, and similar) a polished graphical interface. T3 Pretty is a fork of T3 Code: it ships its own features and also integrates the parent project's nightly builds about twice a day. The changelog is shown inside the app after an auto-update, to people who use the app — not to developers.

For each release below, write concise, user-facing changelog items. "T3 Pretty commits" are the fork's own changes; "Parent T3 Code commits" arrived through the integrated upstream nightly noted for that release.

${sections.join("\n\n")}

Rules:
- Return one "releases" entry per release above, keyed by the exact version string.
- kind: "new" for new capabilities, "improved" for enhancements to existing behavior, "fixed" for bug fixes.
- title: at most 10 words, sentence case, no trailing period, no version numbers, no commit hashes, no PR numbers.
- description: one short sentence explaining what the user gets; use "" when the title says it all.
- headline: one sentence only when a release has a clear standout theme; otherwise "".
- Merge related commits into a single item; order items by user impact; at most 6 items per release.
- Skip purely internal changes (CI, release plumbing, docs, test-only changes, refactors with no user-visible effect).
- Treat parent T3 Code changes as first-class entries: phrase them as app improvements without mentioning "upstream", "parent", "nightly", or "fork".
- Never invent changes that are not implied by the commit lists.
- If a release has no user-visible changes, give it a single "improved" item titled "Under-the-hood stability and maintenance" with an empty description.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["releases"],
  properties: {
    releases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["version", "headline", "items"],
        properties: {
          version: { type: "string" },
          headline: { type: "string" },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "title", "description"],
              properties: {
                kind: { type: "string", enum: ["new", "improved", "fixed"] },
                title: { type: "string" },
                description: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

function extractResponseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("CLIProxyAPI response did not contain output text");
}

async function callChangelogModel({ prompt, token }) {
  const response = await fetch(`${API_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: REASONING_EFFORT },
      service_tier: SERVICE_TIER,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "fork_changelog",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`CLIProxyAPI request failed with ${response.status}: ${body.slice(0, 500)}`);
  }
  const payload = await response.json();
  const parsed = JSON.parse(extractResponseText(payload));
  if (!Array.isArray(parsed.releases)) {
    throw new Error("CLIProxyAPI response did not contain a releases list");
  }
  return parsed.releases;
}

const ITEM_KINDS = new Set(["new", "improved", "fixed"]);

function sanitizeItems(items) {
  const seen = new Set();
  const sanitized = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.title !== "string" || item.title.trim() === "") {
      continue;
    }
    const title = item.title.trim();
    if (seen.has(title)) {
      continue;
    }
    seen.add(title);
    sanitized.push({
      kind: ITEM_KINDS.has(item.kind) ? item.kind : "improved",
      title,
      description: typeof item.description === "string" ? item.description.trim() : "",
    });
    if (sanitized.length >= 8) {
      break;
    }
  }
  return sanitized;
}

/** Best-effort entry built directly from commit subjects, used when the model
    omits a version so no shipped build is left out of the changelog. */
export function fallbackReleaseEntry({ version, date, forkCommits, upstream }) {
  const subjects = [...forkCommits, ...(upstream?.commits ?? [])];
  const items = [];
  for (const subject of subjects) {
    const match = subject.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/u);
    if (!match) {
      continue;
    }
    const kind = match[1] === "fix" ? "fixed" : match[1] === "feat" ? "new" : "improved";
    items.push({ kind, title: match[2].trim(), description: "" });
    if (items.length >= 6) {
      break;
    }
  }
  return {
    version,
    date,
    headline: "",
    items:
      items.length > 0
        ? items
        : [
            {
              kind: "improved",
              title: "Under-the-hood stability and maintenance",
              description: "",
            },
          ],
  };
}

function listForkReleases() {
  return git(["tag", "--list", "v*-nightly.*.fork"])
    .split("\n")
    .filter(Boolean)
    .map((tag) => {
      const match = FORK_TAG_PATTERN.exec(tag);
      return match ? { tag, version: match[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareVersions(a.version, b.version) ?? 0);
}

function nightlyTagAt(ref) {
  try {
    return (
      git(["show", `${ref}:.t3-fork/upstream-nightly`])
        .split("\n")[0]
        ?.trim() ?? ""
    );
  } catch {
    return "";
  }
}

function commitSubjects(rangeArgs) {
  return git(["log", "--first-parent", "--format=%s", ...rangeArgs])
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith(COMMIT_SUBJECT_PREFIX))
    .slice(0, MAX_FORK_COMMITS);
}

function upstreamSubjects(fromTag, toTag) {
  return git(["log", "--no-merges", "--format=%s", `${fromTag}..${toTag}`])
    .split("\n")
    .filter(Boolean)
    .slice(0, MAX_UPSTREAM_COMMITS);
}

function commitDate(ref) {
  return git(["log", "-1", "--format=%cs", ref]);
}

/** Git context for one release version: which ref it is, the fork's own
    commits since the previous fork build, and the parent nightly window. */
export function releaseContext({ version, currentVersion, forkReleases }) {
  const isCurrent = version === currentVersion;
  const ref = isCurrent ? "HEAD" : `v${version}.fork`;
  const index = forkReleases.findIndex((release) => release.version === version);
  const previous = isCurrent
    ? forkReleases[forkReleases.length - 1]
    : index > 0
      ? forkReleases[index - 1]
      : null;

  const nightlyNow = nightlyTagAt(ref);
  const nightlyPrevious = previous ? nightlyTagAt(previous.tag) : "";
  const baseRef = previous?.tag ?? nightlyNow;
  const forkCommits = commitSubjects(
    baseRef ? [`${baseRef}..${ref}`] : ["-n", String(MAX_FORK_COMMITS), ref],
  );
  const upstream =
    nightlyNow && nightlyPrevious && nightlyNow !== nightlyPrevious
      ? {
          fromTag: nightlyPrevious,
          toTag: nightlyNow,
          commits: upstreamSubjects(nightlyPrevious, nightlyNow),
        }
      : null;

  return { version, date: commitDate(ref), forkCommits, upstream };
}

function hasChanges(context) {
  return context.forkCommits.length > 0 || context.upstream !== null;
}

async function generateEntries({ contexts, token, warn }) {
  const entries = [];
  const deadline = Date.now() + MODEL_TIME_BUDGET_MS;
  for (let start = 0; start < contexts.length; start += MAX_VERSIONS_PER_REQUEST) {
    const chunk = contexts.slice(start, start + MAX_VERSIONS_PER_REQUEST);
    let modelReleases = [];
    if (token && Date.now() < deadline) {
      const prompt = buildChangelogPrompt({ releases: chunk });
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          modelReleases = await callChangelogModel({ prompt, token });
          break;
        } catch (error) {
          if (attempt === 2 || Date.now() >= deadline) {
            warn(
              `CLIProxyAPI changelog generation failed for ${chunk
                .map((release) => release.version)
                .join(", ")}; falling back to commit subjects. ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            break;
          }
        }
      }
    } else if (token) {
      warn(
        `Changelog model time budget exhausted; using commit subjects for ${chunk
          .map((release) => release.version)
          .join(", ")}.`,
      );
    }
    for (const context of chunk) {
      const modelRelease = modelReleases.find((release) => release.version === context.version);
      const items = modelRelease ? sanitizeItems(modelRelease.items) : [];
      if (modelRelease && items.length > 0) {
        entries.push({
          version: context.version,
          date: context.date,
          headline: typeof modelRelease.headline === "string" ? modelRelease.headline.trim() : "",
          items,
        });
      } else {
        if (token && !modelRelease) {
          warn(`CLIProxyAPI omitted v${context.version}; falling back to commit subjects.`);
        }
        entries.push(fallbackReleaseEntry(context));
      }
    }
  }
  return entries;
}

function warn(message) {
  process.stdout.write(`::warning::${message}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const versionArgIndex = args.indexOf("--version");
  const currentVersion = (
    versionArgIndex === -1 ? process.env.RELEASE_VERSION : args[versionArgIndex + 1]
  )?.trim();
  const token = process.env.CLI_PROXY_API_KEY?.trim() ?? "";
  const baseSha = git(["rev-parse", "HEAD"]);
  const forkReleases = listForkReleases();

  if (forkReleases.length === 0 && !currentVersion) {
    process.stdout.write(
      "[fork-changelog] no fork releases and no current version; nothing to do\n",
    );
    return;
  }

  const source = NodeFS.readFileSync(CHANGELOG_PATH, "utf8");
  const planned = planReleases({
    presentVersions: extractChangelogVersions(source),
    forkVersions: forkReleases.map((release) => release.version),
    currentVersion: currentVersion || undefined,
  });
  if (planned.length === 0) {
    process.stdout.write("[fork-changelog] changelog already covers every fork release\n");
    writeGitHubOutput({ ref: baseSha, entries: 0 });
    return;
  }

  const contexts = planned
    .map((version) => releaseContext({ version, currentVersion, forkReleases }))
    .filter(hasChanges);
  if (contexts.length === 0) {
    process.stdout.write("[fork-changelog] every pending release is empty; nothing to announce\n");
    writeGitHubOutput({ ref: baseSha, entries: 0 });
    return;
  }

  process.stdout.write(
    `[fork-changelog] planning ${contexts.length} release(s): ${contexts
      .map((context) => context.version)
      .join(", ")}\n`,
  );
  if (dryRun) {
    for (const context of contexts) {
      process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
    }
    return;
  }
  if (!token) {
    warn("CLI_PROXY_API_KEY is not set; shipping without new changelog entries.");
    writeGitHubOutput({ ref: baseSha, entries: 0 });
    return;
  }

  // Only a run sitting exactly on the origin/main tip may publish notes to
  // main: a manual dispatch of another ref must not fast-forward main to
  // unreviewed history, and a moved tip means this run already lost the race.
  git(["fetch", "origin", "main"]);
  const mainTip = git(["rev-parse", "origin/main"]);
  if (mainTip !== baseSha) {
    // A retry of a run that already pushed its notes finds its own untagged
    // changelog commit as the main tip; reuse it so the release still ships
    // the notes instead of publishing the bare triggering commit.
    const tipSubject = git(["log", "-1", "--format=%s", mainTip]);
    const tipFirstParent = git(["log", "-1", "--format=%P", mainTip]).split(" ")[0];
    if (tipFirstParent === baseSha && tipSubject.startsWith(COMMIT_SUBJECT_PREFIX)) {
      process.stdout.write(
        `[fork-changelog] reusing the changelog commit ${mainTip.slice(0, 12)} already on main\n`,
      );
      writeGitHubOutput({ ref: mainTip, entries: 0 });
      return;
    }
    warn("HEAD is not the origin/main tip; skipping the changelog push.");
    writeGitHubOutput({ ref: baseSha, entries: 0 });
    return;
  }

  const entries = await generateEntries({ contexts, token, warn });
  const newEntries = entries.map((entry) => ({
    version: entry.version,
    text: serializeReleaseEntry(entry),
  }));
  NodeFS.writeFileSync(CHANGELOG_PATH, mergeChangelogEntries(source, newEntries));

  const newest =
    newEntries.map((entry) => entry.version).sort((a, b) => -(compareVersions(a, b) ?? 0))[0] ??
    currentVersion ??
    "unknown";
  git(["add", "--", CHANGELOG_PATH]);
  git([
    "-c",
    "user.name=t3-pretty-release[bot]",
    "-c",
    "user.email=github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    `docs(changelog): add release notes through v${newest}`,
  ]);

  try {
    git(["push", "origin", "HEAD:main"]);
  } catch (error) {
    // A rejected push means origin/main moved since this run started. Never
    // rebase onto it: the release must stay pinned to the triggering commit
    // its version was computed from, and the moved commit's own queued run
    // regenerates any entries this run leaves behind.
    warn(
      `Could not push the changelog commit; releasing ${baseSha.slice(0, 12)} without it. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    git(["reset", "--hard", baseSha]);
    writeGitHubOutput({ ref: baseSha, entries: 0 });
    return;
  }

  const sha = git(["rev-parse", "HEAD"]);
  process.stdout.write(
    `[fork-changelog] committed and pushed ${entries.length} release note(s) as ${sha.slice(0, 12)}\n`,
  );
  writeGitHubOutput({ ref: sha, entries: entries.length });
}

function writeGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  NodeFS.appendFileSync(
    outputPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

const invokedPath = process.argv[1] ? NodePath.resolve(process.argv[1]) : "";
if (invokedPath === NodeURL.fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `[fork-changelog] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
