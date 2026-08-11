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
const MAX_PUSH_ATTEMPTS = 3;
const PRINT_WIDTH = 100;

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

/** Versions that still need a changelog entry, oldest first: every shipped
    fork build newer than the newest entry already present, plus the release
    currently being cut. */
export function planReleases({ presentVersions, forkVersions, currentVersion }) {
  const present = new Set(presentVersions);
  let newestPresent = null;
  for (const version of presentVersions) {
    if (newestPresent === null || (compareVersions(version, newestPresent) ?? 0) > 0) {
      newestPresent = version;
    }
  }
  const planned = forkVersions.filter(
    (version) =>
      !present.has(version) &&
      (newestPresent === null || (compareVersions(version, newestPresent) ?? 0) > 0),
  );
  if (currentVersion && !present.has(currentVersion) && !planned.includes(currentVersion)) {
    planned.push(currentVersion);
  }
  return planned.sort((a, b) => compareVersions(a, b) ?? 0).slice(-MAX_RELEASES_PER_RUN);
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

/** Insert serialized entries (newest first) at the top of the releases array. */
export function insertChangelogEntries(source, serializedEntries) {
  const index = source.indexOf(CHANGELOG_MARKER);
  if (index === -1) {
    throw new Error(`Could not find the CHANGELOG_RELEASES array in ${CHANGELOG_PATH}`);
  }
  const insertAt = index + CHANGELOG_MARKER.length;
  return `${source.slice(0, insertAt)}\n${serializedEntries.join("\n")}${source.slice(insertAt)}`;
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
  for (let start = 0; start < contexts.length; start += MAX_VERSIONS_PER_REQUEST) {
    const chunk = contexts.slice(start, start + MAX_VERSIONS_PER_REQUEST);
    let modelReleases = [];
    if (token) {
      const prompt = buildChangelogPrompt({ releases: chunk });
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          modelReleases = await callChangelogModel({ prompt, token });
          break;
        } catch (error) {
          if (attempt === 2) {
            warn(
              `CLIProxyAPI changelog generation failed for ${chunk
                .map((release) => release.version)
                .join(", ")}; falling back to commit subjects. ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
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

  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
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
      process.stdout.write(
        "[fork-changelog] every pending release is empty; nothing to announce\n",
      );
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

    const entries = await generateEntries({ contexts, token, warn });
    const serialized = entries
      .sort((a, b) => -(compareVersions(a.version, b.version) ?? 0))
      .map(serializeReleaseEntry);
    NodeFS.writeFileSync(CHANGELOG_PATH, insertChangelogEntries(source, serialized));

    const newest = entries[0]?.version ?? currentVersion ?? "unknown";
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
      const sha = git(["rev-parse", "HEAD"]);
      process.stdout.write(
        `[fork-changelog] committed and pushed ${entries.length} release note(s) as ${sha.slice(0, 12)}\n`,
      );
      writeGitHubOutput({ ref: sha, entries: entries.length });
      return;
    } catch (error) {
      warn(
        `Could not push the changelog commit (attempt ${attempt}/${MAX_PUSH_ATTEMPTS}). ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      git(["fetch", "origin", "main"]);
      git(["reset", "--hard", "origin/main"]);
    }
  }

  warn("Giving up on the changelog commit after repeated push conflicts; releasing without it.");
  writeGitHubOutput({ ref: baseSha, entries: 0 });
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
