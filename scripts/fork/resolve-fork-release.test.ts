// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "resolve-fork-release.mjs",
);

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

it("emits a fork-specific semver tag that electron-updater can match to nightly", () => {
  const fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-release-"));

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043");

    const output = NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, GITHUB_RUN_NUMBER: "15", GITHUB_OUTPUT: "" },
    });
    const metadata = JSON.parse(output) as {
      readonly minted: string;
      readonly version: string;
      readonly tag: string;
      readonly upstream_tag: string;
      readonly name: string;
    };

    assert.equal(metadata.minted, "true");
    assert.equal(metadata.version, "0.0.33-nightly.20260809.1043000015");
    assert.equal(metadata.tag, "v0.0.33-nightly.20260809.1043000015.fork");
    const printed = NodeChildProcess.execFileSync(
      process.execPath,
      [scriptPath, "--print", "version"],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: { ...process.env, GITHUB_RUN_NUMBER: "15", GITHUB_OUTPUT: "" },
      },
    ).trim();
    assert.equal(printed, metadata.version);
    assert.equal(metadata.upstream_tag, "v0.0.33-nightly.20260809.1043");
    assert.equal(metadata.name, "T3 Pretty 0.0.33-nightly.20260809.1043000015");
    assert.match(metadata.tag, /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.fork$/u);

    const buildkiteOutput = NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_RUN_NUMBER: "0",
        BUILDKITE_BUILD_NUMBER: "39",
        GITHUB_OUTPUT: "",
      },
    });
    const buildkiteMetadata = JSON.parse(buildkiteOutput) as { readonly version: string };
    assert.equal(buildkiteMetadata.version, "0.0.33-nightly.20260809.1043000039");
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

it("does not reuse a version from a non-automated docs(changelog) subject", () => {
  const fixtureRoot = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t3-fork-changelog-manual-"),
  );

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043");
    git(fixtureRoot, "commit", "--allow-empty", "-m", "docs(changelog): tweak wording");

    const minted = JSON.parse(
      NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_RUN_NUMBER: "15",
          GITHUB_OUTPUT: "",
        },
      }),
    ) as { readonly version: string };

    assert.equal(minted.version, "0.0.33-nightly.20260809.1043000015");
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

it("reuses the version already recorded on a changelog commit", () => {
  const fixtureRoot = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t3-fork-changelog-reuse-"),
  );

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043");
    git(
      fixtureRoot,
      "commit",
      "--allow-empty",
      "-m",
      "docs(changelog): add release notes through v0.0.33-nightly.20260809.1043000015",
    );

    const reused = JSON.parse(
      NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_RUN_NUMBER: "99",
          GITHUB_OUTPUT: "",
        },
      }),
    ) as {
      readonly minted: string;
      readonly version: string;
      readonly tag: string;
      readonly upstream_tag: string;
    };

    assert.equal(reused.minted, "true");
    assert.equal(reused.version, "0.0.33-nightly.20260809.1043000015");
    assert.equal(reused.tag, "v0.0.33-nightly.20260809.1043000015.fork");
    assert.equal(reused.upstream_tag, "v0.0.33-nightly.20260809.1043");

    const orphanRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-fork-changelog-orphan-"),
    );
    try {
      git(orphanRoot, "init");
      git(orphanRoot, "config", "user.name", "T3 Fork Release Test");
      git(orphanRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
      NodeFS.writeFileSync(NodePath.join(orphanRoot, "fixture.txt"), "fixture\n");
      git(orphanRoot, "add", "fixture.txt");
      git(
        orphanRoot,
        "commit",
        "-m",
        "docs(changelog): add release notes through v0.0.33-nightly.20260809.1043000015",
      );
      const orphanOutput = NodePath.join(orphanRoot, "github-output");
      NodeFS.writeFileSync(orphanOutput, "");
      const orphan = NodeChildProcess.spawnSync(process.execPath, [scriptPath], {
        cwd: orphanRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: orphanOutput,
          T3_SKIP_UNRESOLVABLE_MINT: "1",
          GITHUB_RUN_NUMBER: "99",
        },
      });
      assert.equal(orphan.status, 0);
      assert.match(NodeFS.readFileSync(orphanOutput, "utf8"), /minted=true/u);
      assert.match(
        NodeFS.readFileSync(orphanOutput, "utf8"),
        /version=0\.0\.33-nightly\.20260809\.1043000015/u,
      );
    } finally {
      NodeFS.rmSync(orphanRoot, { recursive: true, force: true });
    }
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

it("skips imported minting when no upstream nightly is an ancestor of HEAD", () => {
  const fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-release-skip-"));
  const outputPath = NodePath.join(fixtureRoot, "github-output");

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    NodeFS.writeFileSync(outputPath, "");

    const githubOutputOnly = NodeChildProcess.spawnSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: outputPath, T3_SKIP_UNRESOLVABLE_MINT: "" },
    });
    assert.notEqual(githubOutputOnly.status, 0);
    assert.match(
      githubOutputOnly.stderr,
      /No integrated upstream nightly tag is an ancestor of HEAD/,
    );
    assert.equal(/skipping imported version mint/u.test(githubOutputOnly.stderr), false);
    assert.equal(NodeFS.readFileSync(outputPath, "utf8"), "");

    const skipped = NodeChildProcess.spawnSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        T3_SKIP_UNRESOLVABLE_MINT: "1",
      },
    });
    assert.equal(skipped.status, 0);
    assert.match(skipped.stderr, /skipping imported version mint/);
    assert.equal(NodeFS.readFileSync(outputPath, "utf8"), "minted=false\n");

    const printed = NodeChildProcess.spawnSync(
      process.execPath,
      [scriptPath, "--print", "version"],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          T3_SKIP_UNRESOLVABLE_MINT: "1",
        },
      },
    );
    assert.notEqual(printed.status, 0);
    assert.match(printed.stderr, /No integrated upstream nightly tag is an ancestor of HEAD/);
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

it("keeps a later CI run newer than an already-shipped fork tag", () => {
  const fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-release-mono-"));

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043367814.fork");

    const bumped = JSON.parse(
      NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_RUN_NUMBER: "0",
          BUILDKITE_BUILD_NUMBER: "87",
          GITHUB_OUTPUT: "",
        },
      }),
    ) as { readonly version: string; readonly tag: string };

    assert.equal(bumped.version, "0.0.33-nightly.20260809.1043367815");
    assert.equal(bumped.tag, "v0.0.33-nightly.20260809.1043367815.fork");

    const stillAhead = JSON.parse(
      NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_RUN_NUMBER: "0",
          BUILDKITE_BUILD_NUMBER: "367900",
          GITHUB_OUTPUT: "",
        },
      }),
    ) as { readonly version: string };

    assert.equal(stillAhead.version, "0.0.33-nightly.20260809.1043367900");
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
