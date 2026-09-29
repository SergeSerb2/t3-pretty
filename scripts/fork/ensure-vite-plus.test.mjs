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

  it("does not treat a vp that cannot exec as official", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-dead-"));
    try {
      const existingBin = NodePath.join(root, "existing-bin");
      NodeFS.mkdirSync(existingBin);
      NodeFS.writeFileSync(NodePath.join(existingBin, "vp"), "#!/bin/bash\nexit 126\n", {
        mode: 0o755,
      });
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runEnsure({
        home: root,
        path: `${existingBin}:/usr/bin:/bin`,
        installer,
      });
      assert.notEqual(result.status, 0);
      assert.include(result.stdout, "vp is missing; installing Vite+ into");
      assert.include(result.stderr, "installer ran");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeFakeCmdExe(root) {
  const bin = NodePath.join(root, "cmd-bin");
  NodeFS.mkdirSync(bin, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(bin, "cmd.exe"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "//c" || "\${1:-}" == "/c" ]]; then
  shift
fi
target="\${1:-}"
shift || true
printf '%s\\n' "cmd.exe launched \${target}"
if [[ -f "\$target" ]]; then
  exec bash "\$target" "\$@"
fi
exit 127
`,
    { mode: 0o755 },
  );
  return bin;
}

function runWindowsHelper({ home, path, body, installer, env }) {
  return NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
uname() {
  if [[ "\${1:-}" == "-s" ]]; then
    printf '%s\\n' 'MINGW64_NT-10.0-26340'
    return 0
  fi
  command uname "\$@"
}
source "$1"
${body}`,
      "ensure-vite-plus-windows-test",
      helper,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: path,
        HOME: home,
        VP_HOME: NodePath.join(home, ".vite-plus"),
        ...(installer ? { T3CODE_VITE_PLUS_INSTALLER: installer } : {}),
        ...env,
      },
    },
  );
}

describe("ensure-vite-plus Windows Git Bash", () => {
  it("documents the vp.exe Git Bash launch and prefers it over an unexecutable vp", () => {
    assert.include(NodeFS.readFileSync(helper, "utf8"), "vp.exe");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "MINGW");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "exit 126");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "cmd.exe");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "vite_plus_cli_launchable");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "vite_plus_is_agent_prefix");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "vite_plus_relocate_home_if_needed");
    assert.include(NodeFS.readFileSync(helper, "utf8"), "BK #2842");
    assert.include(mobileRelease, 'source "$root/scripts/fork/ensure-vite-plus.sh"');
    assert.include(mobileRelease, "vp i --filter=@t3tools/mobile");
    assert.notInclude(mobileRelease, "T3CODE_FORCE_IOS=");

    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-exe-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp"), "#!/bin/bash\necho shadowed\nexit 126\n", {
        mode: 0o644,
      });
      NodeFS.writeFileSync(NodePath.join(bin, "vp.exe"), "#!/bin/bash\necho 'vp.exe 9.9.9'\n", {
        mode: 0o755,
      });
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        body: `vite_plus_on_path
vp --version
vp i --filter=@t3tools/mobile...`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(result.stdout, "vp.exe 9.9.9");
      assert.notInclude(result.stdout, "shadowed");
      assert.equal((result.stdout.match(/vp\.exe 9\.9\.9/g) || []).length, 2);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs a shebang vp without +x and does not reinstall", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-shebang-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp"), "#!/bin/bash\necho 'vp 3.2.1'\n", {
        mode: 0o644,
      });
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        body: `ensure_vite_plus "to publish mobile OTA"`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("installs when only an unexecutable non-script vp is present", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-dead-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp"), "not a program\n", { mode: 0o644 });
      const installer = writeInstaller(
        root,
        `printf '%s\\n' '#!/bin/bash' 'echo vp.exe 1.0.0' > "${bin}/vp.exe"
chmod +x "${bin}/vp.exe"`,
      );
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        body: `ensure_vite_plus "to publish mobile OTA"
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(result.stdout, "vp is missing; installing Vite+ into");
      assert.include(result.stdout, "vp.exe 1.0.0");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses a versioned vp.exe without installing into a locked prefix", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-versioned-"));
    try {
      const versionedBin = NodePath.join(root, ".vite-plus", "1.0.0-rc.0", "bin");
      NodeFS.mkdirSync(versionedBin, { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, ".vite-plus", "bin"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(versionedBin, "vp.exe"),
        "#!/bin/bash\necho 'vp.exe 1.0.0-rc.0'\n",
        { mode: 0o755 },
      );
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        body: `ensure_vite_plus "to publish mobile OTA"
vp --version
vite_plus_resolve_cli vp`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      assert.include(result.stdout, "vp.exe 1.0.0-rc.0");
      assert.include(result.stdout, `${versionedBin}/vp.exe`);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs a versioned extensionless vp PE without reinstalling", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-ver-pe-"));
    try {
      const versionedBin = NodePath.join(root, ".vite-plus", "1.0.0-rc.0", "bin");
      NodeFS.mkdirSync(versionedBin, { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, ".vite-plus", "bin"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(versionedBin, "vp"),
        "MZ#!/bin/bash\necho 'vp.exe versioned'\n",
        {
          mode: 0o644,
        },
      );
      const tmp = NodePath.join(root, "tmp");
      NodeFS.mkdirSync(tmp);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { TMPDIR: tmp },
        body: `cp() {
  if [[ "\${2:-}" == *.exe && "\${2:-}" == *"/1.0.0-rc.0/bin/"* ]]; then
    echo "Access is denied. (os error 5)" >&2
    return 1
  fi
  command cp "\$@"
}
ensure_vite_plus "to publish mobile OTA"
vite_plus_resolve_cli vp`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      const repairedHome = NodePath.join(root, ".vite-plus", "bin", "vp.exe");
      const repairedTmp = NodePath.join(tmp, "t3-vite-plus", "bin", "vp.exe");
      assert.isTrue(
        NodeFS.existsSync(repairedHome) || NodeFS.existsSync(repairedTmp),
        result.stdout,
      );
      assert.ok(
        result.stdout.includes(repairedHome) || result.stdout.includes(repairedTmp),
        result.stdout,
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies a locked-prefix vp.exe when --version fails with Access denied", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-verfail-"));
    try {
      const lockedHome = NodePath.join(root, "buildkite-agent", "vite-plus");
      const lockedBin = NodePath.join(lockedHome, "bin");
      NodeFS.mkdirSync(lockedBin, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(lockedBin, "vp.exe"),
        `#!/bin/bash
case "$0" in
  */buildkite-agent/vite-plus/*)
    echo 'Access is denied. (os error 5)' >&2
    exit 1
    ;;
esac
echo 'vp.exe writable'
`,
        { mode: 0o755 },
      );
      const tmp = NodePath.join(root, "tmp");
      NodeFS.mkdirSync(tmp);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { TMPDIR: tmp, VP_HOME: lockedHome },
        body: `ensure_vite_plus "to publish mobile OTA"
vite_plus_resolve_cli vp
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      const copied = NodePath.join(root, ".vite-plus", "bin", "vp.exe");
      assert.include(result.stdout, copied);
      assert.isTrue(NodeFS.existsSync(copied));
      assert.include(result.stdout, "vp.exe writable");
      assert.notInclude(result.stdout, `${lockedBin}/vp.exe`);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies an extensionless PE to a writable bin when in-place vp.exe is denied", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-copy-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp"), "MZ#!/bin/bash\necho 'vp.exe repaired'\n", {
        mode: 0o644,
      });
      const tmp = NodePath.join(root, "tmp");
      NodeFS.mkdirSync(tmp);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { TMPDIR: tmp },
        body: `cp() {
  if [[ "\${2:-}" == *.exe && "\${2:-}" == *".vite-plus/bin/"* ]]; then
    echo "Access is denied. (os error 5)" >&2
    return 1
  fi
  command cp "\$@"
}
ensure_vite_plus "to publish mobile OTA"
vite_plus_resolve_cli vp`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      const repaired = NodePath.join(tmp, "t3-vite-plus", "bin", "vp.exe");
      assert.include(result.stdout, repaired);
      assert.isTrue(NodeFS.existsSync(repaired));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("installs into a writable prefix when the agent VP_HOME is locked", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-locked-"));
    try {
      const locked = NodePath.join(root, "locked-vite-plus");
      const fallback = NodePath.join(root, "writable-vite-plus");
      NodeFS.mkdirSync(NodePath.join(locked, "bin"), { recursive: true });
      const installer = writeInstaller(
        root,
        `mkdir -p "${fallback}/bin"
printf '%s\\n' '#!/bin/bash' 'echo vp.exe fallback' > "${fallback}/bin/vp.exe"
chmod +x "${fallback}/bin/vp.exe"`,
      );
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        body: `VP_HOME=${JSON.stringify(locked)}
export VP_HOME
vite_plus_dir_writable() {
  case "$1" in
    ${JSON.stringify(locked)} | ${JSON.stringify(`${locked}/bin`)}) return 1 ;;
    ${JSON.stringify(fallback)} | ${JSON.stringify(`${fallback}/bin`)}) return 0 ;;
  esac
  mkdir -p "$1" 2>/dev/null || return 1
  local probe="$1/.t3-vp-write-$$"
  : > "$probe" 2>/dev/null || return 1
  rm -f "$probe"
}
vite_plus_writable_home() { printf '%s\\n' ${JSON.stringify(fallback)}; }
ensure_vite_plus "to publish mobile OTA"
printf 'home=%s\\n' "$(vite_plus_home)"
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(result.stdout, "is not writable");
      assert.include(result.stdout, fallback);
      assert.notInclude(result.stdout, "Vite+ install failed");
      assert.include(result.stdout, `home=${fallback}`);
      assert.include(result.stdout, "vp.exe fallback");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("relocates off a writable agent prefix before --version so rust does not write .tmp there", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-bk2842-"));
    try {
      const agentHome = NodePath.join(root, "buildkite-agent", "vite-plus");
      const versionedBin = NodePath.join(agentHome, "1.0.0-rc.0", "bin");
      NodeFS.mkdirSync(versionedBin, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(versionedBin, "vp.exe"),
        `#!/bin/bash
if [[ "\${VP_HOME:-}" == *"/buildkite-agent/vite-plus"* ]]; then
  echo 'error: Command execution failed: Access is denied. (os error 5) at path "C:/buildkite-agent/vite-plus\\\\1.0.0-rc.0\\\\bin\\\\.tmpTNsNMM"' >&2
  exit 1
fi
echo 'vp.exe relocated'
`,
        { mode: 0o755 },
      );
      const installer = writeInstaller(
        root,
        `echo "installer ran into \${VP_HOME}" >&2
if [[ "\${VP_HOME}" == *"/buildkite-agent/vite-plus" ]]; then
  echo 'error: Access is denied. (os error 5) at path "C:/buildkite-agent/vite-plus\\\\1.0.0-rc.0\\\\bin\\\\.tmpTNsNMM"' >&2
  exit 1
fi
exit 1`,
      );
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { VP_HOME: agentHome },
        body: `ensure_vite_plus "to publish mobile OTA"
printf 'home=%s\\n' "$(vite_plus_home)"
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(result.stdout, "is not writable");
      assert.include(result.stdout, NodePath.join(root, ".vite-plus"));
      assert.notInclude(result.stdout, `installing Vite+ into ${agentHome}`);
      assert.notInclude(result.stderr, "installer ran");
      assert.include(result.stdout, `home=${NodePath.join(root, ".vite-plus")}`);
      assert.include(result.stdout, "vp.exe relocated");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("installs into a user prefix when the writable agent tree has no launchable vp", () => {
    const root = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-bk2842-miss-"),
    );
    try {
      const agentHome = NodePath.join(root, "buildkite-agent", "vite-plus");
      const fallback = NodePath.join(root, ".vite-plus");
      NodeFS.mkdirSync(NodePath.join(agentHome, "1.0.0-rc.0", "bin"), { recursive: true });
      const installer = writeInstaller(
        root,
        `if [[ "\${VP_HOME}" == *"/buildkite-agent/vite-plus" ]]; then
  echo 'error: Access is denied. (os error 5) at path "C:/buildkite-agent/vite-plus\\\\1.0.0-rc.0\\\\bin\\\\.tmpTNsNMM"' >&2
  exit 1
fi
mkdir -p "\${VP_HOME}/bin"
printf '%s\\n' '#!/bin/bash' 'echo vp.exe user prefix' > "\${VP_HOME}/bin/vp.exe"
chmod +x "\${VP_HOME}/bin/vp.exe"`,
      );
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { VP_HOME: agentHome },
        body: `ensure_vite_plus "to publish mobile OTA"
printf 'home=%s\\n' "$(vite_plus_home)"
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.include(result.stdout, "is not writable");
      assert.include(result.stdout, fallback);
      assert.notInclude(result.stdout, `installing Vite+ into ${agentHome}`);
      assert.notInclude(result.stderr, "Access is denied");
      assert.include(result.stdout, `home=${fallback}`);
      assert.include(result.stdout, "vp.exe user prefix");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("launches a Git Bash-unexecutable vp.exe through cmd.exe without reinstalling", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-cmd-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp.exe"), "#!/bin/bash\necho 'vp.exe via cmd'\n", {
        mode: 0o644,
      });
      const cmdBin = writeFakeCmdExe(root);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: `${cmdBin}:/usr/bin:/bin`,
        installer,
        body: `ensure_vite_plus "to publish mobile OTA"
vp --version
vite_plus_resolve_cli vp`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      assert.include(result.stdout, "cmd.exe launched");
      assert.include(result.stdout, "vp.exe via cmd");
      assert.include(result.stdout, `${bin}/vp.exe`);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies to a job temp when src is already the first writable vp.exe", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-dest-src-"));
    try {
      const lockedHome = NodePath.join(root, "buildkite-agent", "vite-plus");
      NodeFS.mkdirSync(NodePath.join(lockedHome, "bin"), { recursive: true });
      const homeBin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(homeBin, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(homeBin, "vp.exe"),
        "#!/bin/bash\necho 'vp.exe fallback copy'\n",
        {
          mode: 0o644,
        },
      );
      const tmp = NodePath.join(root, "tmp");
      NodeFS.mkdirSync(tmp);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: `${homeBin}:/usr/bin:/bin`,
        installer,
        env: { TMPDIR: tmp, VP_HOME: lockedHome },
        body: `chmod() {
  if [[ "\${1:-}" == "+x" && "\${2:-}" == *".vite-plus/bin/vp.exe" ]]; then
    return 1
  fi
  command chmod "\$@"
}
ensure_vite_plus "to publish mobile OTA"
vite_plus_resolve_cli vp
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      const copied = NodePath.join(tmp, "t3-vite-plus", "bin", "vp.exe");
      assert.include(result.stdout, copied);
      assert.isTrue(NodeFS.existsSync(copied));
      assert.include(result.stdout, "vp.exe fallback copy");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("copies an unexecutable vp.exe to a writable bin when cmd.exe cannot launch it", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-vite-plus-win-126-"));
    try {
      const bin = NodePath.join(root, ".vite-plus", "bin");
      NodeFS.mkdirSync(bin, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bin, "vp.exe"), "#!/bin/bash\necho 'vp.exe copied'\n", {
        mode: 0o644,
      });
      const tmp = NodePath.join(root, "tmp");
      NodeFS.mkdirSync(tmp);
      const installer = writeInstaller(root, 'echo "installer ran" >&2; exit 1');
      const result = runWindowsHelper({
        home: root,
        path: "/usr/bin:/bin",
        installer,
        env: { TMPDIR: tmp },
        body: `chmod() {
  if [[ "\${1:-}" == "+x" && "\${2:-}" == *".vite-plus/bin/vp.exe" ]]; then
    return 1
  fi
  command chmod "\$@"
}
ensure_vite_plus "to publish mobile OTA"
vite_plus_resolve_cli vp
vp --version`,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.notInclude(result.stdout, "vp is missing");
      assert.notInclude(result.stderr, "installer ran");
      const copied = NodePath.join(tmp, "t3-vite-plus", "bin", "vp.exe");
      assert.include(result.stdout, copied);
      assert.isTrue(NodeFS.existsSync(copied));
      assert.include(result.stdout, "vp.exe copied");
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
