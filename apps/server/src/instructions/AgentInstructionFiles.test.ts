// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import { AgentInstructionFiles, make } from "./AgentInstructionFiles.ts";

const stubWorkspaceEntriesLayer = Layer.succeed(
  WorkspaceEntries.WorkspaceEntries,
  WorkspaceEntries.WorkspaceEntries.of({
    browse: () => Effect.die("unused" as never),
    list: () => Effect.die("unused" as never),
    search: () => Effect.die("unused" as never),
    searchContents: () => Effect.die("unused" as never),
    refresh: () => Effect.void,
  }),
);

type TestProviderInstances = Record<
  string,
  { driver: string; displayName?: string; config?: unknown }
>;

const makeService = (overrides: { providerInstances?: TestProviderInstances } = {}) =>
  make.pipe(
    Effect.provide(
      Layer.mergeAll(
        serverSettingsLayerTest(
          overrides as unknown as Parameters<typeof serverSettingsLayerTest>[0],
        ),
        stubWorkspaceEntriesLayer,
      ),
    ),
  );

it.layer(NodeServices.layer)("AgentInstructionFiles", (it) => {
  it.effect("lists a default global row per built-in driver", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const service = yield* makeService();
      const { files } = yield* service.list({});

      const ids = files.map((file) => file.id);
      assert.includeMembers(ids, [
        "global:codex",
        "global:claudeAgent",
        "global:cursor",
        "global:grok",
      ]);
      const codex = files.find((file) => file.id === "global:codex");
      assert.isDefined(codex);
      assert.strictEqual(codex.absolutePath, path.join(NodeOS.homedir(), ".codex", "AGENTS.md"));
      assert.strictEqual(codex.displayPath, "~/.codex/AGENTS.md");
      assert.strictEqual(codex.scope, "global");
      assert.strictEqual(codex.fileName, "AGENTS.md");
      assert.isUndefined(files.find((file) => file.scope === "project"));
    }),
  );

  it.effect("surfaces instance rows only for custom home paths, deduplicated", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-instructions-" });
      const codexHome = path.join(tempDir, "codex-work");
      const service = yield* makeService({
        providerInstances: {
          codex_work: { driver: "codex", displayName: "Work", config: { homePath: codexHome } },
          codex_default: { driver: "codex", config: {} },
        },
      });

      const { files } = yield* service.list({});
      const instanceRows = files.filter((file) => file.instanceId !== undefined);
      assert.lengthOf(instanceRows, 1);
      assert.strictEqual(instanceRows[0]?.id, "global:codex:codex_work");
      assert.strictEqual(instanceRows[0]?.title, "Codex · Work");
      assert.strictEqual(instanceRows[0]?.absolutePath, path.join(codexHome, "AGENTS.md"));
      assert.strictEqual(instanceRows[0]?.exists, false);
    }),
  );

  it.effect("writes, stats, and reads back a global instance file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-instructions-" });
      const codexHome = path.join(tempDir, "codex-home");
      const service = yield* makeService({
        providerInstances: {
          codex_work: { driver: "codex", config: { homePath: codexHome } },
        },
      });

      const contents = "# Global rules\n\nBe terse.\n";
      const written = yield* service.write({ fileId: "global:codex:codex_work", contents });
      assert.strictEqual(written.file.exists, true);
      assert.strictEqual(written.file.sizeBytes, contents.length);
      assert.isDefined(written.file.modifiedAtMs);

      const read = yield* service.read({ fileId: "global:codex:codex_work" });
      assert.strictEqual(read.contents, contents);
      assert.strictEqual(read.truncated, false);
      assert.strictEqual(yield* fs.readFileString(path.join(codexHome, "AGENTS.md")), contents);
    }),
  );

  it.effect("lists and round-trips project-scope files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-workspace-" });
      yield* fs.writeFileString(path.join(workspace, "CLAUDE.md"), "# Project\n");
      const service = yield* makeService();

      const { files } = yield* service.list({ projectCwd: workspace });
      const projectRows = files.filter((file) => file.scope === "project");
      assert.deepEqual(
        projectRows.map((file) => [file.id, file.exists]),
        [
          ["project:AGENTS.md", false],
          ["project:CLAUDE.md", true],
          ["project:CLAUDE.local.md", false],
        ],
      );

      const missing = yield* service.read({ fileId: "project:AGENTS.md", projectCwd: workspace });
      assert.strictEqual(missing.contents, "");
      assert.strictEqual(missing.file.exists, false);

      yield* service.write({
        fileId: "project:AGENTS.md",
        projectCwd: workspace,
        contents: "# Rules\n",
      });
      const read = yield* service.read({ fileId: "project:AGENTS.md", projectCwd: workspace });
      assert.strictEqual(read.contents, "# Rules\n");
    }),
  );

  it.effect("rejects unknown ids, bad roots, and oversized writes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agent-workspace-" });
      const service = yield* makeService();

      const unknown = yield* service.read({ fileId: "global:nonsense" }).pipe(Effect.flip);
      assert.strictEqual(unknown.failure, "unknown_file");

      const missingCwd = yield* service.read({ fileId: "project:AGENTS.md" }).pipe(Effect.flip);
      assert.strictEqual(missingCwd.failure, "unknown_file");

      const relativeRoot = yield* service.list({ projectCwd: "not/absolute" }).pipe(Effect.flip);
      assert.strictEqual(relativeRoot.failure, "invalid_project_root");

      const tooLarge = yield* service
        .write({
          fileId: "project:AGENTS.md",
          projectCwd: workspace,
          contents: "x".repeat(1024 * 1024 + 1),
        })
        .pipe(Effect.flip);
      assert.strictEqual(tooLarge.failure, "too_large");
    }),
  );
});

it.effect("service tag resolves through the layer", () =>
  Effect.gen(function* () {
    const service = yield* AgentInstructionFiles;
    const { files } = yield* service.list({});
    assert.isAbove(files.length, 0);
  }).pipe(
    Effect.provide(
      Layer.effect(
        AgentInstructionFiles,
        make.pipe(
          Effect.provide(Layer.mergeAll(serverSettingsLayerTest(), stubWorkspaceEntriesLayer)),
        ),
      ).pipe(Layer.provide(NodeServices.layer)),
    ),
  ),
);
