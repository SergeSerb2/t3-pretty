import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import {
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "../../../scripts/lib/brand-assets.ts";
import { resolveCatalogDependencies } from "../../../scripts/lib/resolve-catalog.ts";

import {
  ServerCliBuildAssetMissingError,
  ServerCliCommandExitError,
  ServerCliPublishIconSourceMissingError,
  ServerCliPublishIconTargetMissingError,
} from "./cliErrors.ts";

export interface PackPackageJson {
  name: string;
  repository: {
    type: string;
    url: string;
    directory: string;
  };
  bin: Record<string, string>;
  type: string;
  version: string;
  engines: Record<string, string>;
  files: ReadonlyArray<string>;
  dependencies: Record<string, string>;
  overrides: Record<string, string>;
}

const ServerPackPackageJson = Schema.Struct({
  name: Schema.String,
  repository: Schema.Struct({
    type: Schema.String,
    url: Schema.String,
    directory: Schema.String,
  }),
  bin: Schema.Record(Schema.String, Schema.String),
  type: Schema.String,
  version: Schema.String,
  engines: Schema.Record(Schema.String, Schema.String),
  files: Schema.Array(Schema.String),
  dependencies: Schema.Record(Schema.String, Schema.String),
});

const WorkspaceConfig = Schema.Struct({
  catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const encodePackageJson = Schema.encodeEffect(fromJsonStringPretty(Schema.Unknown));
const decodeWorkspaceConfig = Schema.decodeEffect(fromYaml(WorkspaceConfig));
const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeServerPackPackageJson = Schema.decodeUnknownEffect(ServerPackPackageJson);

const readServerPackPackageJson = Effect.fn("readServerPackPackageJson")(function* (
  packageJsonPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const parsed = yield* decodeJsonUnknown(yield* fs.readFileString(packageJsonPath));
  const record = parsed as Record<string, unknown>;
  // Pick known fields so license/scripts/devDependencies do not need a schema.
  return yield* decodeServerPackPackageJson({
    name: record.name,
    repository: record.repository,
    bin: record.bin,
    type: record.type,
    version: record.version,
    engines: record.engines,
    files: record.files,
    dependencies: record.dependencies,
  });
});

/** Resolve catalog: specs and drop pnpm override selectors for the npm tarball. */
export function createPackPackageJson(input: {
  readonly serverPackageJson: typeof ServerPackPackageJson.Type;
  readonly catalog: Record<string, string>;
  readonly version: string;
}): PackPackageJson {
  return {
    name: input.serverPackageJson.name,
    repository: input.serverPackageJson.repository,
    bin: input.serverPackageJson.bin,
    type: input.serverPackageJson.type,
    version: input.version,
    engines: input.serverPackageJson.engines,
    files: input.serverPackageJson.files,
    dependencies: resolveCatalogDependencies(
      input.serverPackageJson.dependencies,
      input.catalog,
      "apps/server",
    ),
    // pnpm override selectors (`@clerk/clerk-js>`) are not valid npm
    // package names. The tarball only needs resolved runtime deps.
    overrides: {},
  };
}

const readWorkspaceConfig = Effect.fn("readWorkspaceConfig")(function* (repoRoot: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const workspaceYaml = yield* fs.readFileString(path.join(repoRoot, "pnpm-workspace.yaml"));
  return yield* decodeWorkspaceConfig(workspaceYaml);
});

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

const preparePublishIcons = Effect.fn("preparePublishIcons")(function* (
  repoRoot: string,
  serverDir: string,
  version: string,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const brand = resolveWebAssetBrandForPackageVersion(version);
  const icons = resolveWebIconOverrides(brand, "dist/client").map((override) => ({
    sourcePath: path.join(repoRoot, override.sourceRelativePath),
    targetPath: path.join(serverDir, override.targetRelativePath),
  }));

  for (const icon of icons) {
    if (!(yield* fs.exists(icon.sourcePath))) {
      return yield* new ServerCliPublishIconSourceMissingError({ sourcePath: icon.sourcePath });
    }
    if (!(yield* fs.exists(icon.targetPath))) {
      return yield* new ServerCliPublishIconTargetMissingError({ targetPath: icon.targetPath });
    }
  }

  return yield* Effect.forEach(icons, (icon) =>
    Effect.all({
      original: fs.readFile(icon.targetPath),
      publish: fs.readFile(icon.sourcePath),
    }).pipe(Effect.map((contents) => ({ ...icon, ...contents }))),
  );
});

export const packServerCli = Effect.fn("packServerCli")(function* (input: {
  readonly repoRoot: string;
  readonly appVersion: Option.Option<string>;
  readonly outDir: Option.Option<string>;
  readonly verbose: boolean;
}) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const serverDir = path.join(input.repoRoot, "apps/server");
  const packageJsonPath = path.join(serverDir, "package.json");
  const outDir = Option.match(input.outDir, {
    onNone: () => serverDir,
    onSome: (value) => (path.isAbsolute(value) ? value : path.join(input.repoRoot, value)),
  });

  // `cli.ts build` emits bin.mjs (the `t3` bin, which hosts the hidden
  // `__service-launcher` subcommand) and copies the web client. There is
  // no sibling service-launcher entry: remotes install this tarball with
  // npm and run `t3 __service-launcher` through the bin shim.
  for (const relPath of ["dist/bin.mjs", "dist/client/index.html"]) {
    const abs = path.join(serverDir, relPath);
    if (!(yield* fs.exists(abs))) {
      return yield* new ServerCliBuildAssetMissingError({ assetPath: abs });
    }
  }

  yield* fs.makeDirectory(outDir, { recursive: true });

  yield* Effect.acquireUseRelease(
    Effect.gen(function* () {
      const serverPackageJson = yield* readServerPackPackageJson(packageJsonPath);
      const version = Option.getOrElse(input.appVersion, () => serverPackageJson.version);
      const workspaceConfig = yield* readWorkspaceConfig(input.repoRoot);
      const pkg = createPackPackageJson({
        serverPackageJson,
        catalog: workspaceConfig.catalog ?? {},
        version,
      });

      return {
        version,
        packageJsonString: yield* encodePackageJson(pkg),
        originalPackageJson: yield* fs.readFile(packageJsonPath),
        icons: yield* preparePublishIcons(input.repoRoot, serverDir, version),
      };
    }),
    (resource) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(packageJsonPath, `${resource.packageJsonString}\n`);
        for (const icon of resource.icons) {
          yield* fs.writeFile(icon.targetPath, icon.publish);
        }
        const tarballName = `t3-${resource.version}.tgz`;
        yield* Effect.log(`[cli] Packing ${tarballName} into ${outDir}`);
        const spawnCommand = yield* resolveSpawnCommand("npm", [
          "pack",
          "--pack-destination",
          outDir,
        ]);
        yield* runCommand(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            cwd: serverDir,
            stdout: input.verbose ? "inherit" : "ignore",
            stderr: "inherit",
            shell: spawnCommand.shell,
          }),
        );
        const tarballPath = path.join(outDir, tarballName);
        if (!(yield* fs.exists(tarballPath))) {
          return yield* new ServerCliBuildAssetMissingError({ assetPath: tarballPath });
        }
        yield* Effect.log(`[cli] Packed ${tarballPath}`);
      }),
    (resource) =>
      Effect.gen(function* () {
        yield* fs.writeFile(packageJsonPath, resource.originalPackageJson);
        for (const icon of resource.icons) {
          yield* fs.writeFile(icon.targetPath, icon.original);
        }
        if (input.verbose) yield* Effect.log("[cli] Restored original pack assets");
      }),
  );
});
