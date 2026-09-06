import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  applyRepairEdits,
  buildRepairPrompt,
  condenseLog,
  extractDiagnosticTargets,
  formatRepairReportSection,
  loadRepairTargetFiles,
  MAX_TARGET_FILES,
} from "./repair-sync-tree.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const root = "/repo";
const workspaceDirectories = [
  root,
  `${root}/apps/web`,
  `${root}/apps/mobile`,
  `${root}/packages/client-runtime`,
];
const tracked = new Set([
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "scripts/fork/run-upstream-sync.sh",
  "apps/web/src/index.css",
  "apps/web/src/components/Foo.tsx",
  "apps/mobile/src/Stack.tsx",
  "packages/client-runtime/src/connection/registry.ts",
  "packages/client-runtime/src/state/threads-atoms.test.ts",
  "packages/client-runtime/src/state/threadSnapshotHttp.ts",
]);

describe("extractDiagnosticTargets", () => {
  it("resolves package-relative tsgo paths, ranks by mentions, and keeps declaration references", () => {
    const log = [
      "src/state/threads-atoms.test.ts:145:54 - error TS2741: Property 'reconcileRelayEnvironments' is missing in type '{ entries: ... }'.",
      "  src/connection/registry.ts:95:14 - 'reconcileRelayEnvironments' is declared here.",
      "src/state/threads-atoms.test.ts:213:49 - error TS2345: Argument of type 'AtomRuntime<...>' is not assignable.",
      "          Property 'load' is missing in type 'WarmThreadStateRegistry'.",
      "  src/state/threadSnapshotHttp.ts:81:14 - 'load' is declared here.",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked });
    assert.deepEqual(result.targets, [
      "packages/client-runtime/src/state/threads-atoms.test.ts",
      "packages/client-runtime/src/connection/registry.ts",
      "packages/client-runtime/src/state/threadSnapshotHttp.ts",
    ]);
    assert.deepEqual(result.references[0], {
      path: "packages/client-runtime/src/state/threads-atoms.test.ts",
      line: 145,
    });
    assert.deepInclude(result.references, {
      path: "packages/client-runtime/src/connection/registry.ts",
      line: 95,
    });
    assert.deepEqual(result.identifiers, [
      "reconcileRelayEnvironments",
      "load",
      "WarmThreadStateRegistry",
    ]);
  });

  it("understands absolute Metro paths, rolldown (line:col) spans, and oxlint brackets", () => {
    const log = [
      `Error: Unable to resolve module ./bar from ${root}/apps/mobile/src/Stack.tsx: nope`,
      "x Build failed: apps/web/src/components/Foo.tsx (12:3) unexpected token",
      "  ,-[apps/web/src/index.css:1:1]",
      "src/connection/registry.ts(95,14): error TS2304: Cannot find name 'X'.",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked });
    assert.sameMembers(result.targets, [
      "apps/mobile/src/Stack.tsx",
      "apps/web/src/components/Foo.tsx",
      "apps/web/src/index.css",
      "packages/client-runtime/src/connection/registry.ts",
    ]);
    assert.deepInclude(result.references, { path: "apps/web/src/components/Foo.tsx", line: 12 });
    assert.deepInclude(result.references, {
      path: "packages/client-runtime/src/connection/registry.ts",
      line: 95,
    });
  });

  it("ignores untracked paths, version strings, and fork-owned automation", () => {
    const log = [
      "src/state/missing.ts:1:1 - error TS1000: nope",
      "scripts/fork/run-upstream-sync.sh:3 something",
      ".github/workflows/ci.yml:1:1 something",
      "pnpm-lock.yaml:1 something",
      "resolving v0.0.39-nightly.20260905.1284 and package.json",
      "/etc/passwd.json:1",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked });
    assert.deepEqual(result.targets, ["package.json"]);
  });

  it("resolves ambiguous package-relative paths to the package the other diagnostics name", () => {
    const both = new Set([
      ...tracked,
      "apps/mobile/src/state/threads.ts",
      "packages/client-runtime/src/state/threads.ts",
    ]);
    const log = [
      "src/connection/registry.ts(9,1): error TS2304: Cannot find name 'A'.",
      "src/state/threads.ts(1128,43): error TS2552: Cannot find name 'B'.",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked: both });
    assert.sameMembers(result.targets, [
      "packages/client-runtime/src/connection/registry.ts",
      "packages/client-runtime/src/state/threads.ts",
    ]);
    // The task runner's cwd banner is a vote too.
    const banner = extractDiagnosticTargets(
      "~/packages/client-runtime$ tsgo --noEmit\nsrc/state/threads.ts(1,1): error TS1",
      { root, workspaceDirectories, tracked: both },
    );
    assert.deepEqual(banner.targets, ["packages/client-runtime/src/state/threads.ts"]);
    // Without any vote the earliest workspace directory still wins.
    const alone = extractDiagnosticTargets("src/state/threads.ts(1,1): error TS1", {
      root,
      workspaceDirectories,
      tracked: both,
    });
    assert.deepEqual(alone.targets, ["apps/mobile/src/state/threads.ts"]);
  });

  it("ignores files that only appear in warnings and suggestions", () => {
    const log = [
      "apps/web/src/components/Foo.tsx:12:3: warning react(preserve-manual-memoization): nope",
      "apps/web/src/components/Foo.tsx:14:3: warning react(preserve-manual-memoization): nope",
      "src/state/threadSnapshotHttp.ts(5,8): suggestion TS377090: This can be replaced.",
      "apps/web/src/index.css:1:1: error: Unused eslint-disable directive",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked });
    assert.deepEqual(result.targets, ["apps/web/src/index.css"]);
  });

  it("keeps error lines that mention warning or suggestion in the message", () => {
    const log = [
      "src/state/threads-atoms.test.ts:145:54 - error TS2741: Property 'warning' is missing in type '{ entries: ... }'.",
      "  src/connection/registry.ts:95:14 - 'suggestion' is declared here.",
      "apps/web/src/components/Foo.tsx:12:3: warning react(preserve-manual-memoization): nope",
    ].join("\n");
    const result = extractDiagnosticTargets(log, { root, workspaceDirectories, tracked });
    assert.sameMembers(result.targets, [
      "packages/client-runtime/src/state/threads-atoms.test.ts",
      "packages/client-runtime/src/connection/registry.ts",
    ]);
  });

  it("bounds the target list", () => {
    const many = new Set(tracked);
    const lines = [];
    for (let index = 0; index < MAX_TARGET_FILES + 5; index += 1) {
      many.add(`apps/web/src/f${index}.ts`);
      lines.push(`src/f${index}.ts:1:1 - error TS1`);
    }
    const result = extractDiagnosticTargets(lines.join("\n"), {
      root,
      workspaceDirectories,
      tracked: many,
    });
    assert.lengthOf(result.targets, MAX_TARGET_FILES);
  });
});

describe("applyRepairEdits", () => {
  const sources = () =>
    new Map([
      ["a.ts", "const a = 1;\nconst b = 2;\nconst a2 = 1;\n"],
      ["b.ts", "export const c = 3;\n"],
    ]);
  const editable = new Set(["a.ts", "b.ts"]);

  it("applies unique edits across files and returns only changed files", () => {
    const updated = applyRepairEdits({
      edits: [
        { path: "a.ts", old_text: "const b = 2;", new_text: "const b: number = 2;" },
        { path: "b.ts", old_text: "export const c = 3;", new_text: "export const c = 3;" },
      ],
      sources: sources(),
      editable,
    });
    assert.deepEqual(
      [...updated.entries()],
      [["a.ts", "const a = 1;\nconst b: number = 2;\nconst a2 = 1;\n"]],
    );
  });

  it("chains edits against the already-updated file", () => {
    const updated = applyRepairEdits({
      edits: [
        { path: "a.ts", old_text: "const b = 2;", new_text: "const b = 3;" },
        { path: "a.ts", old_text: "const b = 3;", new_text: "const b = 4;" },
      ],
      sources: sources(),
      editable,
    });
    assert.include(updated.get("a.ts"), "const b = 4;");
  });

  it("rejects ambiguous, missing, foreign, suppressive, and unparseable edits", () => {
    const reject = (edit, message) =>
      assert.throws(
        () => applyRepairEdits({ edits: [edit], sources: sources(), editable }),
        message,
      );
    reject({ path: "a.ts", old_text: "const a", new_text: "const x" }, /more than one location/u);
    reject({ path: "a.ts", old_text: "const z", new_text: "const x" }, /does not appear/u);
    reject({ path: "c.ts", old_text: "x", new_text: "y" }, /not offered for editing/u);
    reject(
      { path: "a.ts", old_text: "const b = 2;", new_text: "// @ts-expect-error\nconst b = 2;" },
      /suppresses diagnostics/u,
    );
    reject(
      { path: "a.ts", old_text: "const b = 2;", new_text: "const b = 2 as any;" },
      /suppresses diagnostics/u,
    );
    reject(
      { path: "a.ts", old_text: "const b = 2;", new_text: "const b = (;" },
      /not syntactically valid/u,
    );
    assert.throws(() => applyRepairEdits({ edits: [], sources: sources(), editable }), /no edits/u);
  });

  it("keeps a suppression the original text already carried", () => {
    const withSuppression = new Map([["a.ts", "// @ts-expect-error legacy\nconst b = 2;\n"]]);
    const updated = applyRepairEdits({
      edits: [
        {
          path: "a.ts",
          old_text: "// @ts-expect-error legacy\nconst b = 2;",
          new_text: "// @ts-expect-error legacy\nconst b = 3;",
        },
      ],
      sources: withSuppression,
      editable: new Set(["a.ts"]),
    });
    assert.include(updated.get("a.ts"), "const b = 3;");
  });

  it("applies css and json repairs without the TypeScript parser", () => {
    const sources = new Map([
      ["apps/web/src/index.css", "body { color: red; }\n"],
      ["package.json", '{"name":"t3"}\n'],
    ]);
    const updated = applyRepairEdits({
      edits: [
        { path: "apps/web/src/index.css", old_text: "color: red", new_text: "color: blue" },
        { path: "package.json", old_text: '"name":"t3"', new_text: '"name":"t3-pretty"' },
      ],
      sources,
      editable: new Set(["apps/web/src/index.css", "package.json"]),
    });
    assert.include(updated.get("apps/web/src/index.css"), "color: blue");
    assert.include(updated.get("package.json"), "t3-pretty");
  });
});

describe("loadRepairTargetFiles", () => {
  it("skips unreadable targets without assuming Error, and returns empty when none load", () => {
    const { files, skipped } = loadRepairTargetFiles(["a.ts", "b.ts"], {
      readSource: (path) => {
        if (path === "a.ts") throw "ENOENT";
        throw { code: "EACCES" };
      },
      historyFor: () => ({ log: "", diff: "" }),
    });
    assert.deepEqual(files, []);
    assert.deepEqual(
      skipped.map((entry) => entry.message),
      ["ENOENT", "[object Object]"],
    );
  });

  it("keeps files that load and records only the ones that throw", () => {
    const { files, skipped } = loadRepairTargetFiles(["ok.ts", "missing.ts"], {
      readSource: (path) => {
        if (path === "missing.ts") throw new Error("could not be opened as a regular file");
        return "export const ok = 1;\n";
      },
      historyFor: (path) => ({ log: `- abc ${path}`, diff: "" }),
    });
    assert.deepEqual(
      files.map((file) => file.path),
      ["ok.ts"],
    );
    assert.equal(files[0].source, "export const ok = 1;\n");
    assert.deepEqual(skipped, [
      { path: "missing.ts", message: "could not be opened as a regular file" },
    ]);
  });
});

describe("condenseLog", () => {
  it("returns small logs untouched, then drops advisories, then keeps the tail", () => {
    assert.equal(condenseLog("a\nb", 100), "a\nb");
    const noisy = [
      "x.ts(1,1): error TS1: Property 'warning' is missing",
      ...Array.from({ length: 50 }, () => "y.ts:1:1: warning r(x): meh"),
    ].join("\n");
    assert.equal(condenseLog(noisy, 200), "x.ts(1,1): error TS1: Property 'warning' is missing");
    const long = Array.from({ length: 50 }, (_, index) => `line${index}: error`).join("\n");
    const condensed = condenseLog(long, 100);
    assert.match(condensed, /^… \(earlier output omitted\)\nline\d+: error/u);
    assert.isTrue(condensed.endsWith("line49: error"));
  });
});

describe("buildRepairPrompt and the report section", () => {
  it("names the failed step, quotes every file with its fork history, and forbids suppression", () => {
    const prompt = buildRepairPrompt({
      step: "web-typecheck",
      log: "src/x.ts:1:1 - error TS1",
      upstreamTag: "v0.0.39-nightly.20260905.1284",
      files: [
        {
          path: "apps/web/src/x.ts",
          source: "export const x = 1;\n",
          history: { log: "- abc123 feat: fork thing", diff: "+export const x = 1;" },
        },
      ],
      referenceWindows: [
        { path: "apps/web/src/y.ts", line: 12, window: "   12| export const y = 2;" },
      ],
      declarationWindows: [],
    });
    assert.include(prompt, 'fails the "web-typecheck" validation step');
    assert.include(prompt, "v0.0.39-nightly.20260905.1284");
    assert.include(
      prompt,
      "FILE apps/web/src/x.ts (complete current content):\nexport const x = 1;",
    );
    assert.include(prompt, "- abc123 feat: fork thing");
    assert.include(prompt, "EXCERPT apps/web/src/y.ts around line 12");
    assert.include(prompt, "Never suppress diagnostics");
    assert.include(prompt, "return safe=false");
  });

  it("records the repaired files and omissions under one heading", () => {
    const section = formatRepairReportSection({
      step: "web-typecheck",
      upstreamTag: "v0.0.39-nightly.20260905.1284",
      paths: ["packages/client-runtime/src/state/threads-atoms.test.ts"],
      summary: "Added the fork's registry field to the parent test fixture.",
      omitted: [{ change: "a parent test", reason: "it exercised removed behavior" }],
    });
    assert.match(section, /^## Post-merge repairs\n/u);
    assert.include(section, "`web-typecheck` failed after merging `v0.0.39-nightly.20260905.1284`");
    assert.include(section, "  - edited `packages/client-runtime/src/state/threads-atoms.test.ts`");
    assert.include(
      section,
      "  - omitted parent change: a parent test. Reason: it exercised removed behavior",
    );
  });
});

describe("run-upstream-sync.sh repair loop", () => {
  const script = NodeFS.readFileSync(NodePath.resolve(here, "run-upstream-sync.sh"), "utf8");

  it("re-validates after each committed repair and stops after a bounded number of rounds", () => {
    assert.include(script, "validate_sync_tree || exit 1");
    assert.include(script, 'repair-sync-tree.mjs --log "$VALIDATION_LOG" --step "$SYNC_FAIL_STEP"');
    assert.include(script, 'UPSTREAM_TAG="$UPSTREAM_TAG"');
    assert.include(script, 'PREVIOUS_UPSTREAM_TAG="${PREVIOUS_UPSTREAM_TAG-}"');
    assert.isBelow(
      script.lastIndexOf('PREVIOUS_UPSTREAM_TAG="${PREVIOUS_UPSTREAM_TAG-}"'),
      script.indexOf('repair-sync-tree.mjs --log "$VALIDATION_LOG" --step "$SYNC_FAIL_STEP"'),
    );
    assert.include(script, "vp lint --fix apps/web/src || true");
    assert.notInclude(script, "vp lint --fix apps/web/src >/dev/null");
    assert.notInclude(script, "git add -u -- apps/web/src");
    assert.include(script, "git diff --name-only -- apps/web/src");
    assert.include(script, 'git add -u -- "$lint_path"');
    assert.include(script, "SYNC_MAX_REPAIR_ROUNDS:-4");
    // The budget resets when a later step fails: progress must not be starved.
    assert.include(script, 'if [[ "$SYNC_FAIL_STEP" != "$repaired_step" ]]; then');
    assert.include(
      script,
      'commit_sync "chore(sync): repair $SYNC_FAIL_STEP after merging $UPSTREAM_TAG"',
    );
    // A frozen-install refusal is fixed by regeneration, never by the model.
    assert.include(
      script,
      'commit_sync "chore(sync): regenerate the lockfile after merging $UPSTREAM_TAG"',
    );
    // The deadline exit code must propagate so the run defers instead of reporting blocked.
    assert.include(script, "if (( status == 75 )); then");
    assert.isBelow(
      script.indexOf("validate_sync_tree_once() {"),
      script.indexOf("repair_sync_tree() {"),
    );
    assert.isBelow(
      script.indexOf("repair_sync_tree() {"),
      script.indexOf("validate_sync_tree() {"),
    );
  });
});
