import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { forkCliTarballUrl, T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { SshPasswordPrompt } from "./auth.ts";
import {
  buildRemoteLaunchScript,
  buildRemoteNodeEnvScript,
  buildRemotePairingScript,
  buildRemoteStopScript,
  buildRemoteT3RunnerScript,
  buildRemoteWindowsLaunchScript,
  buildRemoteWindowsPairingScript,
  buildRemoteWindowsStopScript,
  describeReadinessCause,
  issueRemotePairingToken,
  launchOrReuseRemoteServer,
  REMOTE_PICK_PORT_SCRIPT,
  SshEnvironmentManager,
  stopRemoteServer,
  waitForHttpReady,
} from "./tunnel.ts";

const TEST_NODE_ENGINE_RANGE = "^22.16 || ^23.11 || >=24.10";

const makeSuccessfulProcess = (stdout: string) => {
  const stdoutStream = Stream.make(new TextEncoder().encode(stdout));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: stdoutStream,
    stderr: Stream.empty,
    all: stdoutStream,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const makeFailedProcess = (stderr: string) => {
  const stderrStream = Stream.make(new TextEncoder().encode(stderr));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: Stream.empty,
    stderr: stderrStream,
    all: stderrStream,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(255)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const makeDelayedSuccessfulProcess = (stdout: string, delayMs: number) => {
  const process = makeSuccessfulProcess(stdout);
  return {
    ...process,
    exitCode: Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.as(ChildProcessSpawner.ExitCode(0)),
    ),
  };
};

const makeRunningProcess = (onKill: () => void) => {
  let finish: ((exitCode: ChildProcessSpawner.ExitCode) => void) | null = null;
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode: Effect.callback<ChildProcessSpawner.ExitCode>((resume) => {
      finish = (exitCode) => resume(Effect.succeed(exitCode));
      return Effect.sync(() => {
        finish = null;
      });
    }),
    isRunning: Effect.succeed(true),
    kill: () =>
      Effect.sync(() => {
        onKill();
        finish?.(ChildProcessSpawner.ExitCode(143));
      }),
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const testHttpClient = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 200 }))),
);

const hangingHttpClient = HttpClient.make(() => Effect.never);

const testNetService = NetService.NetService.of({
  canListenOnHost: () => Effect.succeed(true),
  isPortAvailableOnLoopback: () => Effect.succeed(true),
  hasListenerOnHost: () => Effect.succeed(false),
  reserveLoopbackPort: () => Effect.succeed(41_773),
  findAvailablePort: (preferred) => Effect.succeed(preferred),
});

function commandArgs(command: ChildProcess.Command): ReadonlyArray<string> {
  return command._tag === "StandardCommand" ? command.args : [];
}

describe("ssh tunnel scripts", () => {
  it("passes the checker into the remote Node probe instead of closing over its bundle name", () => {
    const script = buildRemoteNodeEnvScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE });
    const nodeScript = script.match(/<<'NODE'\n([\s\S]+?)\nNODE/)?.[1];
    const stderr: Array<string> = [];
    const remoteProcess = {
      argv: ["node", "-", TEST_NODE_ENGINE_RANGE],
      versions: { node: "24.13.1" },
      version: "v24.13.1",
      stderr: { write: (message: string) => stderr.push(message) },
      exit: (code: number) => {
        throw new Error(`unexpected exit ${code}`);
      },
    };

    assert.isDefined(nodeScript);
    const anonymousHelperNodeScript = nodeScript.replace(
      "function satisfiesSemverRange(",
      "function(",
    );
    assert.notEqual(anonymousHelperNodeScript, nodeScript);
    assert.doesNotThrow(() => new Function("process", anonymousHelperNodeScript)(remoteProcess));
    assert.deepEqual(stderr, []);
    assert.notInclude(anonymousHelperNodeScript, "const satisfiesSemverRange =");
  });

  it("builds the remote t3 runner with npx and npm fallbacks", () => {
    const script = buildRemoteT3RunnerScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE });
    const packageSpec = forkCliTarballUrl();

    assert.include(script, "T3_NODE_SCRIPT_PATH=''");
    assert.include(script, 'exec t3 "$@"');
    assert.include(script, `exec npx --yes '${packageSpec}' "$@"`);
    assert.include(script, `exec npm exec --yes '${packageSpec}' -- "$@"`);
    assert.include(script, `could not install '${packageSpec}'`);
    assert.include(script, `require_installed_t3_cli npx --yes --package '${packageSpec}'`);
    assert.include(script, `require_installed_t3_cli npm exec --yes --package '${packageSpec}'`);
    assert.include(script, "npm produced no t3 executable");
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/bin"');
    assert.include(script, `T3_NODE_ENGINE_RANGE='${TEST_NODE_ENGINE_RANGE}'`);
    assert.include(script, "remote_node_satisfies_engine()");
    assert.include(script, "function satisfiesSemverRange");
    assert.include(script, "satisfiesRange(rawVersion, range)");
    assert.include(script, 'prepend_path_if_dir "$VOLTA_HOME/bin"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.asdf/shims"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/share/mise/shims"');
    assert.include(script, 'eval "$(fnm env --shell bash)"');
    assert.include(script, "fnm use --silent-if-unchanged");
    assert.include(script, "fnm use default");
    assert.include(script, 'prepend_path_if_dir "$HOME/.nodenv/shims"');
    assert.include(script, 'NVM_DIR="$HOME/.nvm"');
    assert.include(script, "nvm use --silent default");
    assert.include(script, 'for T3_NODE_BIN in "$NVM_DIR"/versions/node/*/bin');
    assert.notInclude(script, "ensure $NVM_DIR/nvm.sh is available");
  });

  it("builds syntactically valid Windows launch, pairing, and stop scripts", () => {
    const runner = {
      packageSpec: 't3@nightly"; Write-Output owned',
      nodeEngineRange: TEST_NODE_ENGINE_RANGE,
    };
    const launchScript = buildRemoteWindowsLaunchScript(runner);
    const pairingScript = buildRemoteWindowsPairingScript(runner);
    const stopScript = buildRemoteWindowsStopScript();

    assert.include(launchScript, 'const T3_PACKAGE_SPEC = "t3@nightly\\\"; Write-Output owned";');
    assert.include(launchScript, "taskkill.exe");
    assert.include(launchScript, "npx-cli.js");
    assert.include(launchScript, "function satisfiesSemverRange");
    assert.include(pairingScript, '"auth",');
    assert.include(pairingScript, '"pairing",');
    assert.include(stopScript, "taskkill.exe");
    assert.include(launchScript, "its runtime identity could not be verified");
    assert.include(
      stopScript,
      'managed === "managed" && pid && port && runtime?.pid === pid && runtime.port === port',
    );
    assert.include(stopScript, 'const defaultRuntimeFile = path.join(os.homedir(), ".t3"');
    assert.notInclude(launchScript, "@@T3_");
    assert.notInclude(pairingScript, "@@T3_");
    assert.doesNotThrow(() => new Function(launchScript));
    assert.doesNotThrow(() => new Function(pairingScript));
    assert.doesNotThrow(() => new Function(stopScript));
  });

  it("keeps remote SSH state separate for the selected build", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const baseDirName = T3CODE_BUILD_FLAVOR === "internal" ? ".t3" : ".t3-pretty";
    const otherBaseDirName = T3CODE_BUILD_FLAVOR === "internal" ? ".t3-pretty" : ".t3";

    for (const script of [
      buildRemoteLaunchScript(),
      buildRemotePairingScript(target),
      buildRemoteStopScript(target),
    ]) {
      assert.include(script, `$HOME/${baseDirName}/ssh-launch/`);
      assert.notInclude(script, `$HOME/${otherBaseDirName}/ssh-launch/`);
    }
    for (const script of [
      buildRemoteWindowsLaunchScript(),
      buildRemoteWindowsPairingScript(),
      buildRemoteWindowsStopScript(),
    ]) {
      assert.include(script, `os.homedir(), "${baseDirName}"`);
      assert.notInclude(script, `os.homedir(), "${otherBaseDirName}"`);
    }
  });

  it("does not hard-code a remote node engine range", () => {
    const script = buildRemoteT3RunnerScript();

    assert.include(script, "T3_NODE_ENGINE_RANGE=''");
    assert.notInclude(script, TEST_NODE_ENGINE_RANGE);
  });

  it("shell-quotes package specs in the remote t3 runner", () => {
    const script = buildRemoteT3RunnerScript({
      packageSpec: "t3@nightly; touch /tmp/t3-owned",
    });

    assert.include(script, "exec npx --yes 't3@nightly; touch /tmp/t3-owned' \"$@\"");
    assert.include(script, "exec npm exec --yes 't3@nightly; touch /tmp/t3-owned' -- \"$@\"");
    assert.include(
      script,
      "require_installed_t3_cli npx --yes --package 't3@nightly; touch /tmp/t3-owned'",
    );
    assert.notInclude(script, "exec npx --yes t3@nightly; touch /tmp/t3-owned");
  });

  it("builds the remote t3 runner with a node script override", () => {
    const script = buildRemoteT3RunnerScript({
      nodeScriptPath: "/Users/julius/Development/Work/codething-mvp/apps/server/dist/bin.mjs",
    });

    assert.include(
      script,
      "T3_NODE_SCRIPT_PATH='/Users/julius/Development/Work/codething-mvp/apps/server/dist/bin.mjs'",
    );
    assert.include(script, 'exec node "$T3_NODE_SCRIPT_PATH" "$@"');
  });

  it("propagates fork public cloud configuration to POSIX and Windows runners", () => {
    const publicEnvironment = {
      T3CODE_RELAY_URL: "https://relay.fork.example.test",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_fork_'quoted",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_fork",
    };
    const posixScript = buildRemoteT3RunnerScript({ publicEnvironment });
    const windowsLaunchScript = buildRemoteWindowsLaunchScript({ publicEnvironment });
    const windowsPairingScript = buildRemoteWindowsPairingScript({ publicEnvironment });

    assert.include(posixScript, "export T3CODE_RELAY_URL='https://relay.fork.example.test'");
    assert.include(posixScript, "export T3CODE_CLERK_PUBLISHABLE_KEY='pk_fork_'\\''quoted'");
    assert.include(posixScript, "export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID='oauth_fork'");
    assert.include(windowsLaunchScript, '"T3CODE_RELAY_URL":"https://relay.fork.example.test"');
    assert.include(windowsLaunchScript, "...T3_PUBLIC_ENVIRONMENT");
    assert.include(windowsPairingScript, "...T3_PUBLIC_ENVIRONMENT");
    assert.notInclude(posixScript, "@@T3_");
    assert.notInclude(windowsLaunchScript, "@@T3_");
    assert.doesNotThrow(() => new Function(windowsLaunchScript));
    assert.doesNotThrow(() => new Function(windowsPairingScript));
  });

  it("uses the remote t3 runner for launch and pairing scripts", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;

    assert.include(
      buildRemoteLaunchScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE }),
      '[ -n "$REMOTE_PID" ] && [ -n "$REMOTE_PORT" ] && kill -0 "$REMOTE_PID" 2>/dev/null',
    );
    assert.include(buildRemoteLaunchScript(), "RUNNER_CHANGED=1");
    assert.include(buildRemoteLaunchScript(), "ensure_remote_node_path()");
    assert.include(buildRemoteLaunchScript(), "if ! ensure_remote_node_path; then");
    assert.include(
      buildRemoteLaunchScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE }),
      `T3_NODE_ENGINE_RANGE='${TEST_NODE_ENGINE_RANGE}'`,
    );
    assert.include(
      buildRemoteLaunchScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE }),
      "does not satisfy required range ",
    );
    assert.include(buildRemoteLaunchScript(), 'kill "$REMOTE_PID" 2>/dev/null || true');
    assert.include(buildRemoteLaunchScript(), "wait_ready");
    assert.include(buildRemoteLaunchScript(), '"$RUNNER_FILE" serve --host 127.0.0.1');
    assert.include(buildRemoteLaunchScript(), '--base-dir "$DEFAULT_SERVER_HOME"');
    assert.notInclude(buildRemoteLaunchScript(), "server-home");
    assert.include(buildRemoteLaunchScript(), "Remote T3 server did not become ready");
    assert.include(buildRemoteLaunchScript(), 'wait_ready "60000"');
    assert.include(buildRemoteLaunchScript(), 'if [ -s "$LOG_FILE" ]; then');
    assert.include(buildRemoteLaunchScript(), "It wrote nothing to %s");
    assert.include(buildRemoteLaunchScript({ packageSpec: "t3@nightly" }), "t3@nightly");
    assert.include(
      buildRemotePairingScript(target),
      '"$RUNNER_FILE" auth pairing create --base-dir "$PAIRING_BASE_DIR" --json',
    );
    assert.include(buildRemotePairingScript(target), 'PAIRING_BASE_DIR="$DEFAULT_SERVER_HOME"');
    assert.notInclude(buildRemotePairingScript(target), "server-home");
    assert.include(buildRemotePairingScript(target, { packageSpec: "t3@nightly" }), "t3@nightly");
    assert.include(
      buildRemoteStopScript(target),
      'if [ "$REMOTE_MANAGED" = "managed" ] && runtime_matches_managed_state',
    );
    assert.include(buildRemoteStopScript(target), 'kill "$REMOTE_PID" 2>/dev/null || true');
    assert.include(buildRemoteStopScript(target), 'rm -f "$PID_FILE" "$PORT_FILE" "$MANAGED_FILE"');
    assert.include(
      buildRemoteLaunchScript(),
      'DEFAULT_RUNTIME_FILE="$DEFAULT_SERVER_HOME/userdata/server-runtime.json"',
    );
    assert.include(buildRemoteLaunchScript(), "resolve_default_runtime_port()");
    assert.include(
      buildRemoteLaunchScript(),
      'DEFAULT_RUNTIME_INFO="$(resolve_default_runtime_port',
    );
    assert.include(
      buildRemoteLaunchScript(),
      "if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port))",
    );
    assert.notInclude(
      buildRemoteLaunchScript(),
      'PID_TO_STOP="${REMOTE_PID:-$DEFAULT_RUNTIME_PID}"',
    );
    assert.include(buildRemoteLaunchScript(), '[ "$REMOTE_PID" = "$DEFAULT_RUNTIME_PID" ]');
    assert.include(buildRemoteLaunchScript(), 'SPAWNED_PID="$!"');
    assert.include(
      buildRemoteLaunchScript(),
      'STARTED_RUNTIME_INFO="$(resolve_default_runtime_port',
    );
    assert.include(buildRemoteLaunchScript(), "its runtime identity could not be verified");
    assert.include(buildRemoteLaunchScript(), 'REMOTE_PORT="$DEFAULT_REMOTE_PORT"');
    assert.include(buildRemoteLaunchScript(), 'rm -f "$PID_FILE"');
    assert.include(buildRemoteLaunchScript(), "printf 'external\\n' >\"$MANAGED_FILE\"");
    assert.include(buildRemoteLaunchScript(), 'if [ -z "$REMOTE_PORT" ]; then');
    assert.isBelow(
      buildRemoteLaunchScript().indexOf('if [ "$REMOTE_MANAGED" = "managed" ]'),
      buildRemoteLaunchScript().indexOf("printf 'external\\n' >\"$MANAGED_FILE\""),
    );
    assert.isBelow(
      buildRemoteLaunchScript().indexOf('DEFAULT_RUNTIME_INFO="$(resolve_default_runtime_port'),
      buildRemoteLaunchScript().indexOf('elif [ "$REMOTE_MANAGED" = "managed" ]'),
    );
  });

  it.effect("accepts launch JSON after remote shell startup noise", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawnedCommands: Array<ReadonlyArray<string>> = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        spawnedCommands.push(commandArgs(command));
        return makeSuccessfulProcess('loaded nvm default\n{"remotePort":3774}\n');
      }),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.merge(NodeServices.layer, spawnerLayer);

    return Effect.gen(function* () {
      const result = yield* launchOrReuseRemoteServer(target);
      assert.equal(result.remotePort, 3774);
      assert.deepEqual(spawnedCommands[0]?.slice(-5, -1), ["sh", "-l", "-s", "--"]);
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("uses native Node lifecycle scripts when the remote host is Windows", () => {
    const spawnedCommands: Array<ReadonlyArray<string>> = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const args = commandArgs(command);
        spawnedCommands.push(args);
        if (args.includes("cmd.exe")) {
          return makeSuccessfulProcess("win32\n");
        }
        if (args.includes("node") && args.includes("-")) {
          if (spawnedCommands.filter((entry) => entry.includes("node")).length === 1) {
            return makeSuccessfulProcess('{"remotePort":3773,"serverKind":"managed"}\n');
          }
          if (spawnedCommands.filter((entry) => entry.includes("node")).length === 2) {
            return makeSuccessfulProcess('{"credential":"WINDOWS-PAIRING"}\n');
          }
          return makeSuccessfulProcess('{"stopped":true}\n');
        }
        return makeSuccessfulProcess("\n");
      }),
    );
    const processLayer = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    const target = {
      alias: "winbox",
      hostname: "winbox.example.com",
      username: "developer",
      port: 22,
    } as const;

    return Effect.gen(function* () {
      const launched = yield* launchOrReuseRemoteServer(target);
      const paired = yield* issueRemotePairingToken(target);
      yield* stopRemoteServer(target);

      assert.equal(launched.remotePort, 3773);
      assert.equal(launched.remoteServerKind, "managed");
      assert.equal(paired.credential, "WINDOWS-PAIRING");
      assert.equal(spawnedCommands.filter((args) => args.includes("cmd.exe")).length, 3);
      assert.equal(spawnedCommands.filter((args) => args.includes("node")).length, 3);
      assert.isFalse(spawnedCommands.some((args) => args.includes("sh")));
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("allows cold remote launches to exceed the default SSH command timeout", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.succeed(
        commandArgs(command).includes("cmd.exe")
          ? makeSuccessfulProcess("\n")
          : makeDelayedSuccessfulProcess('{"remotePort":3774}\n', 75_000),
      ),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.mergeAll(NodeServices.layer, spawnerLayer, TestClock.layer());

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(launchOrReuseRemoteServer(target));
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(75));

      const result = yield* Fiber.join(fiber);
      assert.equal(result.remotePort, 3774);
    }).pipe(Effect.provide(processLayer));
  });

  it("allows the remote port picker to run without a state file path", () => {
    assert.include(REMOTE_PICK_PORT_SCRIPT, 'const filePath = process.argv[2] ?? "";');
  });

  it.effect("bounds each HTTP readiness probe so retries cannot hang on one request", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.result(
          waitForHttpReady({
            baseUrl: "http://127.0.0.1:41773/",
            timeoutMs: 1_000,
            intervalMs: 100,
            probeTimeoutMs: 250,
          }),
        ),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(1_000));

      const result = yield* Fiber.join(fiber);

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.include(result.failure.message, "Timed out waiting 1000ms");
      }
    }).pipe(
      Effect.provide(
        Layer.merge(TestClock.layer(), Layer.succeed(HttpClient.HttpClient, hangingHttpClient)),
      ),
    ),
  );

  it("preserves primitive readiness reason values in diagnostic output", () => {
    assert.deepEqual(
      describeReadinessCause({
        _tag: "HttpClientError",
        message: "Backend readiness probe failed.",
        reason: "authentication failed",
        cause: "upstream closed",
      }),
      {
        _tag: "HttpClientError",
        message: "Backend readiness probe failed.",
        reason: "authentication failed",
        cause: "upstream closed",
      },
    );
  });

  it("bounds cyclic and oversized readiness diagnostics", () => {
    const failure: { message: string; cause?: unknown } = {
      message: "m".repeat(2_000),
    };
    failure.cause = failure;

    assert.deepEqual(describeReadinessCause(failure), {
      message: `${"m".repeat(1_024)}…`,
      cause: "[Circular]",
    });
  });

  it.effect("accepts pretty-printed pairing JSON from the remote CLI", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        makeSuccessfulProcess(`{
  "id": "88941235-6ed5-4184-a2ff-5339e2075958",
  "credential": "LCL4R2TPHDKQ",
  "scopes": ["orchestration:read"],
  "expiresAt": "2026-04-29T01:01:20.994Z"
}

`),
      ),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.merge(NodeServices.layer, spawnerLayer);
    return Effect.gen(function* () {
      const result = yield* issueRemotePairingToken(target);
      assert.equal(result.credential, "LCL4R2TPHDKQ");
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("accepts pretty-printed pairing JSON after remote shell startup noise", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        makeSuccessfulProcess(`loaded nvm default
{
  "id": "88941235-6ed5-4184-a2ff-5339e2075958",
  "credential": "LCL4R2TPHDKQ",
  "scopes": ["orchestration:read"],
  "expiresAt": "2026-04-29T01:01:20.994Z"
}

`),
      ),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.merge(NodeServices.layer, spawnerLayer);
    return Effect.gen(function* () {
      const result = yield* issueRemotePairingToken(target);
      assert.equal(result.credential, "LCL4R2TPHDKQ");
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("closes the tunnel scope and starts fresh after disconnect", () => {
    const spawnedCommands: Array<ReadonlyArray<string>> = [];
    let tunnelKillCount = 0;
    let stopCommandCount = 0;
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const args = commandArgs(command);
        spawnedCommands.push(args);
        if (args.includes("-N")) {
          return makeRunningProcess(() => {
            tunnelKillCount += 1;
          });
        }
        if (args.includes("sh") && args.includes("--")) {
          return makeSuccessfulProcess('{"remotePort":3773}\n');
        }
        if (args.includes("sh")) {
          stopCommandCount += 1;
          return makeSuccessfulProcess('{"stopped":true}\n');
        }
        return makeSuccessfulProcess("\n");
      }),
    );
    const layer = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Layer.succeed(HttpClient.HttpClient, testHttpClient),
      Layer.succeed(NetService.NetService, testNetService),
      SshPasswordPrompt.disabledLayer,
      SshEnvironmentManager.layer(),
    );
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;

    return Effect.gen(function* () {
      const manager = yield* SshEnvironmentManager;

      const first = yield* manager.ensureEnvironment(target);
      assert.equal(first.httpBaseUrl, "http://127.0.0.1:41773/");
      const firstTunnelArgs = spawnedCommands.find((args) => args.includes("-N"));
      assert.isDefined(firstTunnelArgs);
      assert.include(firstTunnelArgs, "ControlMaster=no");
      assert.include(firstTunnelArgs, "ControlPath=none");
      assert.include(firstTunnelArgs, "ControlPersist=no");

      yield* manager.disconnectEnvironment(target);
      assert.equal(tunnelKillCount, 1);
      assert.equal(stopCommandCount, 1);

      yield* manager.ensureEnvironment(target);

      assert.equal(spawnedCommands.filter((args) => args.includes("-N")).length, 2);
      assert.equal(tunnelKillCount, 1);
    }).pipe(Effect.provide(layer), Effect.scoped);
  });

  it.effect("releases the cached SSH password after remote cleanup", () => {
    let passwordPromptCount = 0;
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const args = commandArgs(command);
        const authSecret =
          command._tag === "StandardCommand" ? command.options.env?.T3_SSH_AUTH_SECRET : undefined;
        if (args.includes("cmd.exe")) {
          return authSecret
            ? makeSuccessfulProcess("\n")
            : makeFailedProcess("Permission denied (publickey,password).\n");
        }
        if (args.includes("-N")) {
          return makeRunningProcess(() => undefined);
        }
        if (args.includes("sh") && args.includes("--")) {
          return makeSuccessfulProcess('{"remotePort":3773}\n');
        }
        if (args.includes("sh")) {
          return makeSuccessfulProcess('{"stopped":true}\n');
        }
        return makeSuccessfulProcess("\n");
      }),
    );
    const passwordPrompt = SshPasswordPrompt.of({
      isAvailable: true,
      request: () =>
        Effect.sync(() => {
          passwordPromptCount += 1;
          return "ssh-password";
        }),
    });
    const layer = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Layer.succeed(HttpClient.HttpClient, testHttpClient),
      Layer.succeed(NetService.NetService, testNetService),
      Layer.succeed(SshPasswordPrompt, passwordPrompt),
      SshEnvironmentManager.layer(),
    );
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;

    return Effect.gen(function* () {
      const manager = yield* SshEnvironmentManager;
      yield* manager.ensureEnvironment(target);
      yield* manager.disconnectEnvironment(target);
      yield* manager.ensureEnvironment(target);

      assert.equal(passwordPromptCount, 2);
    }).pipe(Effect.provide(layer), Effect.scoped);
  });
});
