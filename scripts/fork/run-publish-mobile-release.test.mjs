import { assert, describe, it } from "vite-plus/test";

import { bashCandidates, envForHost, isWindows } from "./run-publish-mobile-release.mjs";

describe("run-publish-mobile-release launcher", () => {
  it("keeps Unix on bash and points Windows at Git Bash plus cloud Expo", () => {
    assert.isFalse(isWindows("linux"));
    assert.isFalse(isWindows("darwin"));
    assert.isTrue(isWindows("win32"));
    assert.deepEqual(bashCandidates({}, "linux"), ["bash"]);
    assert.deepEqual(bashCandidates({ ProgramFiles: "C:\\Program Files" }, "win32"), [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "bash",
    ]);

    const unix = envForHost({ PATH: "/usr/bin", T3CODE_IOS_LOCAL_XCODE: "1" }, "darwin");
    assert.equal(unix.T3CODE_IOS_LOCAL_XCODE, "1");
    assert.equal(unix.T3CODE_IOS_ALLOW_EAS_CLOUD, undefined);

    const windows = envForHost(
      {
        PATH: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
        T3CODE_IOS_LOCAL_XCODE: "1",
      },
      "win32",
    );
    assert.equal(windows.T3CODE_IOS_ALLOW_EAS_CLOUD, "1");
    assert.equal(windows.T3CODE_IOS_LOCAL_XCODE, undefined);
    assert.equal(windows.VP_HOME, undefined);
    assert.include(windows.PATH, "Git\\bin");
    assert.include(windows.PATH, "buildkite-agent\\service");
    assert.include(windows.PATH, "buildkite-agent\\bin");
    assert.include(windows.PATH, "vite-plus\\bin");
    assert.notInclude(JSON.stringify(windows), "T3CODE_FORCE_IOS");

    const incomingVpHome = envForHost(
      {
        PATH: "C:\\Windows\\System32",
        VP_HOME: "C:\\buildkite-agent\\vite-plus",
      },
      "win32",
    );
    assert.equal(incomingVpHome.VP_HOME, undefined);
  });
});
