/**
 * Skills — agent skills (SKILL.md bundles) managed by the T3 server.
 *
 * The server keeps a central skill store under its state directory, fetches
 * browsable listings from marketplace repositories (GitHub `owner/repo`
 * sources such as mattpocock/skills), installs skills into the store, and
 * materializes the enabled set into a thread's workspace at turn start.
 * Enablement is global (server settings, applying to every new turn) or
 * per-thread (orchestration read model); the two sets are unioned when a
 * turn starts.
 *
 * Provider CLIs also keep their own user-scope skill folders (`~/.claude/skills`,
 * `~/.codex/skills`, …). Those live on the environment host — the same machine
 * whether the client is local or remote — and are listed, enabled, disabled, or
 * uninstalled by opaque server-minted ids, never by a client-supplied path.
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
export const SKILL_SETTINGS_MAX_ENABLED = 1_024;
export const SKILL_SETTINGS_MAX_MARKETPLACE_SOURCES = 64;
export const SKILL_STATE_MAX_ITEMS = 4_096;

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
 * Stable skill identifier: `"<owner>/<repo>:<skill dir relative to repo root>"`,
 * e.g. `"mattpocock/skills:skills/engineering/tdd"`. The id doubles as the
 * install location inside the server's skill store, so it round-trips
 * through reinstalls and marketplace refreshes.
 */
export const SkillId = TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_ID_MAX_LENGTH));
export type SkillId = typeof SkillId.Type;

/** A GitHub repository browsable as a skill marketplace ("owner/repo"). */
export const SkillMarketplaceSource = Schema.Struct({
  repo: SkillSourceRepo,
});
export type SkillMarketplaceSource = typeof SkillMarketplaceSource.Type;

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

/** Global skills configuration inside `ServerSettings`. */
export const SkillsSettings = Schema.Struct({
  // Skills enabled for every thread in this environment; per-thread picks
  // union on top of these.
  enabledSkillIds: EnabledSkillIds.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  marketplaceSources: SkillMarketplaceSources.pipe(
    Schema.withDecodingDefault(Effect.succeed([...DEFAULT_SKILL_MARKETPLACE_SOURCES])),
  ),
});
export type SkillsSettings = typeof SkillsSettings.Type;

/** A skill installed into the server's central store. */
export const InstalledSkill = Schema.Struct({
  id: SkillId,
  name: SkillName,
  description: Schema.optional(SkillDescription),
  sourceRepo: SkillSourceRepo,
  sourcePath: SkillSourcePath,
  installedAt: IsoDateTime.check(Schema.isMaxLength(128)),
});
export type InstalledSkill = typeof InstalledSkill.Type;

/** A skill browsable in a marketplace source. */
export const MarketplaceSkill = Schema.Struct({
  id: SkillId,
  name: SkillName,
  description: Schema.optional(SkillDescription),
  // Directory containing SKILL.md, relative to the repository root.
  sourcePath: SkillSourcePath,
  installed: Schema.Boolean,
});
export type MarketplaceSkill = typeof MarketplaceSkill.Type;

export const SkillMarketplaceListing = Schema.Struct({
  repo: SkillSourceRepo,
  fetchedAt: IsoDateTime.check(Schema.isMaxLength(128)),
  skills: Schema.Array(MarketplaceSkill).check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS)),
});
export type SkillMarketplaceListing = typeof SkillMarketplaceListing.Type;

/** Full skills registry snapshot returned by state-mutating RPCs. */
export const SkillsState = Schema.Struct({
  installedSkills: Schema.Array(InstalledSkill).check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS)),
});
export type SkillsState = typeof SkillsState.Type;

/**
 * Opaque id for a skill folder in a provider CLI home, minted by the server
 * (`host:<origin>:<dir>` or `host:<origin>:<instanceId>:<dir>`). Clients send
 * this back on uninstall; they never send a filesystem path.
 */
export const HostSkillId = TrimmedNonEmptyString.check(Schema.isMaxLength(SKILL_ID_MAX_LENGTH));
export type HostSkillId = typeof HostSkillId.Type;

/**
 * A skill the environment host already has in a provider CLI's user-scope
 * `skills/` directory (or the shared `~/.agents/skills` folder). Distinct from
 * `InstalledSkill`, which lives in T3's own store.
 */
export const HostSkill = Schema.Struct({
  id: HostSkillId,
  name: SkillName,
  description: Schema.optional(SkillDescription),
  /** Absolute path to the skill document, for display and snapshot dedupe. */
  path: SkillSourcePath,
  /** Home-abbreviated skill directory, e.g. `~/.claude/skills/grill-me`. */
  displayPath: SkillSourcePath,
  /** Provider or shared-root label, e.g. "Claude Code", "Codex", "Shared". */
  origin: SkillName,
  /**
   * False when the skill folder is still on disk but hidden from provider CLIs.
   * Default on: these skills already live in a CLI home, unlike T3-store skills
   * which opt into every thread.
   */
  enabled: Schema.Boolean,
  driver: Schema.optional(ProviderDriverKind),
  instanceId: Schema.optional(ProviderInstanceId),
});
export type HostSkill = typeof HostSkill.Type;

export const HostSkillsState = Schema.Struct({
  skills: Schema.Array(HostSkill).check(Schema.isMaxLength(SKILL_STATE_MAX_ITEMS)),
});
export type HostSkillsState = typeof HostSkillsState.Type;

export const SkillsOperation = Schema.Literals([
  "read-store",
  "install",
  "uninstall",
  "list-marketplace",
  "refresh-marketplace",
  "materialize",
  "list-host",
  "uninstall-host",
  "set-host-enabled",
]);
export type SkillsOperation = typeof SkillsOperation.Type;

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()("SkillsError", {
  operation: SkillsOperation,
  skillId: Schema.optional(SkillId),
  sourceRepo: Schema.optional(SkillSourceRepo),
  message: SkillDescription,
  cause: Schema.optional(Schema.Defect()),
}) {}
