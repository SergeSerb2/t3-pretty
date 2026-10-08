import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const modules = NodeFS.readFileSync(NodePath.join(root, ".gitmodules"), "utf8");
const gitlinks = NodeChildProcess.execFileSync("git", ["ls-files", "--stage"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
})
  .split("\n")
  .filter((line) => line.startsWith("160000 "))
  .map((line) => line.split("\t")[1]);

describe("vendored reference gitlinks", () => {
  it("allows the agent's recursive pre-clean after a normal clone", () => {
    const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-reference-gitlinks-"));
    const source = NodePath.join(temp, "source");
    const checkout = NodePath.join(temp, "checkout");
    const git = (args, cwd = source) =>
      NodeChildProcess.execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    try {
      NodeFS.mkdirSync(source);
      git(["init", "--quiet"]);
      git(["config", "user.name", "Checkout fixture"]);
      git(["config", "user.email", "checkout-fixture@example.invalid"]);
      NodeFS.writeFileSync(NodePath.join(source, ".gitmodules"), modules);
      git(["add", ".gitmodules"]);
      git(["commit", "--quiet", "-m", "Reference metadata"]);
      const commit = git(["rev-parse", "HEAD"]).trim();
      assert.isNotEmpty(gitlinks);
      for (const path of gitlinks)
        git(["update-index", "--add", "--cacheinfo", `160000,${commit},${path}`]);
      git(["commit", "--quiet", "-m", "Tracked reference gitlinks"]);
      git(["clone", "--quiet", source, checkout]);
      git(["submodule", "foreach", "--recursive", "git clean -ffxdq"], checkout);
      assert.equal(git(["rev-parse", "HEAD"], checkout), git(["rev-parse", "HEAD"]));
      // Removing either actual path reproduces the hosted agent's failure.
      for (const path of gitlinks) {
        const broken = modules.replace(`path = ${path}`, `path = ${path}-missing`);
        assert.notEqual(broken, modules);
        NodeFS.writeFileSync(NodePath.join(checkout, ".gitmodules"), broken);
        const result = NodeChildProcess.spawnSync(
          "git",
          ["submodule", "foreach", "--recursive", "git clean -ffxdq"],
          {
            cwd: checkout,
            encoding: "utf8",
          },
        );
        assert.equal(result.status, 128);
        assert.include(result.stderr, "No url found for submodule path");
      }
    } finally {
      NodeFS.rmSync(temp, { recursive: true, force: true });
    }
  });
});
