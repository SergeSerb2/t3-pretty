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
const MAX_RELEASES_PER_RUN = Number.parseInt(
  process.env.CLI_PROXY_CHANGELOG_MAX_RELEASES ?? "150",
  10,
);
const MAX_VERSIONS_PER_REQUEST = 4;
const MAX_FORK_COMMITS = 40;
const MAX_UPSTREAM_COMMITS = 60;
const PRINT_WIDTH = 100;
const MAINTENANCE_TITLE = "Under-the-hood stability and maintenance";
const INTERNAL_COMMIT =
  /^(?:(?:chore|ci|docs|test|build|style)(?:\(|:|!)|\w+\((?:ci|release|sync)\))/u;
// Model calls must stay comfortably below the 15-minute preflight deadline:
// each request times out on its own, and an overall budget stops further
// chunk requests so the fallback path always runs before GitHub kills the job.
const REQUEST_TIMEOUT_MS = 150_000;
const MODEL_TIME_BUDGET_MS = Number.parseInt(
  process.env.CLI_PROXY_CHANGELOG_BUDGET_MS ?? "600000",
  10,
);

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
    if (INTERNAL_COMMIT.test(subject)) {
      continue;
    }
    const match = subject.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/u);
    if (!match) {
      continue;
    }
    const title = match[2].trim();
    if (items.some((item) => item.title === title)) {
      continue;
    }
    const kind = match[1] === "fix" ? "fixed" : match[1] === "feat" ? "new" : "improved";
    items.push({ kind, title, description: "" });
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
              title: MAINTENANCE_TITLE,
              description: "",
            },
          ],
  };
}

function readCliProxyToken() {
  const fromEnv = process.env.CLI_PROXY_API_KEY?.trim() ?? "";
  if (fromEnv) {
    return fromEnv;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates = [
    home ? NodePath.join(home, ".config", "t3-pretty", "CLI_PROXY_API_KEY") : "",
    "/Users/m1-dev/.config/t3-pretty/CLI_PROXY_API_KEY",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = NodeFS.readFileSync(candidate, "utf8").replace(/\r/g, "").trim();
      if (value) {
        return value;
      }
    } catch {
      // File-backed secrets are optional; fallback entries still ship.
    }
  }
  return "";
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

function skipChangelogSubject(subject) {
  return subject === "" || subject.startsWith(COMMIT_SUBJECT_PREFIX);
}

function pushSubjects(subjects, extra) {
  for (const subject of extra) {
    if (skipChangelogSubject(subject)) continue;
    subjects.push(subject);
    if (subjects.length >= MAX_FORK_COMMITS) return true;
  }
  return false;
}

/** First-parent subjects for a fork window. Expands `Merge pull request`
    commits so Origin/GitHub merge subjects don't hide feat/fix lines, but
    does not walk a nightly/sync merge's second parent (that DAG belongs in
    the upstream window). */
export function commitSubjects(rangeArgs) {
  const entries = git(["log", "--first-parent", "--format=%H%x00%P%x00%s", ...rangeArgs])
    .split("\n")
    .filter(Boolean);
  const subjects = [];
  for (const entry of entries) {
    const [hash, parents, subject] = entry.split("\0");
    if (!hash || subject == null) continue;
    const isMerge = parents.split(" ").filter(Boolean).length > 1;
    if (isMerge && subject.startsWith("Merge ")) {
      if (subject.startsWith("Merge pull request ")) {
        const prSubjects = git(["log", "--no-merges", "--format=%s", `${hash}^1..${hash}`]).split(
          "\n",
        );
        if (pushSubjects(subjects, prSubjects)) return subjects;
      }
      continue;
    }
    if (pushSubjects(subjects, [subject])) return subjects;
  }
  return subjects;
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
    let calledModel = false;
    if (token && Date.now() < deadline) {
      const prompt = buildChangelogPrompt({ releases: chunk });
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          modelReleases = await callChangelogModel({ prompt, token });
          calledModel = true;
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
        if (calledModel && !modelRelease) {
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
  const noPush = dryRun || args.includes("--no-push");
  const versionArgIndex = args.indexOf("--version");
  const currentVersion = (
    versionArgIndex === -1 ? process.env.RELEASE_VERSION : args[versionArgIndex + 1]
  )?.trim();
  const token = readCliProxyToken();
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
    const entries = contexts.map((context) => fallbackReleaseEntry(context));
    process.stdout.write(
      `[fork-changelog] dry-run; generated ${entries.length} release note(s) without writing ${CHANGELOG_PATH}\n`,
    );
    for (const entry of entries) {
      process.stdout.write(`${serializeReleaseEntry(entry)}\n`);
    }
    writeGitHubOutput({ ref: baseSha, entries: entries.length });
    return;
  }

  if (!token) {
    warn("CLI_PROXY_API_KEY is not set; writing changelog entries from commit subjects.");
  }

  const entries = await generateEntries({ contexts, token, warn });
  const newEntries = entries.map((entry) => ({
    version: entry.version,
    text: serializeReleaseEntry(entry),
  }));
  const nextSource = mergeChangelogEntries(source, newEntries);

  NodeFS.writeFileSync(CHANGELOG_PATH, nextSource);
  process.stdout.write(
    `[fork-changelog] wrote ${entries.length} release note(s) to ${CHANGELOG_PATH}\n`,
  );

  if (noPush) {
    writeGitHubOutput({ ref: baseSha, entries: entries.length });
    return;
  }

  // Only a run sitting exactly on the origin/main tip may publish notes to
  // main: a manual dispatch of another ref must not fast-forward main to
  // unreviewed history, and a moved tip means this run already lost the race.
  try {
    git(["fetch", "origin", "main"]);
  } catch (error) {
    warn(
      `Could not fetch origin/main; leaving ${CHANGELOG_PATH} in the working tree. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    writeGitHubOutput({ ref: baseSha, entries: entries.length });
    return;
  }
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
    warn("HEAD is not the origin/main tip; leaving changelog entries in the working tree.");
    writeGitHubOutput({ ref: baseSha, entries: entries.length });
    return;
  }

  const newest =
    newEntries.map((entry) => entry.version).sort((a, b) => -(compareVersions(a, b) ?? 0))[0] ??
    currentVersion ??
    "unknown";
  git(["add", "--", CHANGELOG_PATH]);
  git([
    "-c",
    "user.name=t3-pretty-release[bot]",
    "-c",
    "user.email=t3-pretty-bot@users.noreply.cursor.com",
    "commit",
    "-m",
    `docs(changelog): add release notes through v${newest}`,
  ]);

  try {
    git(["push", "origin", "HEAD:main"]);
  } catch (error) {
    // A rejected push means origin/main moved since this run started. Never
    // rebase onto it: the release must stay pinned to the triggering commit
    // its version was computed from. Keep the notes in the working tree so
    // this build still ships them.
    warn(
      `Could not push the changelog commit; keeping notes in the working tree. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    git(["reset", "--soft", baseSha]);
    git(["reset", "HEAD", "--", CHANGELOG_PATH]);
    NodeFS.writeFileSync(CHANGELOG_PATH, nextSource);
    writeGitHubOutput({ ref: baseSha, entries: entries.length });
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
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[fork-changelog] ${message}\n`);
    process.stdout.write(
      `::warning::Changelog generation failed; the release continues without new notes. ${message}\n`,
    );
    // Unexpected exceptions still fail the step so they show up in the job.
    // fork-release.yml marks this step continue-on-error so preflight proceeds.
    process.exitCode = 1;
  });
}
