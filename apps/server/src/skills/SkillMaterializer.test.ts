import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SkillsError, type HostSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as HostSkills from "./HostSkills.ts";
import * as SkillMaterializer from "./SkillMaterializer.ts";
import * as SkillStore from "./SkillStore.ts";

/** Host-folder skills the mocked `HostSkills.resolve` reports; tests push into it. */
const hostSkillsFixture: Array<HostSkill> = [];
/** When set, the mock resolve fails so materialization must preserve managed host copies. */
let hostResolveShouldFail = false;

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SkillStore.layer),
  Layer.provideMerge(
    SkillMaterializer.layer.pipe(
      Layer.provide(SkillStore.layer),
      Layer.provide(
        Layer.mock(HostSkills.HostSkills)({
          resolve: (skillIds) =>
            hostResolveShouldFail
              ? Effect.fail(
                  new SkillsError({
                    operation: "materialize",
                    message: "settings unavailable",
                  }),
                )
              : Effect.sync(() =>
                  hostSkillsFixture
                    .filter((skill) => skillIds.includes(skill.id))
                    .map((skill) => ({
                      id: skill.id,
                      name: skill.name,
                      dir: skill.path.replace(/[/\\][^/\\]+$/, ""),
                    })),
                ),
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

describe("assignSkillDirectoryNames", () => {
  it("keeps a unique skill name as the directory", () => {
    const names = SkillMaterializer.assignSkillDirectoryNames([
      {
        id: "acme/skills:skills/tdd",
        name: "tdd",
        sourceRepo: "acme/skills",
        sourcePath: "skills/tdd",
      },
    ]);
    assert.strictEqual(names.get("acme/skills:skills/tdd"), "tdd");
  });

  it("suffixes every colliding name from identity, not input order", () => {
    const first = {
      id: "octocat/skills-a:skills/tdd",
      name: "tdd",
      sourceRepo: "octocat/skills-a",
      sourcePath: "skills/tdd",
    };
    const second = {
      id: "octocat/skills-b:skills/tdd",
      name: "tdd",
      sourceRepo: "octocat/skills-b",
      sourcePath: "skills/tdd",
    };
    const forward = SkillMaterializer.assignSkillDirectoryNames([first, second]);
    const reverse = SkillMaterializer.assignSkillDirectoryNames([second, first]);
    assert.strictEqual(forward.get(first.id), "tdd--octocat-skills-a");
    assert.strictEqual(forward.get(second.id), "tdd--octocat-skills-b");
    assert.strictEqual(reverse.get(first.id), "tdd--octocat-skills-a");
    assert.strictEqual(reverse.get(second.id), "tdd--octocat-skills-b");
  });

  it("folds source path in when two same-name skills share a repo", () => {
    const names = SkillMaterializer.assignSkillDirectoryNames([
      {
        id: "octocat/skills:skills/tdd",
        name: "tdd",
        sourceRepo: "octocat/skills",
        sourcePath: "skills/tdd",
      },
      {
        id: "octocat/skills:examples/tdd",
        name: "tdd",
        sourceRepo: "octocat/skills",
        sourcePath: "examples/tdd",
      },
    ]);
    assert.strictEqual(names.get("octocat/skills:skills/tdd"), "tdd--octocat-skills--skills-tdd");
    assert.strictEqual(
      names.get("octocat/skills:examples/tdd"),
      "tdd--octocat-skills--examples-tdd",
    );
  });
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
        // The copy hides itself from git so agent commits never sweep it up.
        assert.strictEqual(
          yield* fileSystem.readFileString(path.join(skillDir, ".gitignore")),
          "*\n",
        );
      }
      assert.deepStrictEqual(result.removed, []);
      // The loaded document points at the first workspace copy and carries
      // the SKILL.md body without its frontmatter.
      assert.deepStrictEqual(result.loaded, [
        {
          id: skillId,
          name: "TDD Skill",
          directory: path.join(cwd, ".claude", "skills", "tdd-skill"),
          body: "",
        },
      ]);
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
      // The user's colliding copy is what loads: their folder wins the name,
      // and enabling the skill still takes effect.
      assert.deepStrictEqual(result.loaded, [
        { id: skillId, name: "tdd", directory: userSkillDir, body: "user owned" },
      ]);
    }),
  );

  it.effect("returns the SKILL.md body without frontmatter for loaded skills", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const skillId = yield* installSkill({
        sourceRepo: "octocat/materialize-body",
        sourcePath: "skills/grill",
        skillMd: [
          "---",
          "name: grill-me",
          "description: Interview relentlessly.",
          "---",
          "",
          "Ask one question at a time.",
          "See references/questions.md.",
          "",
        ].join("\n"),
      });

      const result = yield* materializer.materialize({ cwd, skillIds: [skillId] });

      assert.strictEqual(result.loaded.length, 1);
      assert.strictEqual(
        result.loaded[0]?.body,
        "Ask one question at a time.\nSee references/questions.md.",
      );
    }),
  );

  it.effect("resolves $mentions from workspace roots, then provider candidates", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-home-" });

      // A provider CLI skill (user scope) addressed by SKILL.md path.
      const hostSkillDir = path.join(home, ".claude", "skills", "Host Skill");
      yield* fileSystem.makeDirectory(hostSkillDir, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(hostSkillDir, "SKILL.md"),
        "---\nname: Host Skill\n---\nhost body\n",
      );
      // A project skill only present in the workspace, addressed by dir name.
      const projectSkillDir = path.join(cwd, ".agents", "skills", "project-skill");
      yield* fileSystem.makeDirectory(projectSkillDir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(projectSkillDir, "SKILL.md"), "project body");

      // A same-named skill in another project's roots, as the provider
      // snapshot (discovered from the server cwd) may list it.
      const otherProjectSkillDir = path.join(home, "other", ".claude", "skills", "project-skill");
      yield* fileSystem.makeDirectory(otherProjectSkillDir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(otherProjectSkillDir, "SKILL.md"), "other body");

      const resolved = yield* materializer.resolveMentions({
        cwd,
        names: ["host-skill", "project-skill", "Project_Skill", "missing-skill"],
        candidates: [
          { name: "Host Skill", path: path.join(hostSkillDir, "SKILL.md") },
          { name: "project-skill", path: path.join(otherProjectSkillDir, "SKILL.md") },
        ],
      });

      // The thread's own workspace copy wins over the snapshot path, and two
      // spellings of one name resolve once.
      assert.deepStrictEqual(resolved, [
        { name: "Host Skill", directory: hostSkillDir, body: "host body" },
        { name: "project-skill", directory: projectSkillDir, body: "project body" },
      ]);
    }),
  );

  it.effect("materializes two enabled skills that share a name under distinct folders", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const firstId = yield* installSkill({
        sourceRepo: "octocat/skills-a",
        sourcePath: "skills/tdd",
        skillMd: "---\nname: tdd\n---\nfirst body\n",
      });
      const secondId = yield* installSkill({
        sourceRepo: "octocat/skills-b",
        sourcePath: "skills/tdd",
        skillMd: "---\nname: tdd\n---\nsecond body\n",
      });

      const result = yield* materializer.materialize({ cwd, skillIds: [firstId, secondId] });

      assert.deepStrictEqual(
        result.loaded.map((skill) => [skill.id, path.basename(skill.directory), skill.body]),
        [
          [firstId, "tdd--octocat-skills-a", "first body"],
          [secondId, "tdd--octocat-skills-b", "second body"],
        ],
      );

      const reversed = yield* materializer.materialize({ cwd, skillIds: [secondId, firstId] });
      assert.deepStrictEqual(
        reversed.loaded.map((skill) => [skill.id, path.basename(skill.directory), skill.body]),
        [
          [secondId, "tdd--octocat-skills-b", "second body"],
          [firstId, "tdd--octocat-skills-a", "first body"],
        ],
      );
    }),
  );

  it.effect("does not claim a user-owned collision that is not a skill document", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const skillId = yield* installSkill({
        sourceRepo: "octocat/materialize-invalid-collision",
        sourcePath: "skills/tdd",
        skillMd: "---\nname: tdd\n---\nstore body\n",
      });

      yield* fileSystem.makeDirectory(path.join(cwd, ".claude", "skills"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(cwd, ".claude", "skills", "tdd"), "not a skill");
      const emptyUserDir = path.join(cwd, ".claude", "skills", "also-empty");
      yield* fileSystem.makeDirectory(emptyUserDir, { recursive: true });

      const fileCollisionId = skillId;
      const emptyDirId = yield* installSkill({
        sourceRepo: "octocat/materialize-empty-collision",
        sourcePath: "skills/also-empty",
        skillMd: "---\nname: also-empty\n---\nempty-dir fallback\n",
      });

      const result = yield* materializer.materialize({
        cwd,
        skillIds: [fileCollisionId, emptyDirId],
      });

      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(cwd, ".claude", "skills", "tdd")),
        "not a skill",
      );
      assert.isFalse(
        yield* fileSystem.exists(
          path.join(emptyUserDir, SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
        ),
      );
      assert.deepStrictEqual(
        result.loaded.map((skill) => [skill.id, skill.directory, skill.body]),
        [
          [fileCollisionId, path.join(cwd, ".agents", "skills", "tdd"), "store body"],
          [emptyDirId, path.join(cwd, ".agents", "skills", "also-empty"), "empty-dir fallback"],
        ],
      );
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
      assert.deepStrictEqual(result.loaded, [
        {
          id: hostSkillId,
          name: "grill-me",
          directory: path.join(cwd, ".claude", "skills", "grill-me"),
          body: "",
        },
      ]);
    }),
  );

  it.effect("keeps managed host skills when host discovery fails", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const materializer = yield* SkillMaterializer.SkillMaterializer;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-cwd-" });
      const hostSkillId = "host:codex:grill-me";
      const keepId = yield* installSkill({
        sourceRepo: "octocat/materialize-preserve",
        sourcePath: "skills/keep",
        skillMd: "---\nname: keep\n---\n",
      });

      // Seed managed dirs as if a prior turn materialized both skills.
      for (const root of [".claude/skills", ".agents/skills"]) {
        for (const [dirName, marker] of [
          ["grill-me", hostSkillId],
          ["keep", keepId],
        ] as const) {
          const skillDir = path.join(cwd, root, dirName);
          yield* fileSystem.makeDirectory(skillDir, { recursive: true });
          yield* fileSystem.writeFileString(path.join(skillDir, "SKILL.md"), "prior copy");
          yield* fileSystem.writeFileString(
            path.join(skillDir, SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
            marker,
          );
        }
      }

      hostResolveShouldFail = true;
      const result = yield* materializer
        .materialize({
          cwd,
          skillIds: [hostSkillId, keepId],
        })
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              hostResolveShouldFail = false;
            }),
          ),
        );

      for (const root of [".claude/skills", ".agents/skills"]) {
        assert.isTrue(yield* fileSystem.exists(path.join(cwd, root, "grill-me", "SKILL.md")));
        assert.strictEqual(
          yield* fileSystem.readFileString(
            path.join(cwd, root, "grill-me", SkillMaterializer.SKILL_MANAGED_MARKER_FILE),
          ),
          hostSkillId,
        );
        assert.isTrue(yield* fileSystem.exists(path.join(cwd, root, "keep", "SKILL.md")));
      }
      assert.deepStrictEqual(result.removed, []);
      assert.deepStrictEqual(result.loaded, [
        {
          id: keepId,
          name: "keep",
          directory: path.join(cwd, ".claude", "skills", "keep"),
          body: "",
        },
      ]);
    }),
  );
});
