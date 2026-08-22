import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  buildChangelogPrompt,
  commitSubjects,
  compareVersions,
  extractChangelogVersions,
  fallbackReleaseEntry,
  mergeChangelogEntries,
  parseVersionSegments,
  planReleases,
  publishPendingNotes,
  serializeReleaseEntry,
} from "./generate-changelog.mjs";

const releaseWorkflowPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../.github/workflows/fork-release.yml",
);

describe("version parsing", () => {
  it("parses numeric prerelease segments and skips alphabetic identifiers", () => {
    assert.deepEqual(parseVersionSegments("0.0.34"), [0, 0, 34]);
    assert.deepEqual(
      parseVersionSegments("0.0.34-nightly.20260810.1059000052"),
      [0, 0, 34, 20260810, 1059000052],
    );
    assert.deepEqual(
      parseVersionSegments("v0.0.34-nightly.20260810.1059000052.fork"),
      [0, 0, 34, 20260810, 1059000052],
    );
    assert.isNull(parseVersionSegments("not-a-version"));
  });

  it("orders nightly builds above their plain base version", () => {
    assert.equal(compareVersions("0.0.34-nightly.1", "0.0.34"), 1);
    assert.equal(compareVersions("0.0.34", "0.0.34-nightly.1"), -1);
    assert.equal(
      compareVersions("0.0.34-nightly.20260810.1062", "0.0.34-nightly.20260810.1059"),
      1,
    );
    assert.equal(compareVersions("0.0.34-nightly.1", "0.0.34-nightly.1"), 0);
  });
});

describe("planReleases", () => {
  const forkVersions = [
    "0.0.33-nightly.20260809.1043000015",
    "0.0.33-nightly.20260810.1055000040",
    "0.0.34-nightly.20260810.1059000041",
  ];

  it("plans every fork build newer than the newest present entry plus the current version", () => {
    const planned = planReleases({
      presentVersions: ["0.0.33", "0.0.32", "0.0.31"],
      forkVersions,
      currentVersion: "0.0.34-nightly.20260810.1059000052",
    });
    assert.deepEqual(planned, [
      "0.0.33-nightly.20260809.1043000015",
      "0.0.33-nightly.20260810.1055000040",
      "0.0.34-nightly.20260810.1059000041",
      "0.0.34-nightly.20260810.1059000052",
    ]);
  });

  it("fills gaps below the newest present entry left by overlapping runs", () => {
    const planned = planReleases({
      presentVersions: ["0.0.33-nightly.20260810.1055000040", "0.0.33"],
      forkVersions,
      currentVersion: undefined,
    });
    assert.deepEqual(planned, [
      "0.0.33-nightly.20260809.1043000015",
      "0.0.34-nightly.20260810.1059000041",
    ]);
  });

  it("does not duplicate the current version when it is already a shipped tag", () => {
    const planned = planReleases({
      presentVersions: ["0.0.33"],
      forkVersions,
      currentVersion: "0.0.34-nightly.20260810.1059000041",
    });
    assert.deepEqual(
      planned.filter((version) => version === "0.0.34-nightly.20260810.1059000041"),
      ["0.0.34-nightly.20260810.1059000041"],
    );
  });
});

describe("changelogData.ts editing", () => {
  const source = `/**
 * Header comment.
 */

export type ChangelogItemKind = "new" | "improved" | "fixed";

export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: "0.0.33",
    date: "2026-08-10",
    items: [
      {
        kind: "new",
        title: "Existing entry",
      },
    ],
  },
];
`;

  it("extracts the versions in file order", () => {
    assert.deepEqual(extractChangelogVersions(source), ["0.0.33"]);
  });

  it("inserts new entries at the top without touching existing ones", () => {
    const version = "0.0.34-nightly.20260810.1059000052";
    const text = serializeReleaseEntry({
      version,
      date: "2026-08-11",
      headline: "",
      items: [{ kind: "new", title: "Fresh feature", description: "" }],
    });
    const updated = mergeChangelogEntries(source, [{ version, text }]);
    assert.deepEqual(extractChangelogVersions(updated), [
      "0.0.34-nightly.20260810.1059000052",
      "0.0.33",
    ]);
    assert.include(updated, 'title: "Existing entry"');
  });

  it("fills an older gap at its sorted position", () => {
    const gapSource = source.replace(
      '    version: "0.0.33",',
      '    version: "0.0.33-nightly.20260810.1055000040",',
    );
    const version = "0.0.33-nightly.20260810.1054000025";
    const text = serializeReleaseEntry({
      version,
      date: "2026-08-09",
      headline: "",
      items: [{ kind: "fixed", title: "Gap fix", description: "" }],
    });
    const updated = mergeChangelogEntries(gapSource, [{ version, text }]);
    assert.deepEqual(extractChangelogVersions(updated), [
      "0.0.33-nightly.20260810.1055000040",
      "0.0.33-nightly.20260810.1054000025",
    ]);
    assert.include(updated, 'title: "Gap fix"');
    assert.include(updated, 'title: "Existing entry"');
  });

  it("serializes the exact changelogData.ts style, wrapping long strings", () => {
    const entry = serializeReleaseEntry({
      version: "0.0.34-nightly.20260810.1059000052",
      date: "2026-08-11",
      headline: "Shorter, calmer updates.",
      items: [
        {
          kind: "fixed",
          title: "A fix",
          description:
            "A description long enough to exceed the configured print width of one hundred characters total.",
        },
      ],
    });
    assert.equal(
      entry,
      `  {
    version: "0.0.34-nightly.20260810.1059000052",
    date: "2026-08-11",
    headline: "Shorter, calmer updates.",
    items: [
      {
        kind: "fixed",
        title: "A fix",
        description:
          "A description long enough to exceed the configured print width of one hundred characters total.",
      },
    ],
  },`,
    );
  });
});

describe("buildChangelogPrompt", () => {
  it("lists fork and parent commits per release with the user-facing writing rules", () => {
    const prompt = buildChangelogPrompt({
      releases: [
        {
          version: "0.0.34-nightly.20260810.1059000052",
          date: "2026-08-11",
          forkCommits: ["feat(web): add auto-PR toggle to chat composer (#43)"],
          upstream: {
            fromTag: "v0.0.33-nightly.20260810.1055",
            toTag: "v0.0.34-nightly.20260810.1059",
            commits: ["fix(server): preserve branch association"],
          },
        },
      ],
    });

    assert.include(prompt, "v0.0.34-nightly.20260810.1059000052");
    assert.include(prompt, "feat(web): add auto-PR toggle to chat composer (#43)");
    assert.include(prompt, "fix(server): preserve branch association");
    assert.include(prompt, 'without mentioning "upstream", "parent", "nightly", or "fork"');
    assert.include(prompt, "keyed by the exact version string");
  });
});

describe("fallbackReleaseEntry", () => {
  it("derives items from conventional commit subjects", () => {
    const entry = fallbackReleaseEntry({
      version: "0.0.34-nightly.20260810.1059000052",
      date: "2026-08-11",
      forkCommits: [
        "fix(server): preserve branch association",
        "feat(web): show What's New changelog dialog after updates (#41)",
      ],
      upstream: null,
    });
    assert.deepEqual(entry.items, [
      { kind: "fixed", title: "preserve branch association", description: "" },
      {
        kind: "new",
        title: "show What's New changelog dialog after updates (#41)",
        description: "",
      },
    ]);
  });

  it("falls back to a maintenance item when nothing changed", () => {
    const entry = fallbackReleaseEntry({
      version: "0.0.34-nightly.20260810.1059000052",
      date: "2026-08-11",
      forkCommits: [],
      upstream: null,
    });
    assert.deepEqual(entry.items, [
      { kind: "improved", title: "Under-the-hood stability and maintenance", description: "" },
    ]);
  });

  it("skips merge commits and internal types so Origin PR merges still yield notes", () => {
    const entry = fallbackReleaseEntry({
      version: "0.0.34-nightly.20260812.1077000102",
      date: "2026-08-12",
      forkCommits: [
        "Merge pull request #91 from SergeSerb2/t3code/redesign-settled-snoozed-ui",
        "chore(ci): bump the release runners",
        "fix(ci): stop hosted OTA from SIGKILL",
        "fix(release): publish Windows NSIS artifacts",
        "fix(sync): resume leftover merges",
        "docs(changelog): add release notes through v0.0.34",
        "feat(web): add Boring personalization that restores T3 Chat",
        "fix(web): restore clicks on titlebar panel toggles",
        "fix(web): restore clicks on titlebar panel toggles",
      ],
      upstream: null,
    });
    assert.deepEqual(entry.items, [
      {
        kind: "new",
        title: "add Boring personalization that restores T3 Chat",
        description: "",
      },
      { kind: "fixed", title: "restore clicks on titlebar panel toggles", description: "" },
    ]);
  });

  it("does not skip a user-facing subject that mentions ci or release mid-title", () => {
    const entry = fallbackReleaseEntry({
      version: "0.0.34-nightly.20260812.1077000102",
      date: "2026-08-12",
      forkCommits: [
        "feat(web): add foo(ci) helper to the composer",
        "fix(server): handle bar(release) timeout",
        "fix(ci): stop hosted OTA from SIGKILL",
      ],
      upstream: null,
    });
    assert.deepEqual(entry.items, [
      { kind: "new", title: "add foo(ci) helper to the composer", description: "" },
      { kind: "fixed", title: "handle bar(release) timeout", description: "" },
    ]);
  });
});

describe("commitSubjects", () => {
  it("walks first-parent and expands PR merges without importing upstream", () => {
    const fixtureRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-fork-changelog-walk-"),
    );
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd: fixtureRoot, encoding: "utf8" }).trim();

    try {
      git("init");
      git("config", "user.name", "T3 Fork Changelog Test");
      git("config", "user.email", "t3-fork-changelog-test@example.invalid");
      NodeFS.writeFileSync(NodePath.join(fixtureRoot, "app.txt"), "base\n");
      git("add", "app.txt");
      git("commit", "-m", "chore: start");
      const start = git("rev-parse", "HEAD");
      const main = git("rev-parse", "--abbrev-ref", "HEAD");

      NodeFS.writeFileSync(NodePath.join(fixtureRoot, "app.txt"), "pretty\n");
      git("add", "app.txt");
      git("commit", "-m", "feat(web): keep the pretty change");

      git("checkout", "-b", "upstream");
      for (let index = 0; index < 45; index++) {
        NodeFS.writeFileSync(NodePath.join(fixtureRoot, "upstream.txt"), `u${index}\n`);
        git("add", "upstream.txt");
        git("commit", "-m", `feat(server): upstream change ${index}`);
      }
      git("checkout", main);
      git("merge", "--no-ff", "-m", "chore(sync): merge upstream v1", "upstream");

      git("checkout", "-b", "pr");
      NodeFS.writeFileSync(NodePath.join(fixtureRoot, "pr.txt"), "pr\n");
      git("add", "pr.txt");
      git("commit", "-m", "feat(web): add from the pull request");
      git("checkout", main);
      git("merge", "--no-ff", "-m", "Merge pull request #9 from user/pr", "pr");

      const previous = process.cwd();
      try {
        process.chdir(fixtureRoot);
        const subjects = commitSubjects([`${start}..HEAD`]);
        assert.include(subjects, "feat(web): add from the pull request");
        assert.include(subjects, "feat(web): keep the pretty change");
        assert.notInclude(subjects, "Merge pull request #9 from user/pr");
        assert.equal(
          subjects.some((subject) => subject.startsWith("feat(server): upstream change")),
          false,
        );
      } finally {
        process.chdir(previous);
      }
    } finally {
      NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("publishPendingNotes", () => {
  it("pushes working-tree notes to main and no-ops on a clean tree", () => {
    const fixtureRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-fork-changelog-publish-"),
    );
    const originPath = NodePath.join(fixtureRoot, "origin.git");
    const workPath = NodePath.join(fixtureRoot, "work");
    const git = (cwd, ...args) =>
      NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

    try {
      git(fixtureRoot, "init", "--bare", "-b", "main", originPath);
      git(fixtureRoot, "clone", "--quiet", originPath, workPath);
      git(workPath, "config", "user.name", "T3 Fork Changelog Test");
      git(workPath, "config", "user.email", "t3-fork-changelog-test@example.invalid");
      const changelogPath = NodePath.join(
        workPath,
        "apps",
        "web",
        "src",
        "changelog",
        "changelogData.ts",
      );
      NodeFS.mkdirSync(NodePath.dirname(changelogPath), { recursive: true });
      NodeFS.writeFileSync(
        changelogPath,
        [
          "export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [",
          "  {",
          '    version: "0.0.34-nightly.1",',
          '    date: "2026-08-20",',
          "    items: [",
          "      {",
          '        kind: "improved",',
          '        title: "Older notes",',
          '        description: "",',
          "      },",
          "    ],",
          "  },",
          "];",
          "",
        ].join("\n"),
      );
      git(workPath, "add", ".");
      git(workPath, "commit", "--quiet", "-m", "feat(web): ship a thing");
      git(workPath, "push", "--quiet", "origin", "HEAD:main");
      const baseSha = git(workPath, "rev-parse", "HEAD");

      const previous = process.cwd();
      try {
        process.chdir(workPath);

        // Nothing generated yet: no commit, no push.
        publishPendingNotes({ baseSha });
        assert.equal(git(originPath, "rev-parse", "main"), baseSha);

        // Simulate the packager's --no-push generation leaving notes behind.
        const source = NodeFS.readFileSync(changelogPath, "utf8");
        const next = mergeChangelogEntries(source, [
          {
            version: "0.0.35-nightly.2",
            text: serializeReleaseEntry({
              version: "0.0.35-nightly.2",
              date: "2026-08-21",
              headline: "",
              items: [{ kind: "new", title: "Shiny thing", description: "" }],
            }),
          },
        ]);
        NodeFS.writeFileSync(changelogPath, next);

        publishPendingNotes({ baseSha });
        assert.equal(
          git(originPath, "log", "-1", "--format=%s", "main"),
          "docs(changelog): add release notes through v0.0.35-nightly.2",
        );
        assert.equal(
          git(originPath, "show", "main:apps/web/src/changelog/changelogData.ts"),
          next.trim(),
        );
        assert.equal(git(workPath, "status", "--porcelain"), "");
      } finally {
        process.chdir(previous);
      }
    } finally {
      NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("release workflow wiring", () => {
  it("generates the changelog during preflight and releases the changelog commit", () => {
    const workflow = NodeFS.readFileSync(releaseWorkflowPath, "utf8");

    assert.include(workflow, "node scripts/fork/generate-changelog.mjs --no-push");
    assert.notInclude(
      workflow.slice(
        workflow.indexOf("id: changelog"),
        workflow.indexOf("run: node scripts/fork/generate-changelog.mjs --no-push"),
      ),
      "CLI_PROXY_API_KEY: ${{ env.CLI_PROXY_API_KEY }}",
    );
    assert.include(workflow, "RELEASE_VERSION: ${{ steps.release.outputs.version }}");
    const changelogStep = workflow.slice(
      workflow.indexOf("id: changelog"),
      workflow.indexOf("run: node scripts/fork/generate-changelog.mjs"),
    );
    assert.include(changelogStep, "steps.release.outcome == 'success'");
    assert.include(changelogStep, "steps.release.outputs.minted == 'true'");
    assert.include(changelogStep, "steps.release.outputs.version != ''");
    assert.include(changelogStep, "steps.release.outputs.version != '-'");
    assert.include(
      workflow,
      "ref: ${{ steps.changelog.outputs.ref || github.sha || env.BUILDKITE_COMMIT }}",
    );
    assert.notInclude(workflow, "github.sha || '-'");
    assert.include(workflow, "continue-on-error: true");
    const changelog = NodeFS.readFileSync(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "generate-changelog.mjs",
      ),
      "utf8",
    );
    assert.include(changelog, "process.exitCode = 1");
    assert.include(changelog, "--no-merges");
    assert.include(changelog, "--no-push");
    assert.include(changelog, "--dry-run");
    assert.include(changelog, "writing changelog entries from commit subjects");
    assert.include(changelog, '"--first-parent"');
    assert.include(changelog, "Merge pull request ");
    const dryRunGuard = changelog.indexOf("if (dryRun)");
    const writeCall = changelog.indexOf("NodeFS.writeFileSync(CHANGELOG_PATH, nextSource)");
    assert.isAtLeast(dryRunGuard, 0);
    assert.isBelow(dryRunGuard, writeCall);
  });

  it("writes notes from the native packagers that actually ship the app", () => {
    const macos = NodeFS.readFileSync(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "build-macos-dmg.sh",
      ),
      "utf8",
    );
    const windows = NodeFS.readFileSync(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "build-windows-nsis.ps1",
      ),
      "utf8",
    );
    assert.include(macos, "node scripts/fork/generate-changelog.mjs");
    assert.include(macos, '"${changelog_args[@]}"');
    assert.include(macos, "docs(changelog): add release notes through v");
    assert.include(macos, "already-minted");
    assert.include(macos, "latest-mac.yml");
    assert.include(macos, "skipping changelog generation");
    assert.include(macos, 'changelog_args=(--version "$version" --no-push)');
    // The notes push happens after the feed publish so the build it triggers
    // sees the version in latest-mac.yml and skips packaging.
    assert.include(macos, "node scripts/fork/generate-changelog.mjs --publish");
    assert.isBelow(
      macos.indexOf("origin-forge.mjs upload-assets"),
      macos.indexOf("generate-changelog.mjs --publish"),
    );
    assert.isBelow(
      macos.indexOf('generate-changelog.mjs "${changelog_args[@]}"'),
      macos.indexOf("build-desktop-artifact.ts"),
    );
    assert.notInclude(macos, "Changelog-only commit; skipping macOS packaging.");
    assert.include(windows, "generate-changelog.mjs");
    assert.include(windows, "--no-push");
    assert.include(windows, "docs(changelog): add release notes through v");
    assert.include(windows, "already-minted");
    assert.include(windows, "latest.yml");
    assert.include(windows, "skipping changelog generation");
    assert.notInclude(windows, "Changelog-only commit; skipping Windows packaging.");
  });

  it("restricts the changelog push to runs triggered by main", () => {
    const workflow = NodeFS.readFileSync(releaseWorkflowPath, "utf8");

    assert.include(workflow, "github.ref == 'refs/heads/main'");
  });

  it("recognizes a tagged changelog child when skipping already released commits", () => {
    const workflow = NodeFS.readFileSync(releaseWorkflowPath, "utf8");

    assert.include(workflow, '"$tag^{commit}~1"');
    assert.include(workflow, '"docs(changelog):"*');
  });
});
