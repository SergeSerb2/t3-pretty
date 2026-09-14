import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "../../../scripts/lib/brand-assets.ts";
import { fromYaml } from "@t3tools/shared/schemaYaml";
import serverPackageJson from "../package.json" with { type: "json" };

import { createPackPackageJson, packServerCli } from "./cliPack.ts";

const WorkspaceCatalog = Schema.Struct({
  catalog: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const decodeWorkspaceCatalog = Schema.decodeUnknownSync(fromYaml(WorkspaceCatalog));

const fixturePackageJson = {
  name: "t3",
  version: "0.0.0-fixture",
  repository: {
    type: "git",
    url: "https://example.test/t3",
    directory: "apps/server",
  },
  bin: { t3: "./dist/bin.mjs" },
  type: "module",
  files: ["dist"],
  engines: { node: ">=22" },
  dependencies: {
    effect: "catalog:",
    yaml: "catalog:",
    "node-pty": "^1.1.0",
  },
};

const originalIcon = Buffer.from("original-icon");
const publishIcon = Buffer.from("publish-icon");

const writeFixtureRepo = Effect.fn("writeFixtureRepo")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cli-pack-" });
  const serverDir = path.join(repoRoot, "apps/server");
  const clientDir = path.join(serverDir, "dist/client");
  yield* fs.makeDirectory(clientDir, { recursive: true });
  yield* fs.writeFileString(
    path.join(repoRoot, "pnpm-workspace.yaml"),
    ["catalog:", "  effect: 4.0.0-rc.112", "  yaml: ^2.9.0", ""].join("\n"),
  );
  yield* fs.writeFileString(
    path.join(serverDir, "package.json"),
    `${JSON.stringify(fixturePackageJson, null, 2)}\n`,
  );
  yield* fs.writeFileString(path.join(serverDir, "dist/bin.mjs"), "export {}\n");
  yield* fs.writeFileString(path.join(clientDir, "index.html"), "<html></html>\n");

  for (const icon of resolveWebIconOverrides(
    resolveWebAssetBrandForPackageVersion("1.2.3"),
    "dist/client",
  )) {
    const sourcePath = path.join(repoRoot, icon.sourceRelativePath);
    yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
    yield* fs.writeFile(sourcePath, publishIcon);
    yield* fs.writeFile(path.join(serverDir, icon.targetRelativePath), originalIcon);
  }

  return { repoRoot, serverDir };
});

const readTarballPackageJson = (tarballPath: string) =>
  Effect.try({
    try: () => {
      const extract = NodeChildProcess.spawnSync(
        "tar",
        ["-xOf", tarballPath, "package/package.json"],
        { encoding: "utf8" },
      );
      if (extract.status !== 0) {
        throw new Error(extract.stderr || `tar exited ${extract.status}`);
      }
      return JSON.parse(extract.stdout) as {
        version: string;
        dependencies: Record<string, string>;
        overrides: Record<string, string>;
      };
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

const readTarballIcon = (tarballPath: string, relativePath: string) =>
  Effect.try({
    try: () => {
      const extract = NodeChildProcess.spawnSync("tar", ["-xOf", tarballPath, relativePath]);
      if (extract.status !== 0) {
        throw new Error(extract.stderr.toString() || `tar exited ${extract.status}`);
      }
      return Buffer.from(extract.stdout);
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

describe("createPackPackageJson", () => {
  it("resolves catalog specs and drops pnpm overrides", () => {
    const pkg = createPackPackageJson({
      serverPackageJson: fixturePackageJson,
      catalog: { effect: "4.0.0-rc.112", yaml: "^2.9.0" },
      version: "1.2.3",
    });
    assert.deepStrictEqual(pkg.dependencies, {
      effect: "4.0.0-rc.112",
      yaml: "^2.9.0",
      "node-pty": "^1.1.0",
    });
    assert.deepStrictEqual(pkg.overrides, {});
    assert.equal(pkg.version, "1.2.3");
  });

  it("throws when a catalog key is missing", () => {
    assert.throws(
      () =>
        createPackPackageJson({
          serverPackageJson: fixturePackageJson,
          catalog: { yaml: "^2.9.0" },
          version: "1.2.3",
        }),
      /Unable to resolve 'catalog:' for apps\/server dependency 'effect'/,
    );
  });

  it("resolves every catalog: spec in the real apps/server package", async () => {
    const workspaceYaml = await NodeFSP.readFile(
      NodePath.resolve(
        NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
        "../../../pnpm-workspace.yaml",
      ),
      "utf8",
    );
    const catalog = decodeWorkspaceCatalog(workspaceYaml).catalog ?? {};
    const pkg = createPackPackageJson({
      serverPackageJson: {
        name: serverPackageJson.name,
        repository: serverPackageJson.repository,
        bin: serverPackageJson.bin,
        type: serverPackageJson.type,
        version: serverPackageJson.version,
        engines: serverPackageJson.engines,
        files: serverPackageJson.files,
        dependencies: serverPackageJson.dependencies,
      },
      catalog,
      version: "9.9.9",
    });
    for (const spec of Object.values(pkg.dependencies)) {
      assert.isFalse(spec.startsWith("catalog:"), spec);
    }
  });
});

it.layer(NodeServices.layer)("packServerCli", (it) => {
  it.effect("packs resolved catalog deps and restores the working tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { repoRoot, serverDir } = yield* writeFixtureRepo();
      const originalPackageJson = yield* fs.readFileString(path.join(serverDir, "package.json"));
      const outDir = path.join(repoRoot, "out");

      yield* packServerCli({
        repoRoot,
        appVersion: Option.some("1.2.3"),
        outDir: Option.some(outDir),
        verbose: false,
      });

      const tarballPath = path.join(outDir, "t3-1.2.3.tgz");
      assert.isTrue(yield* fs.exists(tarballPath));
      const packed = yield* readTarballPackageJson(tarballPath);
      assert.equal(packed.version, "1.2.3");
      assert.deepStrictEqual(packed.dependencies, {
        effect: "4.0.0-rc.112",
        yaml: "^2.9.0",
        "node-pty": "^1.1.0",
      });
      assert.deepStrictEqual(packed.overrides ?? {}, {});
      for (const spec of Object.values(packed.dependencies)) {
        assert.isFalse(spec.startsWith("catalog:"), spec);
      }

      const packedIcon = yield* readTarballIcon(tarballPath, "package/dist/client/favicon.ico");
      assert.deepStrictEqual(packedIcon, publishIcon);

      assert.equal(yield* fs.readFileString(path.join(serverDir, "package.json")), originalPackageJson);
      assert.deepStrictEqual(
        yield* fs.readFile(path.join(serverDir, "dist/client/favicon.ico")),
        originalIcon,
      );
    }),
  );
});
