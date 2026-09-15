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
const androidRelease = NodeFS.readFileSync(
  NodePath.resolve(here, "publish-android-release.sh"),
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

function runHelper(home, path, env, body) {
  return NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
source "$1"
${body}`,
      "ensure-vite-plus-helper-test",
      helper,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: path,
        HOME: home,
        VP_HOME: NodePath.join(home, ".vite-plus"),
        ...env,
      },
    },
  );
}

function writeFakeNpm(root, { hangWithoutAnswer = true } = {}) {
  const prefix = NodePath.join(root, "npm-prefix");
  const bin = NodePath.join(root, "fake-bin");
  NodeFS.mkdirSync(bin, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(bin, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  prefix)
    [[ "\${2:-}" == "-g" ]]
    printf '%s\\n' "${prefix}"
    ;;
  install)
    mkdir -p "${prefix}/bin"
    printf '%s\\n' '#!/bin/bash' 'echo eas 1.0.0' > "${prefix}/bin/eas"
    chmod +x "${prefix}/bin/eas"
    echo "'eas' is not available on your PATH."
    echo "Create a link in ~/.vite-plus/bin/ to make it available? [Y/n]"
    if ${hangWithoutAnswer ? "true" : "false"}; then
      read -r answer
    else
      read -r answer || true
    fi
    printf '%s\\n' "\${answer:-}" > "${prefix}/npm-stdin"
    ;;
  *)
    echo "unexpected npm $*" >&2
    exit 1
    ;;
esac
`,
    { mode: 0o755 },
  );
  return { prefix, bin };
}

describe("vite_plus global CLI link", () => {
  it("is used by iOS and Android publish instead of a raw npm install -g", () => {
    assert.include(mobileRelease, "vite_plus_install_global_cli eas-cli eas");
    assert.include(androidRelease, 'source "$root/scripts/fork/ensure-vite-plus.sh"');
    assert.include(androidRelease, "vite_plus_install_global_cli eas-cli eas");
    assert.notInclude(mobileRelease, "npm install -g eas-cli");
    assert.notInclude(androidRelease, "npm install -g eas-cli");
  });

  it("treats CI, Buildkite, and a non-TTY stdin as auto-link", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-ci-"));
    try {
      const ci = runHelper(root, "/usr/bin:/bin", { CI: "true" }, `vite_plus_noninteractive`);
      assert.equal(ci.status, 0, ci.stderr);
      const buildkite = runHelper(
        root,
        "/usr/bin:/bin",
        { BUILDKITE: "true" },
        `vite_plus_noninteractive`,
      );
      assert.equal(buildkite.status, 0, buildkite.stderr);
      const nonTty = NodeChildProcess.spawnSync(
        "bash",
        [
          "-c",
          `set -euo pipefail
source "$1"
vite_plus_noninteractive`,
          "ensure-vite-plus-nontty-test",
          helper,
        ],
        {
          encoding: "utf8",
          input: "",
          env: {
            PATH: "/usr/bin:/bin",
            HOME: root,
            VP_HOME: NodePath.join(root, ".vite-plus"),
          },
        },
      );
      assert.equal(nonTty.status, 0, nonTty.stderr);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a VP_HOME/bin link without prompting", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-link-"));
    try {
      const srcDir = NodePath.join(root, "src");
      NodeFS.mkdirSync(srcDir);
      const src = NodePath.join(srcDir, "eas");
      NodeFS.writeFileSync(src, "#!/bin/bash\necho eas\n", { mode: 0o755 });
      const result = runHelper(
        root,
        "/usr/bin:/bin",
        { CI: "true" },
        `vite_plus_link_bin eas ${JSON.stringify(src)}
test -x "$(vite_plus_home)/bin/eas"`,
      );
      assert.equal(result.status, 0, result.stderr);
      const dest = NodePath.join(root, ".vite-plus", "bin", "eas");
      assert.isTrue(NodeFS.existsSync(dest));
      assert.equal(NodeFS.readlinkSync(dest), src);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("answers the Vite+ bin-link prompt on CI and leaves eas on PATH", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-eas-"));
    try {
      const { prefix, bin } = writeFakeNpm(root);
      const result = runHelper(
        root,
        `${bin}:/usr/bin:/bin`,
        { CI: "true" },
        `vite_plus_install_global_cli eas-cli eas
command -v eas
eas --version`,
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(NodeFS.readFileSync(NodePath.join(prefix, "npm-stdin"), "utf8"), "y");
      const linked = NodePath.join(root, ".vite-plus", "bin", "eas");
      assert.isTrue(NodeFS.existsSync(linked));
      assert.include(result.stdout, "eas 1.0.0");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses an existing eas and does not run npm install", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-eas-reuse-"));
    try {
      const existing = NodePath.join(root, "existing");
      NodeFS.mkdirSync(existing);
      NodeFS.writeFileSync(NodePath.join(existing, "eas"), "#!/bin/bash\necho eas existing\n", {
        mode: 0o755,
      });
      const { bin } = writeFakeNpm(root);
      const result = runHelper(
        root,
        `${existing}:${bin}:/usr/bin:/bin`,
        { CI: "true" },
        `vite_plus_install_global_cli eas-cli eas
eas --version`,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.include(result.stdout, "eas existing");
      assert.isFalse(NodeFS.existsSync(NodePath.join(root, "npm-prefix", "npm-stdin")));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
