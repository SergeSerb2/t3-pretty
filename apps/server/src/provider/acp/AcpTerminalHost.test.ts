import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";
import {
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";

import {
  appendTerminalOutput,
  makeAcpTerminalHost,
  resolveAcpTerminalSpawn,
} from "./AcpTerminalHost.ts";

const sessionId = "mock-session-1";

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
