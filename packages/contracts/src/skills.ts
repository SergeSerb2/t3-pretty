/**
 * Skills — agent skills (SKILL.md folders) as the environment host sees them.
 *
 * A skill is one folder with a `SKILL.md`. Provider CLIs discover skills from
 * their own user-scope `skills/` directory (`~/.claude/skills`,
 * `~/.cursor/skills`, …) and, for some of them, from the shared
 * `~/.agents/skills` library. T3 Code does not keep a store of its own: the
 * shared library *is* the store, and a skill reaches a CLI that does not read
 * the shared folder through a symlink in that CLI's directory — the same
 * layout the `npx skills` installer produces, so the two stay interoperable.
 *
 * The server scans every location, folds links onto the folder they point at,
 * and reports one `Skill` per real folder with the locations it is present in.
 * Marketplace installs land in the shared library and link into every
 * provider location. Per-thread picks are ids from this list (orchestration
 * read model); their instructions travel with the first turn that carries them.
 *
 * @module skills
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const SKILL_DOCUMENT_MAX_BYTES = 1024 * 1024;
export const SKILL_FRONTMATTER_READ_MAX_BYTES = 256 * 1024;
export const SKILL_ID_MAX_LENGTH = 4_096;
export const SKILL_NAME_MAX_LENGTH = 512;
export const SKILL_DESCRIPTION_MAX_LENGTH = 8_192;
export const SKILL_SOURCE_REPO_MAX_LENGTH = 512;
export const SKILL_SOURCE_PATH_MAX_LENGTH = 4_096;
export const SKILL_LOCATION_KEY_MAX_LENGTH = 512;
export const SKILL_SETTINGS_MAX_ENABLED = 1_024;
export const SKILL_SETTINGS_MAX_MARKETPLACE_SOURCES = 64;
export const SKILL_STATE_MAX_ITEMS = 4_096;
export const SKILL_STATE_MAX_LOCATIONS = 256;

const SkillName = TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_NAME_MAX_LENGTH));
const SkillDescription = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SKILL_DESCRIPTION_MAX_LENGTH),
);
const SkillSourceRepo = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SKILL_SOURCE_REPO_MAX_LENGTH),
);
const SkillSourcePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SKILL_SOURCE_PATH_MAX_LENGTH),
);

/**
 * Skill identifier. Library skills are `"host:<location key>:<dir>"`, minted
 * by the server from the location that holds the real folder (e.g.
 * `"host:agents:ponytail"`). Marketplace skills are
 * `"<owner>/<repo>:<skill dir relative to repo root>"` and only appear as
 * install requests. Clients never send a filesystem path.
 */
export const SkillId = TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_ID_MAX_LENGTH));
export type SkillId = typeof SkillId.Type;

/** A GitHub repository browsable as a skill marketplace ("owner/repo"). */
export const SkillMarketplaceSource = Schema.Struct({
  repo: SkillSourceRepo,
});
export type SkillMarketplaceSource = typeof SkillMarketplaceSource.Type;

/** Per-thread skill picks (orchestration); bounded like every other id list. */
export const EnabledSkillIds = Schema.Array(SkillId).check(
  Schema.isMaxLength(SKILL_SETTINGS_MAX_ENABLED),
);
export type EnabledSkillIds = typeof EnabledSkillIds.Type;

export const SkillMarketplaceSources = Schema.Array(SkillMarketplaceSource).check(
  Schema.isMaxLength(SKILL_SETTINGS_MAX_MARKETPLACE_SOURCES),
);
export type SkillMarketplaceSources = typeof SkillMarketplaceSources.Type;

export const DEFAULT_SKILL_MARKETPLACE_SOURCES: ReadonlyArray<SkillMarketplaceSource> = [
  { repo: "mattpocock/skills" },
];

/** Skills configuration inside `ServerSettings`. */
export const SkillsSettings = Schema.Struct({
  marketplaceSources: SkillMarketplaceSources.pipe(
    Schema.withDecodingDefault(Effect.succeed([...DEFAULT_SKILL_MARKETPLACE_SOURCES])),
  ),
});
export type SkillsSettings = typeof SkillsSettings.Type;

/**
 * Key of a skills folder on the host: `"agents"` for the shared library,
 * `"<driver>"` for a provider CLI's default home, `"<driver>:<instanceId>"`
 * for a configured instance with its own home.
 */
export const SkillLocationKey = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SKILL_LOCATION_KEY_MAX_LENGTH),
);
export type SkillLocationKey = typeof SkillLocationKey.Type;

/** One skills folder the server scans. */
export const SkillLocation = Schema.Struct({
  key: SkillLocationKey,
  /** "Shared", "Claude Code", "Codex · Work". */
  title: SkillName,
  /** Home-abbreviated folder, e.g. `~/.claude/skills`. */
  displayPath: SkillSourcePath,
  driver: Schema.optional(ProviderDriverKind),
  instanceId: Schema.optional(ProviderInstanceId),
  /**
   * Location keys this CLI scans natively, its own included. A skill present
   * in any of them is visible to the CLI without a link in its own folder.
   */
  reads: Schema.Array(SkillLocationKey).check(Schema.isMaxLength(SKILL_STATE_MAX_LOCATIONS)),
});
export type SkillLocation = typeof SkillLocation.Type;

/** Where a marketplace install came from; absent for skills installed by other tools. */
export const SkillSource = Schema.Struct({
  repo: SkillSourceRepo,
  path: SkillSourcePath,
});
export type SkillSource = typeof SkillSource.Type;

/** One real skill folder on the host, with every location that resolves to it. */
export const Skill = Schema.Struct({
  id: SkillId,
  /** Frontmatter `name`, falling back to the folder name. */
  name: SkillName,
  /** Folder name — what `$mention` and `/slash` invocations use. */
  dirName: SkillName,
  description: Schema.optional(SkillDescription),
  /** Home-abbreviated real folder, e.g. `~/.agents/skills/ponytail`. */
  displayPath: SkillSourcePath,
  /** Location holding the real folder. */
  home: SkillLocationKey,
  /** `home` plus every location with a link to it. */
  presentIn: Schema.Array(SkillLocationKey).check(Schema.isMaxLength(SKILL_STATE_MAX_LOCATIONS)),
  source: Schema.optional(SkillSource),
  installedAt: Schema.optional(IsoDateTime.check(Schema.isMaxLength(128))),
});
export type Skill = typeof Skill.Type;

/** Full inventory returned by every state-mutating skills RPC. */
export const SkillsState = Schema.Struct({
  locations: Schema.Array(SkillLocation).check(Schema.isMaxLength(SKILL_STATE_MAX_LOCATIONS)),
  skills: Schema.Array(Skill).check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS)),
});
export type SkillsState = typeof SkillsState.Type;

/** A skill browsable in a marketplace source. */
export const MarketplaceSkill = Schema.Struct({
  id: SkillId,
  name: SkillName,
  description: Schema.optional(SkillDescription),
  // Directory containing SKILL.md, relative to the repository root.
  sourcePath: SkillSourcePath,
  /** A skill with this folder name is already in the library (from any installer). */
  installed: Schema.Boolean,
});
export type MarketplaceSkill = typeof MarketplaceSkill.Type;

export const SkillMarketplaceListing = Schema.Struct({
  repo: SkillSourceRepo,
  fetchedAt: IsoDateTime.check(Schema.isMaxLength(128)),
  skills: Schema.Array(MarketplaceSkill).check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS)),
});
export type SkillMarketplaceListing = typeof SkillMarketplaceListing.Type;

export const SkillsOperation = Schema.Literals([
  "list",
  "install",
  "uninstall",
  "set-location",
  "resolve",
  "migrate",
  "list-marketplace",
  "refresh-marketplace",
]);
export type SkillsOperation = typeof SkillsOperation.Type;

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()("SkillsError", {
  operation: SkillsOperation,
  skillId: Schema.optional(SkillId),
  sourceRepo: Schema.optional(SkillSourceRepo),
  message: SkillDescription,
  cause: Schema.optional(Schema.Defect()),
}) {}
