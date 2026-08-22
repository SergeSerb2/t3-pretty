/**
 * ACP client terminal host. Kimi 0.37+ routes Bash/Glob/Grep through
 * `terminal/*` once the client advertises `clientCapabilities.terminal`.
 * T3 runs those commands in the session cwd and keeps output until release.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeBuffer from "node:buffer";
import * as NodeFSP from "node:fs/promises";
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
  readonly sessionId: string;
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

/** Kept when the agent omits `outputByteLimit`. Smaller requested limits still win. */
export const DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT = 1024 * 1024;

export function resolveAcpTerminalOutputByteLimit(requested: number | null | undefined): number {
  if (requested == null || !Number.isFinite(requested) || requested < 0) {
    return DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT;
  }
  return Math.min(Math.floor(requested), DEFAULT_ACP_TERMINAL_OUTPUT_BYTE_LIMIT);
}

export function appendTerminalOutput(
  current: TerminalOutputBuffer,
  chunk: Uint8Array,
  maxBytes: number,
): TerminalOutputBuffer {
  if (chunk.byteLength === 0) {
    return current;
  }
  const combined = concatBytes(current.bytes, chunk);
  if (combined.byteLength <= maxBytes) {
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

function resolveAcpTerminalCandidate(
  requestCwd: string | null | undefined,
  sessionCwd: string,
): string {
  const root = NodePath.resolve(sessionCwd);
  const requested = requestCwd?.trim();
  if (!requested) {
    return root;
  }
  return NodePath.isAbsolute(requested)
    ? NodePath.resolve(requested)
    : NodePath.resolve(root, requested);
}

export function resolveAcpTerminalCwd(
  requestCwd: string | null | undefined,
  sessionCwd: string,
): string | undefined {
  const root = NodePath.resolve(sessionCwd);
  const resolved = resolveAcpTerminalCandidate(requestCwd, sessionCwd);
  return isPathInsideRoot(root, resolved) ? resolved : undefined;
}

function realpathOrUndefined(target: string): Effect.Effect<string | undefined> {
  return Effect.tryPromise({
    try: () => NodeFSP.realpath(target),
    catch: () => new Error("realpath failed"),
  }).pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)));
}

export const confineAcpTerminalCwd = (
  requestCwd: string | null | undefined,
  sessionCwd: string,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const realRoot = yield* realpathOrUndefined(NodePath.resolve(sessionCwd));
    if (realRoot === undefined) {
      return undefined;
    }
    const candidate = resolveAcpTerminalCandidate(requestCwd, realRoot);
    const realCandidate = yield* realpathOrUndefined(candidate);
    if (realCandidate === undefined) {
      return undefined;
    }
    return isPathInsideRoot(realRoot, realCandidate) ? realCandidate : undefined;
  });

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  );
}

export function terminalExitFromCode(
  code: number | null | undefined,
): EffectAcpSchema.WaitForTerminalExitResponse {
  if (code == null) {
    return { exitCode: 1 };
  }
  const exitCode = Number(code);
  if (!Number.isInteger(exitCode) || exitCode < 0) {
    return { exitCode: 1 };
  }
  return { exitCode };
}

export function terminalExitFromFailure(
  error: unknown,
): EffectAcpSchema.WaitForTerminalExitResponse {
  const signal = signalFromExitError(error);
  return signal ? { exitCode: 1, signal } : { exitCode: 1 };
}

function signalFromExitError(error: unknown): string | undefined {
  const match = /receipt of signal:\s*'([^']+)'/i.exec(exitErrorText(error));
  const signal = match?.[1]?.trim();
  return signal ? signal : undefined;
}

function exitErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (typeof current === "object" && "message" in current) {
      parts.push(String(current.message));
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return parts.join("\n");
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

    const getTerminal = (request: { readonly sessionId: string; readonly terminalId: string }) => {
      const terminal = terminals.get(request.terminalId);
      if (!terminal || terminal.sessionId !== request.sessionId) {
        return Effect.fail(unknownTerminalError(request.terminalId));
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
        const cwd = yield* confineAcpTerminalCwd(request.cwd, options.cwd);
        if (!cwd) {
          return yield* EffectAcpErrors.AcpRequestError.invalidParams(
            "ACP terminal cwd must stay inside the session working directory.",
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
        const maxBytes = resolveAcpTerminalOutputByteLimit(request.outputByteLimit);

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
            onSuccess: (code) => completeExit(terminalExitFromCode(code)),
            onFailure: (error) => completeExit(terminalExitFromFailure(error)),
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
        terminals.set(terminalId, {
          sessionId: request.sessionId,
          child,
          outputRef,
          exitStatusRef,
          exit,
          drained,
        });
        return { terminalId };
      });

    const output: AcpTerminalHost["output"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request);
        const exitStatus = yield* Ref.get(terminal.exitStatusRef);
        // exitCode can land while `child.all` is still appending. If we
        // already know the process exited, wait for drain so exitStatus
        // never ships with a truncated tail.
        if (exitStatus) {
          yield* Deferred.await(terminal.drained);
        }
        const buffer = yield* Ref.get(terminal.outputRef);
        return {
          output: decodeTerminalOutput(buffer.bytes),
          truncated: buffer.truncated,
          ...(exitStatus ? { exitStatus } : {}),
        };
      });

    const waitForExit: AcpTerminalHost["waitForExit"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request);
        const status = yield* Deferred.await(terminal.exit);
        yield* Deferred.await(terminal.drained);
        return status;
      });

    const kill: AcpTerminalHost["kill"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request);
        yield* terminal.child.kill().pipe(Effect.ignore);
        return {};
      });

    const release: AcpTerminalHost["release"] = (request) =>
      Effect.gen(function* () {
        const terminal = yield* getTerminal(request);
        terminals.delete(request.terminalId);
        yield* terminal.child.kill().pipe(Effect.ignore);
        return {};
      });

    return { create, output, waitForExit, kill, release };
  });
