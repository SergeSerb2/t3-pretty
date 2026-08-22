// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";
import {
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";

import {
  appendTerminalOutput,
  confineAcpTerminalCwd,
  DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT,
  makeAcpTerminalHost,
  resolveAcpTerminalCwd,
  resolveAcpTerminalOutputByteLimit,
  resolveAcpTerminalSpawn,
  terminalExitFromCode,
  terminalExitFromFailure,
} from "./AcpTerminalHost.ts";

const sessionId = "mock-session-1";
const posixPlatform = "linux" satisfies NodeJS.Platform;
const windowsPlatform = "win32" satisfies NodeJS.Platform;
const sessionRoot = NodePath.posix.resolve("/session/root");
const windowsSessionRoot = NodePath.win32.resolve("C:\\Session\\Root");

describe("resolveAcpTerminalSpawn", () => {
  it("spawns argv when args are present", () => {
    expect(
      resolveAcpTerminalSpawn({
        command: "/usr/bin/git",
        args: ["status", "--short"],
        platform: "darwin",
      }),
    ).toEqual({ command: "/usr/bin/git", args: ["status", "--short"] });
  });

  it("wraps a shell line in bash when args are omitted", () => {
    expect(
      resolveAcpTerminalSpawn({
        command: "git status --short",
        platform: "darwin",
      }),
    ).toEqual({ command: "/bin/bash", args: ["-c", "git status --short"] });
  });

  it("wraps a shell line in cmd.exe on Windows", () => {
    expect(
      resolveAcpTerminalSpawn({
        command: "git status --short",
        platform: "win32",
        windowsComSpec: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "git status --short"],
    });
  });
});

describe("resolveAcpTerminalCwd", () => {
  it("uses the session cwd when the request omits cwd", () => {
    expect(resolveAcpTerminalCwd(undefined, sessionRoot, posixPlatform)).toBe(sessionRoot);
    expect(resolveAcpTerminalCwd("  ", sessionRoot, posixPlatform)).toBe(sessionRoot);
  });

  it("allows a subdirectory of the session cwd", () => {
    expect(
      resolveAcpTerminalCwd(NodePath.posix.join(sessionRoot, "src"), sessionRoot, posixPlatform),
    ).toBe(NodePath.posix.join(sessionRoot, "src"));
    expect(
      resolveAcpTerminalCwd(NodePath.posix.join("src", "pkg"), sessionRoot, posixPlatform),
    ).toBe(NodePath.posix.join(sessionRoot, "src", "pkg"));
  });

  it("rejects cwd that escapes the session cwd", () => {
    expect(resolveAcpTerminalCwd("..", sessionRoot, posixPlatform)).toBeUndefined();
    expect(
      resolveAcpTerminalCwd(NodePath.posix.resolve("/tmp"), sessionRoot, posixPlatform),
    ).toBeUndefined();
    expect(
      resolveAcpTerminalCwd(`${sessionRoot}-evil`, sessionRoot, posixPlatform),
    ).toBeUndefined();
  });

  it("treats mixed-case Windows paths as inside the session root", () => {
    expect(resolveAcpTerminalCwd("Src", windowsSessionRoot, windowsPlatform)).toBe(
      NodePath.win32.join(windowsSessionRoot, "Src"),
    );
    expect(
      resolveAcpTerminalCwd("c:\\session\\root\\src", windowsSessionRoot, windowsPlatform),
    ).toBe("c:\\session\\root\\src");
  });

  it("rejects mixed-case Windows paths that escape the session root", () => {
    expect(
      resolveAcpTerminalCwd("C:\\Session\\Root\\..\\Windows", windowsSessionRoot, windowsPlatform),
    ).toBeUndefined();
    expect(
      resolveAcpTerminalCwd("C:\\Session\\Root-evil", windowsSessionRoot, windowsPlatform),
    ).toBeUndefined();
  });
});

describe("confineAcpTerminalCwd", () => {
  it.effect("realpaths the session cwd when the request omits cwd", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const realRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-real-" });
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-alias-" });
      const alias = path.join(parent, "alias");
      yield* fileSystem.symlink(realRoot, alias);
      const confined = yield* confineAcpTerminalCwd(undefined, alias);
      expect(confined).toBe(yield* fileSystem.realPath(realRoot));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a cwd symlink that points outside the session root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sessionRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-root-" });
      const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-out-" });
      const escapeLink = path.join(sessionRoot, "escape");
      yield* fileSystem.symlink(outside, escapeLink);
      const confined = yield* confineAcpTerminalCwd(escapeLink, sessionRoot);
      expect(confined).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects cwd when realpath fails", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sessionRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "acp-term-missing-",
      });
      const missing = path.join(sessionRoot, "does-not-exist");
      const confined = yield* confineAcpTerminalCwd(missing, sessionRoot);
      expect(confined).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("terminalExitFromCode", () => {
  it("maps null and non-integer codes to a non-zero status", () => {
    expect(terminalExitFromCode(null)).toEqual({ exitCode: 1 });
    expect(terminalExitFromCode(undefined)).toEqual({ exitCode: 1 });
    expect(terminalExitFromCode(Number.NaN)).toEqual({ exitCode: 1 });
  });

  it("keeps a successful numeric exit code", () => {
    expect(terminalExitFromCode(0)).toEqual({ exitCode: 0 });
    expect(terminalExitFromCode(7)).toEqual({ exitCode: 7 });
  });
});

describe("terminalExitFromFailure", () => {
  it("maps a signal termination to a non-zero status with the signal", () => {
    expect(
      terminalExitFromFailure({
        message: "Unknown: ChildProcess.exitCode (node -e setTimeout(() => {}, 60_000))",
        cause: new Error("Process interrupted due to receipt of signal: 'SIGTERM'"),
      }),
    ).toEqual({ exitCode: 1, signal: "SIGTERM" });
  });

  it("maps an unknown failure to a non-zero status", () => {
    expect(terminalExitFromFailure(new Error("spawn failed"))).toEqual({ exitCode: 1 });
  });
});

describe("resolveAcpTerminalOutputByteLimit", () => {
  it("defaults when the agent omits a limit and honors a smaller request", () => {
    expect(resolveAcpTerminalOutputByteLimit(undefined)).toBe(
      DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT,
    );
    expect(resolveAcpTerminalOutputByteLimit(null)).toBe(DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT);
    expect(resolveAcpTerminalOutputByteLimit(16)).toBe(16);
    expect(resolveAcpTerminalOutputByteLimit(DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT + 8)).toBe(
      DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT,
    );
  });
});

describe("appendTerminalOutput", () => {
  it("keeps the UTF-8 tail when the byte limit is exceeded", () => {
    const first = appendTerminalOutput(
      { bytes: new Uint8Array(0), truncated: false },
      new TextEncoder().encode("aa"),
      4,
    );
    const next = appendTerminalOutput(first, new TextEncoder().encode("bbcc"), 4);
    expect(new TextDecoder().decode(next.bytes)).toBe("bbcc");
    expect(next.truncated).toBe(true);
  });

  it("applies the default cap when the omitted-limit resolver is used", () => {
    const over = new Uint8Array(DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT + 8);
    over.fill(97);
    const next = appendTerminalOutput(
      { bytes: new Uint8Array(0), truncated: false },
      over,
      resolveAcpTerminalOutputByteLimit(undefined),
    );
    expect(next.truncated).toBe(true);
    expect(next.bytes.byteLength).toBeLessThanOrEqual(DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT);
  });
});

describe("AcpTerminalHost", () => {
  it.effect("runs argv commands and returns output after exit", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: ["-e", "process.stdout.write('hello-acp-terminal')"],
      });
      const status = yield* host.waitForExit({
        sessionId,
        terminalId: created.terminalId,
      });
      const output = yield* host.output({
        sessionId,
        terminalId: created.terminalId,
      });
      expect(status.exitCode).toBe(0);
      expect(output.output).toContain("hello-acp-terminal");
      expect(output.truncated).toBe(false);
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("runs omitted-args command lines through the shell", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const host = yield* makeAcpTerminalHost({ cwd });
      const platform = yield* HostProcessPlatform;
      const execPath = yield* HostProcessExecutablePath;
      const command =
        platform === "win32"
          ? `"${execPath}" -e "process.stdout.write('via-shell')"`
          : `'${execPath}' -e 'process.stdout.write("via-shell")'`;
      const created = yield* host.create({
        sessionId,
        command,
      });
      yield* host.waitForExit({ sessionId, terminalId: created.terminalId });
      const output = yield* host.output({
        sessionId,
        terminalId: created.terminalId,
      });
      expect(output.output).toContain("via-shell");
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("kills a long-running command", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: ["-e", "setTimeout(() => {}, 60_000)"],
      });
      yield* host.kill({ sessionId, terminalId: created.terminalId });
      const status = yield* host.waitForExit({
        sessionId,
        terminalId: created.terminalId,
      });
      expect(status.exitCode).not.toBe(0);
      if (status.signal != null) {
        expect(status.signal.length).toBeGreaterThan(0);
      }
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects terminal access from a different session", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: ["-e", "process.exit(0)"],
      });
      yield* host.waitForExit({ sessionId, terminalId: created.terminalId });
      const error = yield* host
        .output({ sessionId: "other-session", terminalId: created.terminalId })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AcpRequestError");
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects cwd outside the session working directory", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const outside = NodePath.resolve(cwd, "..");
      expect(outside).not.toBe(NodePath.resolve(cwd));
      const error = yield* host
        .create({
          sessionId,
          command: execPath,
          args: ["-e", "process.exit(0)"],
          cwd: outside,
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AcpRequestError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("truncates output to the requested byte limit", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: ["-e", "process.stdout.write('abcdef')"],
        outputByteLimit: 4,
      });
      yield* host.waitForExit({ sessionId, terminalId: created.terminalId });
      const output = yield* host.output({
        sessionId,
        terminalId: created.terminalId,
      });
      expect(output.truncated).toBe(true);
      expect(output.output).toBe("cdef");
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a cwd symlink that escapes the session working directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sessionRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-host-" });
      const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "acp-term-host-out-" });
      const escapeLink = path.join(sessionRoot, "escape");
      yield* fileSystem.symlink(outside, escapeLink);
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd: sessionRoot });
      const error = yield* host
        .create({
          sessionId,
          command: execPath,
          args: ["-e", "process.exit(0)"],
          cwd: escapeLink,
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AcpRequestError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("output includes the full stdout tail once it reports exitStatus", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: [
          "-e",
          "process.stdout.write('a'.repeat(65536) + 'DRAIN-TAIL', () => process.exit(0))",
        ],
      });
      let output = yield* host.output({
        sessionId,
        terminalId: created.terminalId,
      });
      while (output.exitStatus == null) {
        yield* Effect.yieldNow;
        output = yield* host.output({
          sessionId,
          terminalId: created.terminalId,
        });
      }
      expect(output.exitStatus.exitCode).toBe(0);
      expect(output.output.endsWith("DRAIN-TAIL")).toBe(true);
      expect(output.output.length).toBe(65536 + "DRAIN-TAIL".length);
      yield* host.release({ sessionId, terminalId: created.terminalId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects output after release", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const execPath = yield* HostProcessExecutablePath;
      const host = yield* makeAcpTerminalHost({ cwd });
      const created = yield* host.create({
        sessionId,
        command: execPath,
        args: ["-e", "process.exit(0)"],
      });
      yield* host.waitForExit({ sessionId, terminalId: created.terminalId });
      yield* host.release({ sessionId, terminalId: created.terminalId });
      const error = yield* host
        .output({ sessionId, terminalId: created.terminalId })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AcpRequestError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
