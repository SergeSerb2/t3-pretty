import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { HostSkill } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as HostSkills from "./HostSkills.ts";
import * as SkillMaterializer from "./SkillMaterializer.ts";
import * as SkillStore from "./SkillStore.ts";

/** Host-folder skills the mocked `HostSkills.list` reports; tests push into it. */
const hostSkillsFixture: Array<HostSkill> = [];

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SkillStore.layer),
  Layer.provideMerge(
    SkillMaterializer.layer.pipe(
      Layer.provide(SkillStore.layer),
      Layer.provide(
        Layer.mock(HostSkills.HostSkills)({
          list: Effect.sync(() => ({ skills: [...hostSkillsFixture] })),
        }),
      ),
    ),
  ),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-materializer-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

/** Install a skill into the store straight from an in-test source directory. */
const installSkill = Effect.fn(function* (input: {
  readonly sourceRepo: string;
  readonly sourcePath: string;
  readonly skillMd: string;
  readonly extraFile?: { readonly name: string; readonly contents: string };
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* SkillStore.SkillStore;
  const source = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-source-" });
  yield* fileSystem.writeFileString(path.join(source, "SKILL.md"), input.skillMd);
  if (input.extraFile) {
    yield* fileSystem.writeFileString(
      path.join(source, input.extraFile.name),
      input.extraFile.contents,
    );
  }
  yield* store.installFromDirectory({
    sourceRepo: input.sourceRepo,
    sourcePath: input.sourcePath,
    directory: source,
  });
  return `${input.sourceRepo}:${input.sourcePath}`;
});

const readOptional = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
  });

it.layer(TestLayer)("SkillMaterializer", (it) => {
  it.effect("writes each enabled skill into both roots with a managed marker", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const skillId = yield* installSkill({
        sourceRepo: "octocat/materialize-basic",
        sourcePath: "skills/tdd",
        skillMd: ["---", "name: TDD Skill", "description: Test driven.", "---"].join("\n"),
        extraFile: { name: "cheatsheet.md", contents: "red green refactor" },
      });

      const result = yield* materializer.materialize({ cwd, skillIds: [skillId] });

      for (const root of [".claude/skills", ".agents/skills"]) {
        const skillDir = path.join(cwd, root, "tdd-skill");
        assert.include(result.written, skillDir);
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(skillDir, "SKILL.md")),
          ["---", "name: TDD Skill", "description: Test driven.", "---"].join("\n"),
        );
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(skillDir, "cheatsheet.md")),
          "red green refactor",
        );
        assert.strictEqual(
          yield* fileSystem.readFileString(
            path.join(skillDir, SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
          ),
          skillId,
        );
        // Store-local metadata never leaks into the workspace.
        assert.strictEqual(
          yield* readOptional(path.join(skillDir, SkillStore.SKILL_METADATA_FILE)),
          undefined,
        );
      }
      assert.deepStrictEqual(result.removed, []);
      assert.deepStrictEqual(result.loaded, [{ id: skillId, name: "TDD Skill" }]);
    }),
  );

  it.effect("removes stale managed dirs and refreshes changed content", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const store = yield* SkillStore.SkillStore;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const keepId = yield* installSkill({
        sourceRepo: "octocat/materialize-reconcile",
        sourcePath: "skills/keep",
        skillMd: "---\nname: keep\ndescription: v1\n---\n",
      });
      const dropId = yield* installSkill({
        sourceRepo: "octocat/materialize-reconcile",
        sourcePath: "skills/drop",
        skillMd: "---\nname: drop\n---\n",
      });

      yield* materializer.materialize({ cwd, skillIds: [keepId, dropId] });

      // The store copy changes underneath an already-materialized skill.
      const updatedSource = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-skill-source-",
      });
      yield* fileSystem.writeFileString(
        path.join(updatedSource, "SKILL.md"),
        "---\nname: keep\ndescription: v2\n---\n",
      );
      yield* store.installFromDirectory({
        sourceRepo: "octocat/materialize-reconcile",
        sourcePath: "skills/keep",
        directory: updatedSource,
      });

      const result = yield* materializer.materialize({ cwd, skillIds: [keepId] });

      for (const root of [".claude/skills", ".agents/skills"]) {
        assert.include(result.removed, path.join(cwd, root, "drop"));
        assert.isFalse(yield* fileSystem.exists(path.join(cwd, root, "drop")));
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(cwd, root, "keep", "SKILL.md")),
          "---\nname: keep\ndescription: v2\n---\n",
        );
      }
    }),
  );

  it.effect("preserves user-owned directories, including name collisions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const skillId = yield* installSkill({
        sourceRepo: "octocat/materialize-collision",
        sourcePath: "skills/tdd",
        skillMd: "---\nname: tdd\n---\n",
      });

      // A user-authored skill with no marker, one colliding with the desired
      // name and one alongside it.
      const userSkillDir = path.join(cwd, ".claude", "skills", "tdd");
      const otherUserDir = path.join(cwd, ".claude", "skills", "mine");
      yield* fileSystem.makeDirectory(userSkillDir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(userSkillDir, "SKILL.md"), "user owned");
      yield* fileSystem.makeDirectory(otherUserDir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(otherUserDir, "SKILL.md"), "also user owned");

      const result = yield* materializer.materialize({ cwd, skillIds: [skillId] });

      // The collision is skipped in .claude but materialized in .agents.
      assert.isFalse(result.written.includes(userSkillDir));
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(userSkillDir, "SKILL.md")),
        "user owned",
      );
      assert.isFalse(
        yield* fileSystem.exists(
          path.join(userSkillDir, SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
        ),
      );
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(otherUserDir, "SKILL.md")),
        "also user owned",
      );
      assert.include(result.written, path.join(cwd, ".agents", "skills", "tdd"));
      assert.deepStrictEqual(result.loaded, [{ id: skillId, name: "tdd" }]);
    }),
  );

  it.effect("creates no roots when nothing is desired and nothing is managed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });

      const result = yield* materializer.materialize({ cwd, skillIds: [] });

      assert.deepStrictEqual(result, { written: [], removed: [], loaded: [] });
      assert.isFalse(yield* fileSystem.exists(path.join(cwd, ".claude")));
      assert.isFalse(yield* fileSystem.exists(path.join(cwd, ".agents")));
    }),
  );

  it.effect("skips skill ids that are not installed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });

      const result = yield* materializer.materialize({
        cwd,
        skillIds: ["octocat/materialize-missing:skills/nope"],
      });

      assert.deepStrictEqual(result, { written: [], removed: [], loaded: [] });
      assert.isFalse(yield* fileSystem.exists(path.join(cwd, ".claude")));
    }),
  );

  it.effect("materializes host-folder skills, reviving a disabled SKILL.md in the copy", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-host-" });
      const hostDir = path.join(home, "skills", "grill-me");
      yield* fileSystem.makeDirectory(hostDir, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(hostDir, HostSkills.HOST_SKILL_DISABLED_FILE),
        "---\nname: grill-me\n---\n",
      );
      const hostSkillId = "host:codex:grill-me";
      hostSkillsFixture.push({
        id: hostSkillId,
        name: "grill-me",
        path: path.join(hostDir, HostSkills.HOST_SKILL_DISABLED_FILE),
        displayPath: "~/.codex/skills/grill-me",
        origin: "Codex",
        enabled: false,
      });

      const result = yield* materializer
        .materialize({ cwd, skillIds: [hostSkillId] })
        .pipe(Effect.ensuring(Effect.sync(() => hostSkillsFixture.splice(0))));

      for (const root of [".claude/skills", ".agents/skills"]) {
        const skillDir = path.join(cwd, root, "grill-me");
        assert.include(result.written, skillDir);
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(skillDir, "SKILL.md")),
          "---\nname: grill-me\n---\n",
        );
        assert.isFalse(
          yield* fileSystem.exists(path.join(skillDir, HostSkills.HOST_SKILL_DISABLED_FILE)),
        );
        assert.strictEqual(
          yield* fileSystem.readFileString(
            path.join(skillDir, SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
          ),
          hostSkillId,
        );
      }
      // The host folder itself is untouched: still disabled where it lives.
      assert.isTrue(
        yield* fileSystem.exists(path.join(hostDir, HostSkills.HOST_SKILL_DISABLED_FILE)),
      );
      assert.deepStrictEqual(result.loaded, [{ id: hostSkillId, name: "grill-me" }]);
    }),
  );
});
