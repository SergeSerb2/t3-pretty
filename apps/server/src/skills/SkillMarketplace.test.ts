// @effect-diagnostics nodeBuiltinImport:off
import * as NodeBuffer from "node:buffer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkillMarketplace from "./SkillMarketplace.ts";
import * as SkillStore from "./SkillStore.ts";
import { tarFile, tarGzArchive } from "./testUtils/tarballFixture.ts";

const TDD_SKILL_MD = [
  "---",
  "name: tdd",
  "description: Test driven development.",
  "---",
  "",
  "# TDD",
].join("\n");

const MARKETPLACE_TARBALL = tarGzArchive(
  tarFile("skills-aaa111/README.md", "# Skills\n"),
  tarFile("skills-aaa111/skills/engineering/tdd/SKILL.md", TDD_SKILL_MD),
  tarFile("skills-aaa111/skills/engineering/tdd/cheatsheet.md", "red green refactor\n"),
  tarFile("skills-aaa111/skills/product/prd/SKILL.md", "# no frontmatter\n"),
  // Hidden directories never surface as marketplace skills.
  tarFile("skills-aaa111/.claude-plugin/skills/hidden/SKILL.md", "---\nname: hidden\n---\n"),
  // Deeper than the marketplace scan goes.
  tarFile("skills-aaa111/a/b/c/d/e/f/SKILL.md", "---\nname: too-deep\n---\n"),
  // Nested inside a skill: part of tdd, not a skill of its own.
  tarFile("skills-aaa111/skills/engineering/tdd/examples/SKILL.md", "---\nname: nested\n---\n"),
  // Entry names are attacker-controlled; this one must never land on disk.
  tarFile("skills-aaa111/skills/engineering/tdd/..\\..\\escaped.md", "escaped\n"),
);

// A repository that is itself one skill.
const SINGLE_SKILL_TARBALL = tarGzArchive(
  tarFile(
    "asd-ste100-skill-bbb222/SKILL.md",
    "---\nname: asd-ste100\ndescription: Simplified Technical English.\n---\n",
  ),
  tarFile("asd-ste100-skill-bbb222/references/rules.md", "rules\n"),
);

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly sources?: ReadonlyArray<string>;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const layer = Layer.empty.pipe(
    Layer.provideMerge(
      SkillMarketplace.layer.pipe(
        Layer.provide(SkillStore.layer),
        Layer.provide(
          ServerSettings.layerTest({
            skills: {
              marketplaceSources: (input.sources ?? ["octocat/skills"]).map((repo) => ({ repo })),
            },
          }),
        ),
      ),
    ),
    Layer.provideMerge(SkillStore.layer),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-marketplace-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  return { execute, layer };
}

const tarballResponse = () =>
  new Response(NodeBuffer.Buffer.from(MARKETPLACE_TARBALL), { status: 200 });

it.effect("lists marketplace skills parsed from the fetched tarball", () => {
  const { execute, layer } = makeLayer({ response: tarballResponse });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const listings = yield* marketplace.list({});

    assert.strictEqual(listings.length, 1);
    const listing = listings[0]!;
    assert.strictEqual(listing.repo, "octocat/skills");
    assert.match(listing.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepStrictEqual(listing.skills, [
      {
        id: "octocat/skills:skills/engineering/tdd",
        name: "tdd",
        description: "Test driven development.",
        sourcePath: "skills/engineering/tdd",
        installed: false,
      },
      {
        id: "octocat/skills:skills/product/prd",
        name: "prd",
        sourcePath: "skills/product/prd",
        installed: false,
      },
    ]);
    assert.strictEqual(execute.mock.calls.length, 1);
    assert.match(
      (execute.mock.calls[0] as [HttpClientRequest.HttpClientRequest])[0].url,
      /codeload\.github\.com\/octocat\/skills\/tar\.gz\/HEAD/,
    );
  }).pipe(Effect.provide(layer));
});

it.effect("serves a fresh cached listing without re-fetching", () => {
  const { execute, layer } = makeLayer({ response: tarballResponse });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const first = yield* marketplace.list({});
    const second = yield* marketplace.list({});

    assert.strictEqual(execute.mock.calls.length, 1);
    assert.deepStrictEqual(second, first);
  }).pipe(Effect.provide(layer));
});

it.effect("refresh always re-downloads and picks up new content", () => {
  let tarball = tarGzArchive(tarFile("skills-aaa111/skills/tdd/SKILL.md", "---\nname: tdd\n---\n"));
  const { execute, layer } = makeLayer({
    response: () => new Response(NodeBuffer.Buffer.from(tarball), { status: 200 }),
  });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const first = yield* marketplace.list({});
    assert.deepStrictEqual(
      first[0]?.skills.map((skill) => skill.id),
      ["octocat/skills:skills/tdd"],
    );

    tarball = tarGzArchive(
      tarFile("skills-bbb222/skills/tdd/SKILL.md", "---\nname: tdd\n---\n"),
      tarFile("skills-bbb222/skills/new-skill/SKILL.md", "---\nname: new-skill\n---\n"),
    );
    const refreshed = yield* marketplace.refresh({});

    assert.strictEqual(execute.mock.calls.length, 2);
    assert.deepStrictEqual(
      refreshed[0]?.skills.map((skill) => skill.id),
      ["octocat/skills:skills/new-skill", "octocat/skills:skills/tdd"],
    );
  }).pipe(Effect.provide(layer));
});

it.effect("computes the installed flag from the store", () => {
  const { layer } = makeLayer({ response: tarballResponse });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const store = yield* SkillStore.SkillStore;
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const source = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-source-" });
    yield* fileSystem.writeFileString(path.join(source, "SKILL.md"), TDD_SKILL_MD);
    yield* store.installFromDirectory({
      sourceRepo: "octocat/skills",
      sourcePath: "skills/engineering/tdd",
      directory: source,
    });

    const listings = yield* marketplace.list({});

    const byId = new Map(listings[0]!.skills.map((skill) => [skill.id, skill.installed]));
    assert.strictEqual(byId.get("octocat/skills:skills/engineering/tdd"), true);
    assert.strictEqual(byId.get("octocat/skills:skills/product/prd"), false);
  }).pipe(Effect.provide(layer));
});

it.effect("installs a marketplace skill into the store, then lists from cache", () => {
  const { execute, layer } = makeLayer({ response: tarballResponse });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const state = yield* marketplace.install("octocat/skills:skills/engineering/tdd");

    assert.strictEqual(state.installedSkills.length, 1);
    const skill = state.installedSkills[0]!;
    assert.strictEqual(skill.id, "octocat/skills:skills/engineering/tdd");
    assert.strictEqual(skill.name, "tdd");
    assert.strictEqual(skill.description, "Test driven development.");

    const storedDir = path.join(
      config.skillsDir,
      "octocat--skills",
      "skills",
      "engineering",
      "tdd",
    );
    assert.strictEqual(
      yield* fileSystem.readFileString(path.join(storedDir, "cheatsheet.md")),
      "red green refactor\n",
    );
    // The traversal entry was dropped, not written anywhere.
    assert.isFalse(yield* fileSystem.exists(path.join(storedDir, "..\\..\\escaped.md")));
    assert.isFalse(yield* fileSystem.exists(path.join(config.skillsDir, "escaped.md")));
    assert.strictEqual(execute.mock.calls.length, 1);

    // The install populated the cache, so listing adds no fetches and flags
    // the skill as installed.
    const listings = yield* marketplace.list({});
    assert.strictEqual(execute.mock.calls.length, 1);
    assert.strictEqual(listings[0]?.skills[0]?.installed, true);
  }).pipe(Effect.provide(layer));
});

it.effect("fails to install a skill the marketplace does not contain", () => {
  const { layer } = makeLayer({ response: tarballResponse });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const error = yield* Effect.flip(marketplace.install("octocat/skills:skills/nonexistent"));

    assert.strictEqual(error.operation, "install");
    assert.match(error.message, /not found/);
  }).pipe(Effect.provide(layer));
});

it.effect("omits a failed source when others succeed, and fails when all fail", () => {
  const { layer } = makeLayer({
    sources: ["octocat/skills", "octocat/broken"],
    response: (request) =>
      request.url.includes("octocat/broken")
        ? new Response("nope", { status: 404 })
        : tarballResponse(),
  });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const listings = yield* marketplace.list({});
    assert.deepStrictEqual(
      listings.map((listing) => listing.repo),
      ["octocat/skills"],
    );

    const error = yield* Effect.flip(marketplace.list({ repo: "octocat/broken" }));
    assert.strictEqual(error.operation, "list-marketplace");
    assert.match(error.message, /every requested marketplace source/);
  }).pipe(Effect.provide(layer));
});

it.effect("reports a failed explicit refresh while list keeps serving the stale cache", () => {
  let fail = false;
  const { layer } = makeLayer({
    response: () => (fail ? new Response("nope", { status: 500 }) : tarballResponse()),
  });
  return Effect.gen(function* () {
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const first = yield* marketplace.list({});
    fail = true;
    const error = yield* Effect.flip(marketplace.refresh({}));
    assert.strictEqual(error.operation, "refresh-marketplace");
    assert.match(error.message, /HTTP 500/);

    const listed = yield* marketplace.list({});
    assert.deepStrictEqual(listed, first);
  }).pipe(Effect.provide(layer));
});

it.effect("lists and installs a repository that is itself one skill", () => {
  const { layer } = makeLayer({
    sources: ["danyuchn/asd-ste100-skill"],
    response: () => new Response(NodeBuffer.Buffer.from(SINGLE_SKILL_TARBALL), { status: 200 }),
  });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const marketplace = yield* SkillMarketplace.SkillMarketplace;

    const listings = yield* marketplace.list({});
    assert.deepStrictEqual(listings[0]?.skills, [
      {
        id: "danyuchn/asd-ste100-skill:@root",
        name: "asd-ste100",
        description: "Simplified Technical English.",
        sourcePath: "@root",
        installed: false,
      },
    ]);

    const state = yield* marketplace.install("danyuchn/asd-ste100-skill:@root");
    assert.deepStrictEqual(
      state.installedSkills.map((skill) => [skill.id, skill.name]),
      [["danyuchn/asd-ste100-skill:@root", "asd-ste100"]],
    );
    assert.strictEqual(
      yield* fileSystem.readFileString(
        path.join(
          config.skillsDir,
          "danyuchn--asd-ste100-skill",
          "@root",
          "references",
          "rules.md",
        ),
      ),
      "rules\n",
    );
  }).pipe(Effect.provide(layer));
});
