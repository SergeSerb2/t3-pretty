import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const helper = NodePath.resolve(here, "ensure-vite-plus.sh");
const mobileRelease = NodeFS.readFileSync(
  NodePath.resolve(here, "publish-mobile-release.sh"),
  "utf8",
);

function runEnsure({ home, path, installer, purpose = "to publish mobile OTA" }) {
  return NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
source "$1"
ensure_vite_plus "$2"`,
      "ensure-vite-plus-test",
      helper,
      purpose,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: path,
        HOME: home,
        VP_HOME: NodePath.join(home, ".vite-plus"),
        ...(installer ? { T3CODE_VITE_PLUS_INSTALLER: installer } : {}),
      },
    },
  );
}

function writeInstaller(root, body) {
  const installer = NodePath.join(root, "install-vite-plus.sh");
  NodeFS.writeFileSync(installer, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o755,
  });
  return installer;
}

describe("ensure-vite-plus", () => {
  it("is sourced by the iOS publish script instead of a macos-release hard fail", () => {
    assert.include(mobileRelease, 'source "$root/scripts/fork/ensure-vite-plus.sh"');
    assert.include(mobileRelease, 'ensure_vite_plus "to publish mobile OTA"');
    assert.notInclude(mobileRelease, "vp is required on macos-release to publish mobile OTA.");
    assert.include(
      mobileRelease,
      "No Origin git-credentials store on this agent; keeping current tree.",
    );
    assert.isBelow(
      mobileRelease.indexOf('source "$root/scripts/fork/ensure-vite-plus.sh"'),
      mobileRelease.indexOf('ensure_vite_plus "to publish mobile OTA"'),
    );
  });

  it("installs Vite+ into the pinned home when vp is missing", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-fresh-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      const installer = writeInstaller(
        root,
        `mkdir -p "${bin}"
printf '%s\\n' '#!/bin/bash' 'echo vp 1.0.0' > "${bin}/vp"
chmod +x "${bin}/vp"`,
      );
      const result = runEnsure({
        home: root,
        path: "/usr/bin:/bin",
        installer,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.include(result.stdout, "vp is missing; installing Vite+ into");
      assert.include(result.stdout, NodePath.join(root, ".vite-plus"));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses an existing official vp and does not run the installer", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-existing-"));
    try {
      const existingBin = NodePath.join(root, "existing-bin");
      NodeFS.mkdirSync(existingBin);
      NodeFS.writeFileSync(NodePath.join(existingBin, "vp"), "#!/bin/bash\necho 'vp 9.9.9'\n", {
        mode: 0o755,
      });
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runEnsure({
        home: root,
        path: `${existingBin}:/usr/bin:/bin`,
        installer,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops the job when the installer fails", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-fail-"));
    try {
      const installer = writeInstaller(root, 'echo "download failed" >&2; exit 1');
      const result = runEnsure({
        home: root,
        path: "/usr/bin:/bin",
        installer,
      });
      assert.notEqual(result.status, 0);
      assert.include(result.stderr, "download failed");
      assert.include(result.stderr, "Vite+ install failed; vp is required to publish mobile OTA.");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
