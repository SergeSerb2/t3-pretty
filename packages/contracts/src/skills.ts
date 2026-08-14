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
 * @module skills
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Stable skill identifier: `"<owner>/<repo>:<skill dir relative to repo root>"`,
 * e.g. `"mattpocock/skills:skills/engineering/tdd"`. The id doubles as the
 * install location inside the server's skill store, so it round-trips
 * through reinstalls and marketplace refreshes.
 */
export const SkillId = TrimmedNonEmptyString;
export type SkillId = typeof SkillId.Type;

/** A GitHub repository browsable as a skill marketplace ("owner/repo"). */
export const SkillMarketplaceSource = Schema.Struct({
  repo: TrimmedNonEmptyString,
});
export type SkillMarketplaceSource = typeof SkillMarketplaceSource.Type;

export const DEFAULT_SKILL_MARKETPLACE_SOURCES: ReadonlyArray<SkillMarketplaceSource> = [
  { repo: "mattpocock/skills" },
];

/** Global skills configuration inside `ServerSettings`. */
export const SkillsSettings = Schema.Struct({
  // Skills enabled for every thread in this environment; per-thread picks
  // union on top of these.
  enabledSkillIds: Schema.Array(SkillId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  marketplaceSources: Schema.Array(SkillMarketplaceSource).pipe(
    Schema.withDecodingDefault(Effect.succeed([...DEFAULT_SKILL_MARKETPLACE_SOURCES])),
  ),
});
export type SkillsSettings = typeof SkillsSettings.Type;

/** A skill installed into the server's central store. */
export const InstalledSkill = Schema.Struct({
  id: SkillId,
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  sourceRepo: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  installedAt: IsoDateTime,
});
export type InstalledSkill = typeof InstalledSkill.Type;

/** A skill browsable in a marketplace source. */
export const MarketplaceSkill = Schema.Struct({
  id: SkillId,
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  // Directory containing SKILL.md, relative to the repository root.
  sourcePath: TrimmedNonEmptyString,
  installed: Schema.Boolean,
});
export type MarketplaceSkill = typeof MarketplaceSkill.Type;

export const SkillMarketplaceListing = Schema.Struct({
  repo: TrimmedNonEmptyString,
  fetchedAt: IsoDateTime,
  skills: Schema.Array(MarketplaceSkill),
});
export type SkillMarketplaceListing = typeof SkillMarketplaceListing.Type;

/** Full skills registry snapshot returned by state-mutating RPCs. */
export const SkillsState = Schema.Struct({
  installedSkills: Schema.Array(InstalledSkill),
});
export type SkillsState = typeof SkillsState.Type;

export const SkillsOperation = Schema.Literals([
  "read-store",
  "install",
  "uninstall",
  "list-marketplace",
  "refresh-marketplace",
  "materialize",
]);
export type SkillsOperation = typeof SkillsOperation.Type;

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()("SkillsError", {
  operation: SkillsOperation,
  skillId: Schema.optional(SkillId),
  sourceRepo: Schema.optional(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}
