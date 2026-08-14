import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as SkillStore from "./SkillStore.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SkillStore.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-store-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

/** Write a source skill directory in a fresh temp dir and return its path. */
const makeSourceSkill = Effect.fn(function* (contents: string, extraFile?: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-source-" });
  yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
  if (extraFile !== undefined) {
    yield* fileSystem.writeFileString(path.join(directory, "cheatsheet.md"), extraFile);
  }
  return directory;
});

it.layer(TestLayer)("SkillStore", (it) => {
  it.effect("installs a directory into the store and reports it in the state", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const store = yield* SkillStore.SkillStore;
      const source = yield* makeSourceSkill(
        ["---", "name: tdd", "description: Test driven development.", "---", "", "# TDD"].join(
          "\n",
        ),
        "red green refactor",
      );

      const state = yield* store.installFromDirectory({
        sourceRepo: "octocat/store-basic",
        sourcePath: "skills/engineering/tdd",
        directory: source,
      });

      assert.deepStrictEqual(state.installedSkills, [
        {
          id: "octocat/store-basic:skills/engineering/tdd",
          name: "tdd",
          description: "Test driven development.",
          sourceRepo: "octocat/store-basic",
          sourcePath: "skills/engineering/tdd",
          installedAt: state.installedSkills[0]!.installedAt,
        },
      ]);
      assert.match(state.installedSkills[0]!.installedAt, /^\d{4}-\d{2}-\d{2}T/);

      const storedDir = path.join(
        config.skillsDir,
        "octocat--store-basic",
        "skills",
        "engineering",
        "tdd",
      );
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(storedDir, "cheatsheet.md")),
        "red green refactor",
      );
      const metadata = yield* fileSystem.readFileString(
        path.join(storedDir, SkillStore.SKILL_METADATA_FILE),
      );
      assert.match(metadata, /"installedAt"/);
    }),
  );

  it.effect("falls back to the directory name when frontmatter is missing or malformed", () =>
    Effect.gen(function* () {
      const store = yield* SkillStore.SkillStore;
      const missing = yield* makeSourceSkill("# Just a heading\n");
      const malformed = yield* makeSourceSkill("---\nname: [unclosed\n---\n");

      yield* store.installFromDirectory({
        sourceRepo: "octocat/store-fallback",
        sourcePath: "skills/no-frontmatter",
        directory: missing,
      });
      const state = yield* store.installFromDirectory({
        sourceRepo: "octocat/store-fallback",
        sourcePath: "skills/broken-yaml",
        directory: malformed,
      });

      const byId = new Map(state.installedSkills.map((skill) => [skill.id, skill]));
      const noFrontmatter = byId.get("octocat/store-fallback:skills/no-frontmatter");
      const brokenYaml = byId.get("octocat/store-fallback:skills/broken-yaml");
      assert.strictEqual(noFrontmatter?.name, "no-frontmatter");
      assert.strictEqual(noFrontmatter?.description, undefined);
      assert.strictEqual(brokenYaml?.name, "broken-yaml");
      assert.strictEqual(brokenYaml?.description, undefined);
    }),
  );

  it.effect("replaces an existing install for the same skill id", () =>
    Effect.gen(function* () {
      const store = yield* SkillStore.SkillStore;
      const first = yield* makeSourceSkill("---\nname: tdd\ndescription: v1\n---\n");
      const second = yield* makeSourceSkill("---\nname: tdd\ndescription: v2\n---\n");

      yield* store.installFromDirectory({
        sourceRepo: "octocat/store-replace",
        sourcePath: "skills/tdd",
        directory: first,
      });
      const state = yield* store.installFromDirectory({
        sourceRepo: "octocat/store-replace",
        sourcePath: "skills/tdd",
        directory: second,
      });

      const matches = state.installedSkills.filter(
        (skill) => skill.id === "octocat/store-replace:skills/tdd",
      );
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0]?.description, "v2");
    }),
  );

  it.effect("rejects install directories without a SKILL.md", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const store = yield* SkillStore.SkillStore;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-source-" });

      const error = yield* Effect.flip(
        store.installFromDirectory({
          sourceRepo: "octocat/store-invalid",
          sourcePath: "skills/empty",
          directory,
        }),
      );

      assert.strictEqual(error._tag, "SkillsError");
      assert.strictEqual(error.operation, "install");
      assert.match(error.message, /no SKILL\.md/);
    }),
  );

  it.effect("rejects traversal in skill locations", () =>
    Effect.gen(function* () {
      const store = yield* SkillStore.SkillStore;
      const source = yield* makeSourceSkill("---\nname: tdd\n---\n");

      const installError = yield* Effect.flip(
        store.installFromDirectory({
          sourceRepo: "octocat/store-traversal",
          sourcePath: "../escape",
          directory: source,
        }),
      );
      assert.strictEqual(installError.operation, "install");
      assert.match(installError.message, /Invalid skill id/);

      const uninstallError = yield* Effect.flip(
        store.uninstall("octocat/store-traversal:../../escape"),
      );
      assert.strictEqual(uninstallError.operation, "uninstall");

      const resolveError = yield* Effect.flip(
        store.resolveSkillDirectory("octocat/store-traversal:skills/../../escape"),
      );
      assert.strictEqual(resolveError.operation, "read-store");

      const badRepoError = yield* Effect.flip(store.uninstall("octocat/../../etc:skills/tdd"));
      assert.strictEqual(badRepoError.operation, "uninstall");
    }),
  );

  it.effect("uninstalls a skill, prunes empty store directories, and errors when absent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const store = yield* SkillStore.SkillStore;
      const source = yield* makeSourceSkill("---\nname: tdd\n---\n");
      const skillId = "octocat/store-uninstall:skills/engineering/tdd";

      yield* store.installFromDirectory({
        sourceRepo: "octocat/store-uninstall",
        sourcePath: "skills/engineering/tdd",
        directory: source,
      });
      const state = yield* store.uninstall(skillId);

      assert.isFalse(state.installedSkills.some((skill) => skill.id === skillId));
      // The emptied repo dir is pruned from the store root.
      assert.isFalse(
        yield* fileSystem.exists(path.join(config.skillsDir, "octocat--store-uninstall")),
      );

      const error = yield* Effect.flip(store.uninstall(skillId));
      assert.strictEqual(error.operation, "uninstall");
      assert.match(error.message, /not installed/);
    }),
  );

  it.effect("resolves the absolute directory of an installed skill", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const store = yield* SkillStore.SkillStore;
      const source = yield* makeSourceSkill("---\nname: tdd\n---\n");

      yield* store.installFromDirectory({
        sourceRepo: "octocat/store-resolve",
        sourcePath: "skills/tdd",
        directory: source,
      });
      const resolved = yield* store.resolveSkillDirectory("octocat/store-resolve:skills/tdd");

      assert.strictEqual(
        resolved,
        path.join(config.skillsDir, "octocat--store-resolve", "skills", "tdd"),
      );
    }),
  );
});
