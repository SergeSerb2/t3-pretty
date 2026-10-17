import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "vite-plus/test";

const script = new URL("./cut-public-release.mjs", import.meta.url).pathname;
const originUrl = "https://origin.cursor.com/serbinenko/t3-pretty.git";
const githubUrl = "git@github.com:SergeSerb2/t3-pretty.git";

function git(cwd, ...args) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function fixture(test) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-cut-test-"));
  const origin = NodePath.join(root, "origin");
  const github = NodePath.join(root, "github.git");
  NodeFS.mkdirSync(origin);
  const write = (path, text) => {
    const file = NodePath.join(origin, path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, text);
  };
  try {
    git(origin, "init", "-b", "main");
    git(origin, "config", "user.name", "Public Cut Test");
    git(origin, "config", "user.email", "public-cut@example.invalid");
    write("app.txt", "old public source\n");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "existing public release");
    const previous = git(origin, "rev-parse", "HEAD");
    git(root, "clone", "--bare", origin, github);
    git(origin, "remote", "add", "origin", originUrl);
    git(origin, "config", `url.file://${origin}.insteadOf`, originUrl);
    git(origin, "config", `url.file://${github}.insteadOf`, githubUrl);
    write("app.txt", "chosen stable source\n");
    write(".buildkite/pipeline.yml", "steps: []\n");
    write(".github/workflows/fork-upstream-sync.yml", "on:\n  schedule: []\n");
    write(".github/workflows/new-internal-workflow.yml", "on:\n  push:\n");
    write(".github/workflows/public-release.yml", "on:\n  workflow_dispatch:\njobs: {}\n");
    write("README.md", "Internal download links\n");
    write("scripts/fork/public-README.md", "Public stable downloads\n");
    git(origin, "add", ".");
    git(origin, "commit", "-m", "internal stable candidate");
    const source = git(origin, "rev-parse", "HEAD");
    git(origin, "tag", "v9.9.9-nightly.20261015.1");
    const run = (args = [], extraEnv = {}) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        [script, "--version", "1.0.0", "--commit", source, ...args],
        {
          cwd: origin,
          encoding: "utf8",
          env: { ...process.env, CI: "", BUILDKITE: "", GITHUB_ACTIONS: "", ...extraEnv },
        },
      );
    test({ root, origin, github, previous, source, write, run });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

it("previews and atomically cuts only the selected source without changing the checkout", () =>
  fixture((f) => {
    f.write("app.txt", "later internal source\n");
    git(f.origin, "add", ".");
    git(f.origin, "commit", "-m", "later internal update");
    const internalMain = git(f.origin, "rev-parse", "HEAD");
    f.write("staged.txt", "work in progress\n");
    git(f.origin, "add", "staged.txt");
    f.write("app.txt", "unstaged work\n");
    const before = git(f.origin, "status", "--porcelain");
    const preview = f.run();
    assert.equal(preview.status, 0, preview.stderr);
    assert.include(preview.stdout, "Preview only");
    assert.equal(git(f.github, "rev-parse", "main"), f.previous);
    assert.equal(git(f.github, "tag"), "");

    const cut = f.run(["--push"]);
    assert.equal(cut.status, 0, cut.stderr);
    const snapshot = git(f.github, "rev-parse", "main");
    assert.equal(git(f.github, "rev-parse", "public-v1.0.0"), snapshot);
    assert.equal(git(f.github, "rev-parse", "main^"), f.previous);
    assert.equal(git(f.github, "show", "main:app.txt"), "chosen stable source");
    assert.equal(git(f.github, "show", "main:README.md"), "Public stable downloads");
    assert.deepEqual(JSON.parse(git(f.github, "show", "main:.t3-fork/public-release.json")), {
      version: "1.0.0",
      originCommit: f.source,
    });
    const paths = git(f.github, "ls-tree", "-r", "--name-only", "main").split("\n");
    assert.deepEqual(
      paths.filter((path) => path.startsWith(".github/workflows/")),
      [".github/workflows/public-release.yml"],
    );
    assert.isFalse(paths.some((path) => path.startsWith(".buildkite/")));
    assert.equal(git(f.github, "tag"), "public-v1.0.0");
    assert.equal(git(f.origin, "status", "--porcelain"), before);
    assert.equal(git(f.origin, "rev-parse", "HEAD"), internalMain);
    const ancestry = NodeChildProcess.spawnSync(
      "git",
      ["merge-base", "--is-ancestor", f.source, snapshot],
      { cwd: f.origin },
    );
    assert.equal(ancestry.status, 1, "internal source must not become a public ancestor");
    assert.notEqual(
      NodeChildProcess.spawnSync("git", ["cat-file", "-e", f.source], { cwd: f.github }).status,
      0,
      "the push must not transfer the internal source commit",
    );
    assert.notEqual(f.run(["--push"]).status, 0, "duplicate cut must fail");
    assert.notEqual(f.run(["--version", "0.9.0", "--push"]).status, 0, "older cut must fail");
    assert.equal(git(f.github, "rev-parse", "main"), snapshot);
  }));

it("rejects CI, non-stable versions, non-main sources, and automatic public workflows", () =>
  fixture((f) => {
    assert.notEqual(f.run(["--push"], { CI: "true" }).status, 0);
    assert.notEqual(f.run(["--version", "1.0.0-nightly.1", "--push"]).status, 0);
    git(f.origin, "switch", "-c", "unmerged");
    f.write("unmerged.txt", "not yet on Origin main\n");
    git(f.origin, "add", ".");
    git(f.origin, "commit", "-m", "unmerged source");
    assert.notEqual(f.run(["--commit", git(f.origin, "rev-parse", "HEAD"), "--push"]).status, 0);
    git(f.origin, "switch", "main");
    f.write(
      ".github/workflows/public-release.yml",
      "on:\n  workflow_dispatch:\n  push:\njobs: {}\n",
    );
    git(f.origin, "add", ".");
    git(f.origin, "commit", "-m", "accidental upstream trigger");
    const invalid = f.run(["--commit", git(f.origin, "rev-parse", "HEAD"), "--push"]);
    assert.notEqual(invalid.status, 0);
    assert.include(invalid.stderr, "only a manual workflow_dispatch");
    assert.equal(git(f.github, "rev-parse", "main"), f.previous);
    assert.equal(git(f.github, "tag"), "");
  }));

it("cuts a source tree whose tracked paths exceed the default child-process buffer", () =>
  fixture((f) => {
    const blob = git(f.origin, "hash-object", "-w", "app.txt");
    const entries = Array.from(
      { length: 12_000 },
      (_, index) =>
        `100644 ${blob}\tlarge-tree/${String(index).padStart(5, "0")}-${"x".repeat(175)}\n`,
    ).join("");
    NodeChildProcess.execFileSync("git", ["update-index", "--index-info"], {
      cwd: f.origin,
      input: entries,
    });
    git(f.origin, "commit", "-m", "large source tree");
    const source = git(f.origin, "rev-parse", "HEAD");
    assert.isAbove(Buffer.byteLength(git(f.origin, "ls-files", "-z")), 2_074_157);
    const result = f.run(["--commit", source]);
    assert.equal(result.status, 0, result.stderr);
    const snapshot = /Public public-v1\.0\.0: ([a-f0-9]{40})/.exec(result.stdout)?.[1];
    assert.isString(snapshot);
    const paths = git(f.origin, "ls-tree", "-r", "--name-only", snapshot).split("\n");
    assert.equal(paths.filter((path) => path.startsWith("large-tree/")).length, 12_000);
    assert.equal(git(f.github, "rev-parse", "main"), f.previous);
  }));

it("leaves both public refs untouched when the remote rejects a cut", () =>
  fixture((f) => {
    NodeFS.writeFileSync(NodePath.join(f.github, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
    const rejected = f.run(["--push"]);
    assert.notEqual(rejected.status, 0);
    assert.equal(git(f.github, "rev-parse", "main"), f.previous);
    assert.equal(git(f.github, "tag"), "");
  }));

it("exports public mobile bundles without queueing EAS cloud builds", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../../.github/workflows/public-release.yml", import.meta.url),
    "utf8",
  );
  assert.notMatch(workflow, /queue_mobile_builds|eas-cli|EXPO_TOKEN/u);
  const mobile = workflow.split("\n  mobile:\n")[1].split("\n  web:\n")[0];
  const exportCommand = mobile.match(
    /- name: Export mobile bundles\n[\s\S]*?        run: (.+)/u,
  )[1];
  const archiveCommand = mobile
    .match(/- name: Archive mobile export\n        run: (.+)/u)[1]
    .replaceAll("${{ needs.preflight.outputs.version }}", "1.0.0");
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-mobile-export-test-"));
  try {
    NodeFS.mkdirSync(NodePath.join(root, "apps/mobile"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(root, "bin"));
    NodeFS.writeFileSync(
      NodePath.join(root, "bin/vp"),
      '#!/bin/sh\nset -eu\nprintf "%s\\n" "$@" > "$CALL_LOG"\nmkdir -p dist-public\nprintf "export fixture\\n" > dist-public/index.bundle\n',
      { mode: 0o755 },
    );
    const callLog = NodePath.join(root, "call.log");
    const result = NodeChildProcess.spawnSync(
      "bash",
      ["-c", `set -euo pipefail\ncd apps/mobile\n${exportCommand}\ncd ../..\n${archiveCommand}`],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${NodePath.join(root, "bin")}:${process.env.PATH}`,
          CALL_LOG: callLog,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(NodeFS.readFileSync(callLog, "utf8").trim().split("\n"), [
      "exec",
      "expo",
      "export",
      "--platform",
      "all",
      "--output-dir",
      "dist-public",
    ]);
    const archive = NodeChildProcess.execFileSync(
      "tar",
      ["-xOzf", NodePath.join(root, "public-mobile-1.0.0.tar.gz"), "./index.bundle"],
      { encoding: "utf8" },
    );
    assert.equal(archive, "export fixture\n");
    assert.include(mobile, "name: public-mobile");
    assert.include(mobile, "path: public-mobile-${{ needs.preflight.outputs.version }}.tar.gz");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("requires the manual cut marker and exact tag before the public workflow can build", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../../.github/workflows/public-release.yml", import.meta.url),
    "utf8",
  );
  const body = workflow
    .split("      - name: Validate version and release target\n")[1]
    .split("\n  wsl_node_pty:")[0]
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-preflight-test-"));
  try {
    NodeFS.mkdirSync(NodePath.join(root, ".t3-fork"));
    NodeFS.mkdirSync(NodePath.join(root, "bin"));
    NodeFS.writeFileSync(
      NodePath.join(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\trefs/tags/public-v1.0.0\\n" "$TAG_SHA"\n',
      { mode: 0o755 },
    );
    const sha = "a".repeat(40);
    const run = (env = {}) =>
      NodeChildProcess.spawnSync("bash", ["-c", body], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${NodePath.join(root, "bin")}:${process.env.PATH}`,
          REF: "refs/heads/main",
          VERSION: "1.0.0",
          PUBLISH_RELEASE: "false",
          GITHUB_SHA: sha,
          TAG_SHA: sha,
          GITHUB_OUTPUT: NodePath.join(root, "output"),
          ...env,
        },
      });
    assert.notEqual(run().status, 0, "an ordinary mirrored tip is not a public cut");
    NodeFS.writeFileSync(
      NodePath.join(root, ".t3-fork/public-release.json"),
      JSON.stringify({ version: "1.0.0", originCommit: "b".repeat(40) }),
    );
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.notEqual(run({ VERSION: "1.0.1" }).status, 0);
    assert.notEqual(run({ TAG_SHA: "c".repeat(40) }).status, 0);
    assert.notEqual(run({ REF: "refs/heads/feature" }).status, 0);
    assert.notEqual(run({ VERSION: "1.0.0-nightly.1" }).status, 0);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("collects the Debian updater payload and refuses publication when it is missing", () => {
  const workflow = NodeFS.readFileSync(
    new URL("../../.github/workflows/public-release.yml", import.meta.url),
    "utf8",
  );
  const collect = workflow
    .split("      - name: Collect desktop files\n")[1]
    .split("      - uses: actions/upload-artifact")[0]
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  // Execute only the local asset checks, before the publishing command.
  const validate = workflow
    .split("      - name: Publish immutable public release\n")[1]
    .split("        run: |\n")[1]
    .split("          mapfile -d '' assets")[0]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-assets-test-"));
  try {
    const release = NodePath.join(root, "release");
    NodeFS.mkdirSync(release);
    for (const file of ["T3-Code-1.0.0-x64.AppImage", "T3-Code-1.0.0-x64.deb"]) {
      NodeFS.writeFileSync(NodePath.join(release, file), "release fixture");
    }
    NodeFS.writeFileSync(
      NodePath.join(release, "latest-linux.yml"),
      "version: 1.0.0\nfiles:\n  - url: T3-Code-1.0.0-x64.AppImage\n  - url: T3-Code-1.0.0-x64.deb\n",
    );
    const collected = NodeChildProcess.spawnSync("bash", ["-c", collect], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(collected.status, 0, collected.stderr);
    const assets = NodePath.join(root, "public-release-assets");
    NodeFS.renameSync(NodePath.join(root, "public-desktop"), assets);
    const manifest = NodeFS.readFileSync(NodePath.join(assets, "latest-linux.yml"), "utf8");
    for (const [, file] of manifest.matchAll(/url: (.+)/g)) {
      assert.isTrue(
        NodeFS.existsSync(NodePath.join(assets, file)),
        `missing updater file: ${file}`,
      );
    }
    for (const file of [
      "latest-mac.yml",
      "latest.yml",
      "t3.tgz",
      "install.sh",
      "public-mobile-1.0.0.tar.gz",
      "public-web-1.0.0.tar.gz",
      "T3-Code-1.0.0-arm64.dmg",
      "T3-Code-1.0.0-arm64.zip",
      "T3-Code-1.0.0-x64.exe",
    ]) {
      NodeFS.writeFileSync(NodePath.join(assets, file), "release fixture");
    }
    const check = () =>
      NodeChildProcess.spawnSync("bash", ["-c", validate], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, VERSION: "1.0.0" },
      });
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    NodeFS.unlinkSync(NodePath.join(assets, "T3-Code-1.0.0-x64.deb"));
    const missing = check();
    assert.notEqual(missing.status, 0);
    assert.include(missing.stderr, "missing required public release asset matching *.deb");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
