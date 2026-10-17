/**
 * AgentPerfCli - runs one Agent Perf benchmark on this machine.
 *
 * Agent Perf (https://github.com/SergeSerb2/agentperf) times the local work
 * behind agent tool calls and scores it as AgentMark, where its reference
 * machine scores 1000. It is a single-file Python app. Every machine runs the
 * same pinned release, so scores compare across a user's machines. The
 * release is downloaded once and must match a pinned SHA-256 before it runs.
 *
 * @module AgentPerfCli
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";

export const AGENTPERF_VERSION = "0.4.1";
const AGENTPERF_URL = `https://github.com/SergeSerb2/agentperf/releases/download/v${AGENTPERF_VERSION}/agentperf.pyz`;
const AGENTPERF_SHA256 = "b6d5ef32c9e506c96638b95e35eb8c56d72945893e575b5cbc2272d729435592";
/** A quick run takes minutes; a Windows host with real-time antivirus is far slower. */
const RUN_TIMEOUT = Duration.hours(1);
/** Agent Perf's lock file in its work folder. */
const WORKDIR_LOCK = ".agentperf-run.lock";

export class AgentPerfError extends Schema.TaggedError<AgentPerfError>()("AgentPerfError", {
  message: Schema.String,
}) {}

export class AgentPerfCli extends Context.Service<
  AgentPerfCli,
  {
    /** Runs the quick suite and returns its AgentMark. Interrupting it stops the run. */
    readonly run: Effect.Effect<number, AgentPerfError>;
  }
>()("t3/agentPerf/AgentPerfCli") {}

const RunSummary = Schema.Struct({
  ok: Schema.optionalKey(Schema.Boolean),
  error: Schema.optionalKey(Schema.String),
  agentmark: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
const decodeRunSummary = Schema.decodeUnknownOption(Schema.fromJsonString(RunSummary));

/** Reads AgentMark from `agentperf run --json=-` output. */
export function parseRunOutput(exitCode: number, stdout: string): number | AgentPerfError {
  const summary = decodeRunSummary(stdout.trim());
  const agentMark = Option.isSome(summary) ? summary.value.agentmark : undefined;
  if (exitCode === 0 && typeof agentMark === "number" && Number.isFinite(agentMark)) {
    if (agentMark > 0) return agentMark;
  }
  const reason = Option.isSome(summary) ? summary.value.error : undefined;
  return new AgentPerfError({
    message: reason
      ? `Agent Perf failed: ${reason}`
      : `Agent Perf exited with code ${exitCode} and no score.`,
  });
}

function pythonCandidates(platform: NodeJS.Platform): ReadonlyArray<ReadonlyArray<string>> {
  return platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("AgentPerfCli.make")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const httpClient = yield* HttpClient.HttpClient;
  const platform = yield* HostProcess.Platform;

  const directory = path.join(config.stateDir, "agentperf");
  const pyzPath = path.join(directory, `agentperf-${AGENTPERF_VERSION}.pyz`);
  const workdir = path.join(directory, "work");

  const sha256 = (bytes: Uint8Array) =>
    Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
      Effect.map((digest) => Hex.encode(new Uint8Array(digest))),
    );

  const findPython = Effect.gen(function* () {
    for (const [command, ...args] of pythonCandidates(platform)) {
      const exitCode = yield* spawner
        .exitCode(
          ChildProcess.make(
            command!,
            [...args, "-c", "import sys; sys.exit(sys.version_info < (3, 8))"],
            { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
          ),
        )
        .pipe(
          Effect.timeout("15 seconds"),
          Effect.orElseSucceed(() => -1),
        );
      if (exitCode === 0) return [command!, ...args];
    }
    return yield* new AgentPerfError({ message: "Python 3.8 or newer is not installed." });
  });

  const ensurePyz = Effect.gen(function* () {
    const existing = yield* fs.readFile(pyzPath).pipe(Effect.option);
    if (Option.isSome(existing) && (yield* sha256(existing.value)) === AGENTPERF_SHA256) {
      return;
    }
    const bytes = yield* httpClient.execute(HttpClientRequest.get(AGENTPERF_URL)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.timeout("2 minutes"),
      Effect.mapError(() => new AgentPerfError({ message: "Could not download Agent Perf." })),
    );
    if ((yield* sha256(bytes)) !== AGENTPERF_SHA256) {
      return yield* new AgentPerfError({
        message: "The downloaded Agent Perf did not match its pinned checksum.",
      });
    }
    const partialPath = `${pyzPath}.partial`;
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFile(partialPath, bytes);
    yield* fs.rename(partialPath, pyzPath);
  });

  const runSuite = (python: ReadonlyArray<string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const [command, ...args] = python;
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            command!,
            [
              ...args,
              pyzPath,
              "run",
              "--quick",
              // Same ripgrep build on every machine, so search scores compare.
              "--fetch-tools",
              // Reach measures the network, not the machine.
              "--no-network",
              "--clean",
              "--workdir",
              workdir,
              "--out",
              path.join(directory, "last-result.json"),
              "--json=-",
            ],
            {
              cwd: directory,
              stdin: "ignore",
              stderr: "ignore",
              // On interruption Python unwinds and removes its work folder lock.
              killSignal: "SIGINT",
              forceKillAfter: "30 seconds",
            },
          ),
        );
        const [stdout, exitCode] = yield* Effect.all(
          [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
          { concurrency: "unbounded" },
        );
        return { stdout, exitCode };
      }),
    );

  const run = Effect.gen(function* () {
    const python = yield* findPython;
    yield* ensurePyz;
    // Only this service uses this work folder, one run at a time, so a lock
    // here was left by a run that was killed (Windows cannot deliver SIGINT).
    yield* fs.remove(path.join(workdir, WORKDIR_LOCK), { force: true }).pipe(Effect.ignore);
    const output = yield* runSuite(python).pipe(
      Effect.timeoutOption(RUN_TIMEOUT),
      Effect.mapError(() => new AgentPerfError({ message: "Agent Perf could not be started." })),
    );
    if (Option.isNone(output)) {
      return yield* new AgentPerfError({ message: "Agent Perf did not finish within an hour." });
    }
    const result = parseRunOutput(output.value.exitCode, output.value.stdout);
    return typeof result === "number" ? result : yield* result;
  }).pipe(
    Effect.catchTags({
      PlatformError: () =>
        Effect.fail(new AgentPerfError({ message: "Could not save Agent Perf." })),
    }),
  );

  return AgentPerfCli.of({ run });
});

export const layer = Layer.effect(AgentPerfCli, make());
