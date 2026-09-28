#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeZlib from "node:zlib";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DEVELOPMENT_ICON_OVERRIDES } from "../../../scripts/lib/brand-assets.ts";
import { findEsmImportsOfExternalPackages } from "../../../scripts/lib/cli-executable-imports.ts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { packServerCli } from "./cliPack.ts";
import {
  ServerCliBuildAssetMissingError,
  ServerCliCommandExitError,
  ServerCliDevelopmentIconSourceMissingError,
  ServerCliDevelopmentIconTargetMissingError,
  ServerCliExecutableImportError,
} from "./cliErrors.ts";

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../../..", import.meta.url))),
);

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.StandardCommand) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new ServerCliCommandExitError({
      command: command.command,
      args: command.args,
      cwd: command.options.cwd,
      exitCode,
    });
  }
});

const applyDevelopmentIconOverrides = Effect.fn("applyDevelopmentIconOverrides")(function* (
  repoRoot: string,
  serverDir: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  for (const override of DEVELOPMENT_ICON_OVERRIDES) {
    const sourcePath = path.join(repoRoot, override.sourceRelativePath);
    const targetPath = path.join(serverDir, override.targetRelativePath);

    if (!(yield* fs.exists(sourcePath))) {
      return yield* new ServerCliDevelopmentIconSourceMissingError({ sourcePath });
    }
    if (!(yield* fs.exists(targetPath))) {
      return yield* new ServerCliDevelopmentIconTargetMissingError({ targetPath });
    }

    yield* fs.copyFile(sourcePath, targetPath);
  }

  yield* Effect.log("[cli] Applied development icon overrides to dist/client");
});

const PRECOMPRESS_EXTENSIONS = new Set([".js", ".css", ".mjs", ".svg", ".html", ".json", ".woff2"]);

const writePrecompressedClientAssets = Effect.fn("writePrecompressedClientAssets")(function* (
  clientTarget: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs
    .readDirectory(clientTarget, { recursive: true })
    .pipe(Effect.orElseSucceed(() => [] as Array<string>));
  let written = 0;
  for (const entry of entries) {
    const ext = path.extname(entry);
    if (!PRECOMPRESS_EXTENSIONS.has(ext) || entry.endsWith(".br")) continue;
    const filePath = path.isAbsolute(entry) ? entry : path.join(clientTarget, entry);
    const data = yield* fs.readFile(filePath).pipe(Effect.orElseSucceed(() => null));
    if (!data || data.byteLength === 0) continue;
    const compressed = NodeZlib.brotliCompressSync(data, {
      params: {
        [NodeZlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [NodeZlib.constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
      },
    });
    yield* fs.writeFile(`${filePath}.br`, compressed);
    written += 1;
  }
  if (written > 0) {
    yield* Effect.log(`[cli] Wrote ${written} precompressed .br client assets`);
  }
});

// ---------------------------------------------------------------------------
// build subcommand
// ---------------------------------------------------------------------------

const buildCmd = Command.make(
  "build",
  {
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");

      yield* Effect.log("[cli] Running tsdown...");
      yield* runCommand(
        ChildProcess.make(process.execPath, ["--run", "build:bundle"], {
          cwd: serverDir,
          stdout: config.verbose ? "inherit" : "ignore",
          stderr: "inherit",
          shell: false,
        }),
      );

      const webDist = path.join(repoRoot, "apps/web/dist");
      const clientTarget = path.join(serverDir, "dist/client");

      if (yield* fs.exists(webDist)) {
        yield* fs.copy(webDist, clientTarget);
        yield* applyDevelopmentIconOverrides(repoRoot, serverDir);
        yield* writePrecompressedClientAssets(clientTarget);
        yield* Effect.log("[cli] Bundled web app into dist/client");
      } else {
        yield* Effect.logWarning("[cli] Web dist not found — skipping client bundle.");
      }
    }),
).pipe(Command.withDescription("Build the server package (tsdown + bundle web client)."));

// ---------------------------------------------------------------------------
// build-exe subcommand
// ---------------------------------------------------------------------------

const buildExeCmd = Command.make(
  "build-exe",
  {
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
    target: Flag.String("target").pipe(
      Flag.withDescription(
        "Cross-build for <platform>-<arch> in nodejs.org naming (for example darwin-x64); defaults to the host.",
      ),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* RepoRoot;
      const serverDir = path.join(repoRoot, "apps/server");

      yield* Effect.log("[cli] Building single-executable...");
      const spawnCommand = yield* resolveSpawnCommand("vp", ["pack"]);
      yield* runCommand(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: serverDir,
          env: {
            ...process.env,
            T3CODE_PACK_EXE: "1",
            ...Option.match(config.target, {
              onNone: () => ({}),
              onSome: (target) => ({ T3CODE_PACK_EXE_TARGET: target }),
            }),
          },
          stdout: config.verbose ? "inherit" : "ignore",
          stderr: "inherit",
          shell: spawnCommand.shell,
        }),
      );

      // The executable can only `import` built-ins. A file-backed import
      // passes the bundler and `node dist/bin.mjs`, then throws inside the
      // binary, so read the emitted module graph rather than trusting config.
      const bundlePath = path.join(serverDir, "dist-exe/bin.mjs");
      const specifiers = findEsmImportsOfExternalPackages(yield* fs.readFileString(bundlePath));
      if (specifiers.length > 0) {
        return yield* new ServerCliExecutableImportError({ bundlePath, specifiers });
      }
      yield* Effect.log(
        "[cli] Built dist-exe/t3 (expects client/, resource-monitor/, and the runtime-external node_modules beside it; scripts/build-cli-archive.ts assembles that tree)",
      );
    }),
).pipe(
  Command.withDescription(
    "Build the server as a Node single-executable (needs a Node 25.7+ host for --build-sea). The binary still resolves native packages from a node_modules tree beside it.",
  ),
);

// ---------------------------------------------------------------------------
// publish subcommand
// ---------------------------------------------------------------------------

/**
 * Publishes the tarballs scripts/build-npm-platform-packages.ts produced:
 * every `@t3code/t3-<platform>.tgz` first, `t3.tgz` (the launcher) last, so
 * the launcher is never installable before the executables it depends on.
 * Tarballs rather than directories because `npm publish <dir>` strips the
 * `node_modules/` the executable loads its native addons from.
 */
const publishCmd = Command.make(
  "publish",
  {
    packagesDir: Flag.String("packages-dir").pipe(
      Flag.withDescription("Output dir of scripts/build-npm-platform-packages.ts."),
    ),
    tag: Flag.String("tag").pipe(Flag.withDefault("latest")),
    access: Flag.String("access").pipe(Flag.withDefault("public")),
    provenance: Flag.Boolean("provenance").pipe(Flag.withDefault(false)),
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      // npm runs with cwd set to the packages dir below, so tarball paths are
      // resolved once here rather than joined twice.
      const packagesDir = path.resolve(config.packagesDir);
      const scopeDir = path.join(packagesDir, "@t3code");
      const launcherTarball = path.join(packagesDir, "t3.tgz");
      const platformTarballs = (yield* fs
        .readDirectory(scopeDir)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])))
        .filter((entry) => entry.startsWith("t3-") && entry.endsWith(".tgz"))
        .sort()
        .map((entry) => path.join(scopeDir, entry));
      if (platformTarballs.length === 0) {
        return yield* new ServerCliBuildAssetMissingError({
          assetPath: path.join(scopeDir, "t3-<platform>.tgz"),
        });
      }
      if (!(yield* fs.exists(launcherTarball))) {
        return yield* new ServerCliBuildAssetMissingError({ assetPath: launcherTarball });
      }

      const args = ["publish", "--access", config.access, "--tag", config.tag];
      if (config.provenance) args.push("--provenance");
      if (config.dryRun) args.push("--dry-run");

      for (const tarball of [...platformTarballs, launcherTarball]) {
        const spawnCommand = yield* resolveSpawnCommand("npm", [...args, tarball]);
        yield* Effect.log(`[cli] npm ${args.join(" ")} ${path.basename(tarball)}`);
        yield* runCommand(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: packagesDir,
            stdout: config.verbose ? "inherit" : "ignore",
            stderr: "inherit",
            shell: spawnCommand.shell,
          }),
        );
      }
    }),
).pipe(
  Command.withDescription(
    "Publish the @t3code/t3-<platform> tarballs and then the t3 launcher to npm.",
  ),
);

const packCmd = Command.make(
  "pack",
  {
    appVersion: Flag.String("app-version").pipe(Flag.optional),
    outDir: Flag.String("out-dir").pipe(Flag.optional),
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const repoRoot = yield* RepoRoot;
      yield* packServerCli({
        repoRoot,
        appVersion: config.appVersion,
        outDir: config.outDir,
        verbose: config.verbose,
      });
    }),
).pipe(Command.withDescription("Pack the server package as a tarball without publishing to npm."));

// ---------------------------------------------------------------------------
// root command
// ---------------------------------------------------------------------------

const cli = Command.make("cli").pipe(
  Command.withDescription("T3 server build & publish CLI."),
  Command.withSubcommands([buildCmd, buildExeCmd, publishCmd, packCmd]),
);

Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide([Logger.layer([Logger.consolePretty()]), NodeServices.layer]),
  NodeRuntime.runMain,
);
