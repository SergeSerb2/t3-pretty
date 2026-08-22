import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const script = NodePath.resolve(here, "macos-origin-git.sh");

function makeHome() {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-origin-git-"));
  const store = NodePath.join(home, ".git-credentials");
  NodeFS.writeFileSync(store, "https://x-access-token:token@origin.cursor.com\n");
  return { home, store };
}

function envFor(home, store) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    ORIGIN_GIT_CREDENTIALS: store,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function run(home, store) {
  return NodeChildProcess.execFileSync("bash", [script], {
    encoding: "utf8",
    env: envFor(home, store),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function helpers(home, store) {
  return NodeChildProcess.execFileSync(
    "git",
    ["config", "--global", "--get-all", "credential.https://origin.cursor.com.helper"],
    {
      encoding: "utf8",
      env: envFor(home, store),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

describe("macos-origin-git pre-checkout hook", () => {
  it("writes the file store even when origin credential-helper is already set", () => {
    const { home, store } = makeHome();
    try {
      const bin = NodePath.join(home, ".local", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "origin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const env = envFor(home, store);
      env.PATH = `${bin}${NodePath.delimiter}${env.PATH}`;
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com.helper",
          "!origin credential-helper",
        ],
        { env, stdio: "ignore" },
      );
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com/git.helper",
          "!origin credential-helper",
        ],
        { env, stdio: "ignore" },
      );
      const out = NodeChildProcess.execFileSync("bash", [script], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.include(out, "Origin git store helper ready");
      assert.include(helpers(home, store), `store --file=${store}`);
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });

  it("treats an empty git-credentials file like a missing store", () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-origin-git-empty-"));
    try {
      const bin = NodePath.join(home, ".local", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "origin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const store = NodePath.join(home, ".git-credentials");
      NodeFS.writeFileSync(store, "");
      const env = {
        PATH: `${bin}${NodePath.delimiter}${process.env.PATH}`,
        HOME: home,
        ORIGIN_GIT_CREDENTIALS: store,
        GIT_CONFIG_NOSYSTEM: "1",
      };
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com.helper",
          `store --file=${store}`,
        ],
        { env, stdio: "ignore" },
      );
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com/git.helper",
          `store --file=${store}`,
        ],
        { env, stdio: "ignore" },
      );
      const out = NodeChildProcess.execFileSync("bash", [script], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.include(out, "Origin git CLI helper ready");
      const helpersOut = NodeChildProcess.execFileSync(
        "git",
        ["config", "--global", "--get-all", "credential.https://origin.cursor.com.helper"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      );
      assert.include(helpersOut, "origin credential-helper");
      assert.notInclude(helpersOut, `store --file=${store}`);
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });

  it("accepts origin credential-helper without a git-credentials file", () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-origin-git-cli-"));
    try {
      const bin = NodePath.join(home, ".local", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "origin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const env = {
        PATH: `${bin}${NodePath.delimiter}${process.env.PATH}`,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: "1",
      };
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com.helper",
          "!origin credential-helper",
        ],
        { env, stdio: "ignore" },
      );
      NodeChildProcess.execFileSync(
        "git",
        [
          "config",
          "--global",
          "credential.https://origin.cursor.com/git.helper",
          "!origin credential-helper",
        ],
        { env, stdio: "ignore" },
      );
      const out = NodeChildProcess.execFileSync("bash", [script], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.include(out, "Origin git CLI helper ready");
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".git-credentials")));
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });

  it("writes the Origin store helper and skips later writes", () => {
    const { home, store } = makeHome();
    try {
      const first = run(home, store);
      assert.include(first, "Origin git store helper ready");
      assert.include(helpers(home, store), `store --file=${store}`);

      const lock = NodePath.join(home, ".gitconfig.lock");
      NodeFS.writeFileSync(lock, "");
      const second = run(home, store);
      assert.include(second, "Origin git store helper ready");
      assert.isTrue(NodeFS.existsSync(lock), "skip path must not need the gitconfig lock");
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });

  it("removes a stale gitconfig lock when the helper still needs writing", () => {
    const { home, store } = makeHome();
    try {
      const lock = NodePath.join(home, ".gitconfig.lock");
      NodeFS.writeFileSync(lock, "");
      const stale = new Date(Date.now() - 60_000);
      NodeFS.utimesSync(lock, stale, stale);

      const out = run(home, store);
      assert.include(out, "Removing stale");
      assert.include(out, "Origin git store helper ready");
      assert.include(helpers(home, store), `store --file=${store}`);
      assert.isFalse(NodeFS.existsSync(lock));
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });

  it("serializes two first-time writers onto one gitconfig", async () => {
    const { home, store } = makeHome();
    const spawnOne = () =>
      new Promise((resolve, reject) => {
        const child = NodeChildProcess.spawn("bash", [script], {
          env: envFor(home, store),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (code) => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`exit ${code}: ${stderr}`));
        });
      });

    try {
      const outputs = await Promise.all([spawnOne(), spawnOne()]);
      for (const out of outputs) {
        assert.include(out, "Origin git store helper ready");
      }
      assert.include(helpers(home, store), `store --file=${store}`);
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });
});
