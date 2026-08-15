import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import {
  formatHostSkillId,
  HOST_SKILL_DISABLED_FILE,
  make,
  parseHostSkillId,
} from "./HostSkills.ts";
import { SKILL_MANAGED_MARKER_FILE } from "./SkillMaterializer.ts";

type TestProviderInstances = Record<
  string,
  { driver: string; displayName?: string; config?: unknown }
>;

const makeService = (overrides: { providerInstances?: TestProviderInstances } = {}) =>
  make.pipe(
    Effect.provide(
      serverSettingsLayerTest(
        overrides as unknown as Parameters<typeof serverSettingsLayerTest>[0],
      ),
    ),
  );

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
  return skillDir;
});

it.layer(NodeServices.layer)("HostSkills", (it) => {
  it.effect("parses default and instance host skill ids", () =>
    Effect.sync(() => {
      assert.deepEqual(parseHostSkillId("host:claudeAgent:grill-me"), {
        originKey: "claudeAgent",
        instanceKey: "default",
        dirName: "grill-me",
      });
      assert.deepEqual(parseHostSkillId("host:codex:codex_work:tdd"), {
        originKey: "codex",
        instanceKey: "codex_work",
        dirName: "tdd",
      });
      assert.equal(parseHostSkillId("host:codex:default:tdd"), null);
      assert.equal(parseHostSkillId("host:codex:../tdd"), null);
      assert.equal(parseHostSkillId("mattpocock/skills:skills/tdd"), null);
    }),
  );

  it.effect("lists and uninstalls a skill from a custom provider home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const claudeHome = path.join(tempDir, "claude-work");
      yield* writeSkill(
        path.join(claudeHome, "skills"),
        "grill-me",
        [
          "---",
          "name: grill-me",
          "description: Interview the implementer.",
          "---",
          "",
          "# Grill",
        ].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(claudeHome, "skills", "grill-me", "notes.md"),
        "keep this until uninstall",
      );

      const service = yield* makeService({
        providerInstances: {
          claude_work: {
            driver: "claudeAgent",
            displayName: "Work",
            config: { homePath: claudeHome },
          },
        },
      });

      const listed = yield* service.list;
      const expectedId = formatHostSkillId({
        originKey: "claudeAgent",
        instanceKey: "claude_work",
        dirName: "grill-me",
      });
      const skill = listed.skills.find((entry) => entry.id === expectedId);
      assert.isDefined(skill);
      assert.strictEqual(skill.origin, "Claude Code · Work");
      assert.strictEqual(skill.description, "Interview the implementer.");
      assert.strictEqual(skill.enabled, true);
      assert.strictEqual(skill.displayPath, path.join(claudeHome, "skills", "grill-me"));
      assert.strictEqual(skill.path, path.join(claudeHome, "skills", "grill-me", "SKILL.md"));

      const after = yield* service.uninstall(expectedId);
      assert.equal(
        after.skills.some((entry) => entry.id === skill.id),
        false,
      );
      assert.equal(yield* fs.exists(path.join(claudeHome, "skills", "grill-me")), false);
    }),
  );

  it.effect("skips T3-managed copies and still lists malformed frontmatter", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const cursorHome = path.join(tempDir, "cursor-home");
      yield* writeSkill(path.join(cursorHome, "skills"), "broken", "---\nname: [unclosed\n---\n");
      const managedDir = yield* writeSkill(
        path.join(cursorHome, "skills"),
        "t3-copy",
        ["---", "name: t3-copy", "---"].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(managedDir, SKILL_MANAGED_MARKER_FILE),
        "owner/repo:t3-copy",
      );

      const service = yield* makeService({
        providerInstances: {
          cursor_work: { driver: "cursor", config: { homePath: cursorHome } },
        },
      });

      const listed = yield* service.list;
      const names = listed.skills
        .filter((skill) => skill.path.startsWith(cursorHome))
        .map((skill) => skill.name);
      assert.deepEqual(names, ["broken"]);
    }),
  );

  it.effect("refuses unknown, traversal, and non-skill uninstall ids", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const grokHome = path.join(tempDir, "grok-home");
      const skillsDir = path.join(grokHome, "skills");
      yield* fs.makeDirectory(path.join(skillsDir, "empty"), { recursive: true });
      yield* writeSkill(skillsDir, "keep-me", ["---", "name: keep-me", "---"].join("\n"));

      const service = yield* makeService({
        providerInstances: {
          grok_work: { driver: "grok", config: { homePath: grokHome } },
        },
      });

      const unknown = yield* service.uninstall("host:grok:grok_work:missing").pipe(Effect.result);
      assert.equal(unknown._tag, "Failure");

      const traversal = yield* service.uninstall("host:grok:../secrets").pipe(Effect.result);
      assert.equal(traversal._tag, "Failure");

      const emptyDir = yield* service.uninstall("host:grok:grok_work:empty").pipe(Effect.result);
      assert.equal(emptyDir._tag, "Failure");
      assert.equal(yield* fs.exists(path.join(skillsDir, "keep-me", "SKILL.md")), true);
    }),
  );

  it.effect("disables and re-enables a host skill without deleting the folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const cursorHome = path.join(tempDir, "cursor-home");
      const skillDir = yield* writeSkill(
        path.join(cursorHome, "skills"),
        "grill-me",
        ["---", "name: grill-me", "description: Interview the implementer.", "---"].join("\n"),
      );
      yield* fs.writeFileString(path.join(skillDir, "notes.md"), "keep this while disabled");

      const service = yield* makeService({
        providerInstances: {
          cursor_work: { driver: "cursor", config: { homePath: cursorHome } },
        },
      });
      const skillId = formatHostSkillId({
        originKey: "cursor",
        instanceKey: "cursor_work",
        dirName: "grill-me",
      });

      const disabled = yield* service.setEnabled({ skillId, enabled: false });
      const disabledSkill = disabled.skills.find((entry) => entry.id === skillId);
      assert.isDefined(disabledSkill);
      assert.strictEqual(disabledSkill.enabled, false);
      assert.strictEqual(disabledSkill.path, path.join(skillDir, HOST_SKILL_DISABLED_FILE));
      assert.equal(yield* fs.exists(path.join(skillDir, "SKILL.md")), false);
      assert.equal(yield* fs.exists(path.join(skillDir, HOST_SKILL_DISABLED_FILE)), true);
      assert.equal(yield* fs.exists(path.join(skillDir, "notes.md")), true);

      const stillDisabled = yield* service.setEnabled({ skillId, enabled: false });
      assert.strictEqual(
        stillDisabled.skills.find((entry) => entry.id === skillId)?.enabled,
        false,
      );

      const enabled = yield* service.setEnabled({ skillId, enabled: true });
      const enabledSkill = enabled.skills.find((entry) => entry.id === skillId);
      assert.isDefined(enabledSkill);
      assert.strictEqual(enabledSkill.enabled, true);
      assert.strictEqual(enabledSkill.path, path.join(skillDir, "SKILL.md"));
      assert.equal(yield* fs.exists(path.join(skillDir, "SKILL.md")), true);
      assert.equal(yield* fs.exists(path.join(skillDir, HOST_SKILL_DISABLED_FILE)), false);
    }),
  );

  it.effect("uninstalls a disabled host skill", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const grokHome = path.join(tempDir, "grok-home");
      const skillDir = yield* writeSkill(
        path.join(grokHome, "skills"),
        "keep-me",
        ["---", "name: keep-me", "---"].join("\n"),
      );

      const service = yield* makeService({
        providerInstances: {
          grok_work: { driver: "grok", config: { homePath: grokHome } },
        },
      });
      const skillId = formatHostSkillId({
        originKey: "grok",
        instanceKey: "grok_work",
        dirName: "keep-me",
      });

      yield* service.setEnabled({ skillId, enabled: false });
      const after = yield* service.uninstall(skillId);
      assert.equal(
        after.skills.some((entry) => entry.id === skillId),
        false,
      );
      assert.equal(yield* fs.exists(skillDir), false);
    }),
  );

  it.effect("refuses to disable a T3-managed copy", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const cursorHome = path.join(tempDir, "cursor-home");
      const managedDir = yield* writeSkill(
        path.join(cursorHome, "skills"),
        "t3-copy",
        ["---", "name: t3-copy", "---"].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(managedDir, SKILL_MANAGED_MARKER_FILE),
        "owner/repo:t3-copy",
      );

      const service = yield* makeService({
        providerInstances: {
          cursor_work: { driver: "cursor", config: { homePath: cursorHome } },
        },
      });
      const result = yield* service
        .setEnabled({
          skillId: formatHostSkillId({
            originKey: "cursor",
            instanceKey: "cursor_work",
            dirName: "t3-copy",
          }),
          enabled: false,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.equal(yield* fs.exists(path.join(managedDir, "SKILL.md")), true);
    }),
  );

  it.effect("keeps one row when two instances share the same home", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-host-skills-" });
      const claudeHome = path.join(tempDir, "claude-home");
      yield* writeSkill(
        path.join(claudeHome, "skills"),
        "shared-skill",
        ["---", "name: shared-skill", "---"].join("\n"),
      );

      const service = yield* makeService({
        providerInstances: {
          claude_a: { driver: "claudeAgent", config: { homePath: claudeHome } },
          claude_b: { driver: "claudeAgent", config: { homePath: claudeHome } },
        },
      });

      const matches = (yield* service.list).skills.filter((skill) =>
        skill.path.startsWith(claudeHome),
      );
      assert.lengthOf(matches, 1);
      assert.strictEqual(
        matches[0]?.id,
        formatHostSkillId({
          originKey: "claudeAgent",
          instanceKey: "claude_a",
          dirName: "shared-skill",
        }),
      );
    }),
  );
});
