import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import {
  formatSkillId,
  LEGACY_MANAGED_MARKER_FILE,
  make,
  parseSkillId,
  SKILL_METADATA_FILE,
  SkillLibraryHomeDirectory,
} from "./SkillLibrary.ts";

type TestProviderInstances = Record<
  string,
  { driver: string; displayName?: string; config?: unknown }
>;

const PONYTAIL_SKILL_MD = [
  "---",
  "name: ponytail",
  "description: Lazy senior developer.",
  "---",
  "",
  "# Ponytail",
  "",
  "Be lazy.",
].join("\n");

/** A library over a throwaway home directory; nothing here touches ~/.agents. */
const makeLibrary = (home: string, overrides: { providerInstances?: TestProviderInstances } = {}) =>
  make.pipe(
    Effect.provideService(SkillLibraryHomeDirectory, home),
    Effect.provideService(HostProcessEnvironment, {}),
    Effect.provide(
      serverSettingsLayerTest(
        overrides as unknown as Parameters<typeof serverSettingsLayerTest>[0],
      ),
    ),
  );

const writeSkill = Effect.fn(function* (skillDir: string, contents: string = PONYTAIL_SKILL_MD) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
  return skillDir;
});

const isSymlink = (target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  });

const tempHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "t3-skill-library-home-" });
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-library-test-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("SkillLibrary", (it) => {
  it.effect("parses library skill ids", () =>
    Effect.sync(() => {
      assert.deepEqual(parseSkillId("host:agents:ponytail"), {
        locationKey: "agents",
        dirName: "ponytail",
      });
      assert.deepEqual(parseSkillId("host:codex:codex_work:tdd"), {
        locationKey: "codex:codex_work",
        dirName: "tdd",
      });
      assert.equal(parseSkillId("host:codex::tdd"), null);
      assert.equal(parseSkillId("host:codex:../tdd"), null);
      assert.equal(parseSkillId("host:unknown:tdd"), null);
      assert.equal(parseSkillId("mattpocock/skills:skills/tdd"), null);
      assert.equal(formatSkillId("codex:codex_work", "tdd"), "host:codex:codex_work:tdd");
    }),
  );

  it.effect("lists one skill per real folder and folds links onto it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      yield* writeSkill(path.join(home, ".agents", "skills", "ponytail"));
      yield* fs.makeDirectory(path.join(home, ".claude", "skills"), { recursive: true });
      yield* fs.symlink(
        "../../.agents/skills/ponytail",
        path.join(home, ".claude", "skills", "ponytail"),
      );
      yield* writeSkill(path.join(home, ".codex", "skills", "computer-use"), "# no frontmatter\n");
      const library = yield* makeLibrary(home);

      const state = yield* library.getState;

      assert.deepEqual(
        state.locations.map((location) => location.key),
        ["agents", "claudeAgent", "codex", "cursor", "grok"],
      );
      assert.include(state.locations.find((location) => location.key === "codex")!.reads, "agents");
      assert.deepEqual(state.locations.find((location) => location.key === "claudeAgent")!.reads, [
        "claudeAgent",
      ]);
      assert.deepEqual(
        state.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          home: skill.home,
          presentIn: skill.presentIn,
          description: skill.description,
        })),
        [
          {
            id: "host:codex:computer-use",
            name: "computer-use",
            home: "codex",
            presentIn: ["codex"],
            description: undefined,
          },
          {
            id: "host:agents:ponytail",
            name: "ponytail",
            home: "agents",
            presentIn: ["agents", "claudeAgent"],
            description: "Lazy senior developer.",
          },
        ],
      );
      assert.equal(state.skills[1]!.displayPath, "~/.agents/skills/ponytail");
    }),
  );

  it.effect("lists a configured provider instance home under its own key", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const workHome = path.join(home, "codex-work");
      yield* writeSkill(path.join(workHome, "skills", "tdd"), "---\nname: tdd\n---\n");
      const library = yield* makeLibrary(home, {
        providerInstances: {
          codex_work: { driver: "codex", displayName: "Work", config: { homePath: workHome } },
        },
      });

      const state = yield* library.getState;

      const location = state.locations.find((entry) => entry.key === "codex:codex_work");
      assert.equal(location?.title, "Codex · Work");
      assert.equal(location?.instanceId, "codex_work");
      assert.deepEqual(
        state.skills.map((skill) => skill.id),
        ["host:codex:codex_work:tdd"],
      );
    }),
  );

  it.effect("links a skill into a provider folder and removes the link again", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const realDir = yield* writeSkill(path.join(home, ".agents", "skills", "ponytail"));
      const library = yield* makeLibrary(home);
      const linkPath = path.join(home, ".claude", "skills", "ponytail");

      const linked = yield* library.setLocationEnabled({
        skillId: "host:agents:ponytail",
        locationKey: "claudeAgent",
        enabled: true,
      });
      assert.deepEqual(linked.skills[0]!.presentIn, ["agents", "claudeAgent"]);
      assert.isTrue(yield* isSymlink(linkPath));
      // Relative, like `npx skills`, so a moved home keeps working.
      assert.equal(yield* fs.readLink(linkPath), "../../.agents/skills/ponytail");
      assert.equal(yield* fs.readFileString(path.join(linkPath, "SKILL.md")), PONYTAIL_SKILL_MD);

      const unlinked = yield* library.setLocationEnabled({
        skillId: "host:agents:ponytail",
        locationKey: "claudeAgent",
        enabled: false,
      });
      assert.deepEqual(unlinked.skills[0]!.presentIn, ["agents"]);
      assert.isFalse(yield* fs.exists(linkPath));
      assert.isTrue(yield* fs.exists(path.join(realDir, "SKILL.md")));

      // Turning a skill off where it lives is a removal, not a toggle.
      const error = yield* Effect.flip(
        library.setLocationEnabled({
          skillId: "host:agents:ponytail",
          locationKey: "agents",
          enabled: false,
        }),
      );
      assert.equal(error.operation, "set-location");
      assert.match(error.message, /where this skill lives/);
    }),
  );

  it.effect("refuses to link over a provider's own copy of the same name", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* tempHome;
      yield* writeSkill(path.join(home, ".agents", "skills", "ponytail"));
      yield* writeSkill(path.join(home, ".grok", "skills", "ponytail"), "# grok copy\n");
      const library = yield* makeLibrary(home);

      const error = yield* Effect.flip(
        library.setLocationEnabled({
          skillId: "host:agents:ponytail",
          locationKey: "grok",
          enabled: true,
        }),
      );

      assert.match(error.message, /already has its own/);
      const state = yield* library.getState;
      assert.deepEqual(
        state.skills.map((skill) => skill.id),
        ["host:agents:ponytail", "host:grok:ponytail"],
      );
    }),
  );

  it.effect("uninstalls the real folder together with every link to it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const realDir = yield* writeSkill(path.join(home, ".agents", "skills", "ponytail"));
      const library = yield* makeLibrary(home);
      for (const key of ["claudeAgent", "cursor"]) {
        yield* library.setLocationEnabled({
          skillId: "host:agents:ponytail",
          locationKey: key,
          enabled: true,
        });
      }

      const state = yield* library.uninstall("host:agents:ponytail");

      assert.deepEqual(state.skills, []);
      assert.isFalse(yield* fs.exists(realDir));
      assert.isFalse(yield* isSymlink(path.join(home, ".claude", "skills", "ponytail")));
      assert.isFalse(yield* isSymlink(path.join(home, ".cursor", "skills", "ponytail")));
      const error = yield* Effect.flip(library.uninstall("host:agents:ponytail"));
      assert.equal(error.operation, "uninstall");
    }),
  );

  it.effect("uninstalling a linked-only entry drops the link and keeps the folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const outside = yield* writeSkill(path.join(home, "dev", "my-skill"));
      yield* fs.makeDirectory(path.join(home, ".claude", "skills"), { recursive: true });
      yield* fs.symlink(outside, path.join(home, ".claude", "skills", "my-skill"));
      const library = yield* makeLibrary(home);

      const before = yield* library.getState;
      assert.deepEqual(
        before.skills.map((skill) => skill.id),
        ["host:claudeAgent:my-skill"],
      );
      yield* library.uninstall("host:claudeAgent:my-skill");

      assert.isFalse(yield* fs.exists(path.join(home, ".claude", "skills", "my-skill")));
      assert.isTrue(yield* fs.exists(path.join(outside, "SKILL.md")));
    }),
  );

  it.effect("installs into the shared library and links the providers that need a link", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const source = yield* writeSkill(path.join(home, "download", "tdd"), "---\nname: tdd\n---\n");
      yield* fs.writeFileString(path.join(source, "cheatsheet.md"), "red green refactor\n");
      const library = yield* makeLibrary(home);

      const state = yield* library.installFromDirectory({
        dirName: "tdd",
        directory: source,
        source: { repo: "octocat/skills", path: "skills/engineering/tdd" },
      });

      const skill = state.skills[0]!;
      assert.equal(skill.id, "host:agents:tdd");
      assert.deepEqual(skill.source, { repo: "octocat/skills", path: "skills/engineering/tdd" });
      assert.isString(skill.installedAt);
      // Codex and Cursor read ~/.agents/skills themselves; Claude and Grok need the link.
      assert.deepEqual(skill.presentIn, ["agents", "claudeAgent", "grok"]);
      const libraryDir = path.join(home, ".agents", "skills", "tdd");
      assert.equal(
        yield* fs.readFileString(path.join(libraryDir, "cheatsheet.md")),
        "red green refactor\n",
      );
      assert.isTrue(yield* fs.exists(path.join(libraryDir, SKILL_METADATA_FILE)));
      assert.isTrue(yield* isSymlink(path.join(home, ".claude", "skills", "tdd")));
      assert.isFalse(yield* fs.exists(path.join(home, ".codex", "skills", "tdd")));

      // The same source installs again in place; a different one must not take the name.
      yield* fs.writeFileString(path.join(source, "cheatsheet.md"), "updated\n");
      yield* library.installFromDirectory({
        dirName: "tdd",
        directory: source,
        source: { repo: "octocat/skills", path: "skills/engineering/tdd" },
      });
      assert.equal(yield* fs.readFileString(path.join(libraryDir, "cheatsheet.md")), "updated\n");
      const error = yield* Effect.flip(
        library.installFromDirectory({
          dirName: "tdd",
          directory: source,
          source: { repo: "someone/else", path: "tdd" },
        }),
      );
      assert.match(error.message, /already in ~\/.agents\/skills/);
    }),
  );

  it.effect("moves a pre-library store into the shared library on startup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const home = yield* tempHome;
      const storeRoot = path.join(config.skillsDir);
      yield* writeSkill(
        path.join(storeRoot, "mattpocock--skills", "skills", "productivity", "grill-me"),
        "---\nname: grill-me\n---\n# Grill\n",
      );
      yield* writeSkill(
        path.join(storeRoot, "emilkowalski--skills", "skills", "animate"),
        "# store copy\n",
      );
      yield* writeSkill(path.join(home, ".agents", "skills", "animate"), "# npx copy\n");

      const library = yield* makeLibrary(home);

      const state = yield* library.getState;
      const grillMe = state.skills.find((skill) => skill.id === "host:agents:grill-me");
      assert.deepEqual(grillMe?.source, {
        repo: "mattpocock/skills",
        path: "skills/productivity/grill-me",
      });
      assert.isTrue(grillMe?.presentIn.includes("claudeAgent"));
      // The copy already in the library wins; the store duplicate is dropped.
      assert.equal(
        yield* fs.readFileString(path.join(home, ".agents", "skills", "animate", "SKILL.md")),
        "# npx copy\n",
      );
      assert.isFalse(yield* fs.exists(storeRoot));
    }),
  );

  it.effect("resolves thread picks to documents, folding pre-library ids", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const realDir = yield* writeSkill(path.join(home, ".agents", "skills", "ponytail"));
      const library = yield* makeLibrary(home);

      const documents = yield* library.resolveDocuments([
        "mattpocock/skills:skills/productivity/ponytail",
        "host:agents:ponytail",
        "host:agents:missing",
      ]);

      assert.deepEqual(documents, [
        {
          id: "host:agents:ponytail",
          name: "ponytail",
          directory: yield* fs.realPath(realDir),
          body: "# Ponytail\n\nBe lazy.",
        },
      ]);
    }),
  );

  it.effect("resolves $mentions from the workspace first, then provider candidates", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const cwd = path.join(home, "project");
      yield* writeSkill(
        path.join(cwd, ".claude", "skills", "tdd"),
        "---\nname: tdd\n---\nproject tdd",
      );
      const userTdd = yield* writeSkill(path.join(home, ".claude", "skills", "tdd"), "user tdd");
      const userPrd = yield* writeSkill(path.join(home, ".claude", "skills", "prd"), "user prd");
      const library = yield* makeLibrary(home);

      const documents = yield* library.resolveMentions({
        cwd,
        names: ["tdd", "prd", "nope"],
        candidates: [
          { name: "tdd", path: path.join(userTdd, "SKILL.md") },
          { name: "prd", path: path.join(userPrd, "SKILL.md") },
        ],
      });

      assert.deepEqual(
        documents.map((document) => [document.name, document.body]),
        [
          ["tdd", "project tdd"],
          ["prd", "user prd"],
        ],
      );
    }),
  );

  it.effect("revives a skill an older server hid by renaming its document", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const skillDir = path.join(home, ".grok", "skills", "asd");
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(path.join(skillDir, "SKILL.md.t3-disabled"), "# hidden\n");
      const library = yield* makeLibrary(home);

      const state = yield* library.getState;

      assert.deepEqual(
        state.skills.map((skill) => skill.id),
        ["host:grok:asd"],
      );
      assert.isTrue(yield* fs.exists(path.join(skillDir, "SKILL.md")));
    }),
  );

  it.effect("removes only the workspace copies an older server marked", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const cwd = path.join(home, "project");
      const managed = yield* writeSkill(path.join(cwd, ".claude", "skills", "grill-me"));
      yield* fs.writeFileString(path.join(managed, LEGACY_MANAGED_MARKER_FILE), "x");
      const owned = yield* writeSkill(path.join(cwd, ".agents", "skills", "test-app"));
      const library = yield* makeLibrary(home);

      yield* library.removeManagedWorkspaceCopies(cwd);

      assert.isFalse(yield* fs.exists(managed));
      assert.isTrue(yield* fs.exists(path.join(owned, "SKILL.md")));
    }),
  );
});
