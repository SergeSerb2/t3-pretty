/**
 * ACP client terminal host. Kimi 0.37+ routes Bash/Glob/Grep through
 * `terminal/*` once the client advertises `clientCapabilities.terminal`.
 * T3 runs those commands in the session cwd and keeps output until release.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeBuffer from "node:buffer";
import * as NodePath from "node:path";

import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

export interface AcpTerminalHost {
  readonly create: (
    request: EffectAcpSchema.CreateTerminalRequest,
  ) => Effect.Effect<EffectAcpSchema.CreateTerminalResponse, EffectAcpErrors.AcpError>;
  readonly output: (
    request: EffectAcpSchema.TerminalOutputRequest,
  ) => Effect.Effect<EffectAcpSchema.TerminalOutputResponse, EffectAcpErrors.AcpError>;
  readonly waitForExit: (
    request: EffectAcpSchema.WaitForTerminalExitRequest,
  ) => Effect.Effect<EffectAcpSchema.WaitForTerminalExitResponse, EffectAcpErrors.AcpError>;
  readonly kill: (
    request: EffectAcpSchema.KillTerminalRequest,
  ) => Effect.Effect<EffectAcpSchema.KillTerminalResponse, EffectAcpErrors.AcpError>;
  readonly release: (
    request: EffectAcpSchema.ReleaseTerminalRequest,
  ) => Effect.Effect<EffectAcpSchema.ReleaseTerminalResponse, EffectAcpErrors.AcpError>;
}

interface TerminalOutputBuffer {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

interface HostedTerminal {
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly outputRef: Ref.Ref<TerminalOutputBuffer>;
  readonly exitStatusRef: Ref.Ref<EffectAcpSchema.WaitForTerminalExitResponse | null>;
  readonly exit: Deferred.Deferred<EffectAcpSchema.WaitForTerminalExitResponse>;
  readonly drained: Deferred.Deferred<void>;
}

const emptyOutput: TerminalOutputBuffer = {
  bytes: new Uint8Array(0),
  truncated: false,
};

/** Kimi currently sends the full shell line in `command` and omits `args`. */
export function resolveAcpTerminalSpawn(input: {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly windowsComSpec?: string;
}): { readonly command: string; readonly args: ReadonlyArray<string> } {
  if (input.args !== undefined) {
    return { command: input.command, args: input.args };
  }
  if (input.platform === "win32") {
    return {
      command: input.windowsComSpec?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", input.command],
    };
  }
  return { command: "/bin/bash", args: ["-c", input.command] };
}

export function appendTerminalOutput(
  current: TerminalOutputBuffer,
  chunk: Uint8Array,
  maxBytes: number | undefined,
): TerminalOutputBuffer {
  if (chunk.byteLength === 0) {
    return current;
  }
  const combined = concatBytes(current.bytes, chunk);
  if (maxBytes === undefined || combined.byteLength <= maxBytes) {
    return { bytes: combined, truncated: current.truncated };
  }
  return { bytes: keepUtf8Tail(combined, maxBytes), truncated: true };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left, 0);
  bytes.set(right, left.byteLength);
  return bytes;
}

function keepUtf8Tail(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength <= maxBytes) {
    return bytes;
  }
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && (bytes[start]! & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return bytes.subarray(start);
}

function decodeTerminalOutput(bytes: Uint8Array): string {
  return NodeBuffer.Buffer.from(bytes).toString("utf8");
}

function resolveTerminalCwd(requestCwd: string | null | undefined, sessionCwd: string): string {
  const cwd = requestCwd?.trim();
  if (!cwd) {
    return sessionCwd;
  }
  return NodePath.isAbsolute(cwd) ? cwd : NodePath.resolve(sessionCwd, cwd);
}

function envFromRequest(
  env: EffectAcpSchema.CreateTerminalRequest["env"],
): Record<string, string> | undefined {
  if (!env || env.length === 0) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const variable of env) {
    record[variable.name] = variable.value;
  }
  return record;
}

function unknownTerminalError(terminalId: string) {
  return EffectAcpErrors.AcpRequestError.invalidParams(`Unknown ACP terminal: ${terminalId}`);
}

export const makeAcpTerminalHost = (options: { readonly cwd: string }) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sessionScope = yield* Scope.Scope;
    const platform = yield* HostProcessPlatform;
    const hostEnvironment = yield* HostProcessEnvironment;
    const terminals = new Map<string, HostedTerminal>();

    const getTerminal = (terminalId: string) => {
      const terminal = terminals.get(terminalId);
      if (!terminal) {
        return Effect.fail(unknownTerminalError(terminalId));
      }
      return Effect.succeed(terminal);
    };

    const create: AcpTerminalHost["create"] = (request) =>
      Effect.gen(function* () {
        const command = request.command.trim();
        if (!command) {
          return yield* EffectAcpErrors.AcpRequestError.invalidParams(
            "ACP terminal command cannot be empty.",
          );
        }
        const planned = resolveAcpTerminalSpawn({
          command,
          ...(request.args !== undefined ? { args: request.args } : {}),
          platform,
          ...(hostEnvironment.ComSpec ? { windowsComSpec: hostEnvironment.ComSpec } : {}),
        });
        const spawnCommand = yield* resolveSpawnCommand(planned.command, planned.args).pipe(
          Effect.mapError(
            (cause) =>
              new EffectAcpErrors.AcpSpawnError({
                command: planned.command,
                cause,
              }),
          ),
        );
        const cwd = resolveTerminalCwd(request.cwd, options.cwd);
        const env = envFromRequest(request.env);
        const child = yield* spawner
          .spawn(
            ChildProcess.make(spawnCommand.command, spawnCommand.args, {
              cwd,
              stdin: "ignore",
              shell: spawnCommand.shell,
              ...(env ? { env, extendEnv: true } : {}),
            }),
          )
          .pipe(
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new EffectAcpErrors.AcpSpawnError({
                  command: spawnCommand.command,
                  cause,
                }),
            ),
          );

        const outputRef = yield* Ref.make(emptyOutput);
        const exitStatusRef = yield* Ref.make<EffectAcpSchema.WaitForTerminalExitResponse | null>(
          null,
        );
        const exit = yield* Deferred.make<EffectAcpSchema.WaitForTerminalExitResponse>();
        const drained = yield* Deferred.make<void>();
        const maxBytes =
          request.outputByteLimit === null || request.outputByteLimit === undefined
            ? undefined
            : request.outputByteLimit;

        yield* child.all.pipe(
          Stream.runForEach((chunk) =>
            Ref.update(outputRef, (current) => appendTerminalOutput(current, chunk, maxBytes)),
          ),
          Effect.catch(() => Effect.void),
          Effect.ensuring(Deferred.succeed(drained, undefined)),
          Effect.forkIn(sessionScope),
        );
        const completeExit = (status: EffectAcpSchema.WaitForTerminalExitResponse) =>
          Ref.set(exitStatusRef, status).pipe(Effect.andThen(Deferred.succeed(exit, status)));
        yield* child.exitCode.pipe(
          Effect.matchEffect({
            onSuccess: (code) => completeExit({ exitCode: Number(code) }),
            onFailure: () => completeExit({ exitCode: 1 }),
          }),
          Effect.forkIn(sessionScope),
        );

        const terminalId = yield* crypto.randomUUIDv4.pipe(
          Effect.mapError(
            (cause) =>
              new EffectAcpErrors.AcpTransportError({
                detail: "Failed to generate an ACP terminal identifier.",
                cause,
              }),
          ),
        );
        terminals.set(terminalId, { child, outputRef, exitStatusRef, exit, drained });
        return { terminalId };
      });

    const output: AcpTerminalHost["output"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request.terminalId);
        const buffer = yield* Ref.get(terminal.outputRef);
        const exitStatus = yield* Ref.get(terminal.exitStatusRef);
        return {
          output: decodeTerminalOutput(buffer.bytes),
          truncated: buffer.truncated,
          ...(exitStatus ? { exitStatus } : {}),
        };
      });

    const waitForExit: AcpTerminalHost["waitForExit"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request.terminalId);
        const status = yield* Deferred.await(terminal.exit);
        yield* Deferred.await(terminal.drained);
        return status;
      });

    const kill: AcpTerminalHost["kill"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request.terminalId);
        yield* terminal.child.kill().pipe(Effect.ignore);
        return {};
      });

    const release: AcpTerminalHost["release"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request.terminalId);
        terminals.delete(request.terminalId);
        yield* terminal.child.kill().pipe(Effect.ignore);
        return {};
      });

    return { create, output, waitForExit, kill, release };
  });
