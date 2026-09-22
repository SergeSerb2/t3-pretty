/**
 * Home suggestions - the prompt cards the home screen shows.
 *
 * A server generates one batch per day from its projects and recent threads
 * (see `apps/server/src/homeSuggestions/HomeSuggestionsService.ts`), keeps the
 * batch on disk, and streams it to clients through `subscribeHomeSuggestions`.
 * A card is a ready-to-send prompt: "project" cards continue work in an
 * existing project, "explore" cards start something new.
 *
 * Environments linked to the same Connect account share one batch through the
 * relay: each uploads a `HomeSuggestionsDigest`, one of them generates from
 * every digest, and the rest adopt the result. A project card therefore names
 * the environment that owns its project.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const HomeSuggestionId = Schema.String.pipe(Schema.brand("HomeSuggestionId"));
export type HomeSuggestionId = typeof HomeSuggestionId.Type;

export const HomeSuggestionKind = Schema.Literals(["project", "explore"]);
export type HomeSuggestionKind = typeof HomeSuggestionKind.Type;

export const HomeSuggestion = Schema.Struct({
  id: HomeSuggestionId,
  kind: HomeSuggestionKind,
  /** The project a "project" card continues; null for "explore" cards. */
  projectId: Schema.NullOr(ProjectId),
  /**
   * The environment that owns `projectId`. Null for "explore" cards and for
   * batches stored before mesh sharing, which always meant the serving
   * environment.
   */
  environmentId: Schema.NullOr(EnvironmentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  title: TrimmedNonEmptyString,
  /** One sentence on why this is worth doing now. */
  summary: Schema.String,
  /** The full prompt placed in the composer when the card is started. */
  prompt: TrimmedNonEmptyString,
});
export type HomeSuggestion = typeof HomeSuggestion.Type;

export const HomeSuggestionsStatus = Schema.Literals(["idle", "generating", "ready", "failed"]);
export type HomeSuggestionsStatus = typeof HomeSuggestionsStatus.Type;

export const HomeSuggestionsSnapshot = Schema.Struct({
  status: HomeSuggestionsStatus,
  /** When the current batch was generated; null until the first batch lands. */
  generatedAt: Schema.NullOr(IsoDateTime),
  /** The next scheduled generation, null while suggestions are turned off. */
  nextRunAt: Schema.NullOr(IsoDateTime),
  /**
   * IANA zone `nextRunAt` was computed in. Clients format the clock in this
   * zone so a remote browser does not relabel 09:00 as the user's midnight.
   */
  timeZone: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("UTC"))),
  /** Why the last generation failed; cleared by the next successful batch. */
  error: Schema.NullOr(Schema.String),
  suggestions: Schema.Array(HomeSuggestion),
});
export type HomeSuggestionsSnapshot = typeof HomeSuggestionsSnapshot.Type;

export const EMPTY_HOME_SUGGESTIONS_SNAPSHOT: HomeSuggestionsSnapshot = {
  status: "idle",
  generatedAt: null,
  nextRunAt: null,
  timeZone: "UTC",
  error: null,
  suggestions: [],
};

/** Card counts per batch: roughly two thirds project work, one third new ideas. */
export const HOME_SUGGESTIONS_PROJECT_COUNT = 6;
export const HOME_SUGGESTIONS_EXPLORE_COUNT = 3;

export const HOME_SUGGESTIONS_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Local wall-clock time of the daily generation, "HH:MM" in the server's timezone. */
export const HomeSuggestionsTime = Schema.String.check(
  Schema.isPattern(HOME_SUGGESTIONS_TIME_PATTERN, {
    title: "HomeSuggestionsTime",
    description: "a 24-hour time such as 09:00",
  }),
);
export type HomeSuggestionsTime = typeof HomeSuggestionsTime.Type;

export const DEFAULT_HOME_SUGGESTIONS_TIME = "09:00";

/** Bounds on one environment's digest, so a relay row stays small. */
export const HOME_SUGGESTIONS_DIGEST_MAX_PROJECTS = 64;
export const HOME_SUGGESTIONS_DIGEST_MAX_THREADS = 40;
const DIGEST_TEXT_MAX_LENGTH = 1_024;

const DigestText = Schema.String.check(Schema.isMaxLength(DIGEST_TEXT_MAX_LENGTH));

export const HomeSuggestionsDigestProject = Schema.Struct({
  id: ProjectId,
  title: DigestText,
  /** Last path segment of the workspace root, never the full path. */
  folder: DigestText,
  /** Newest thread activity, or the project's own update time. */
  lastActiveAt: IsoDateTime,
});
export type HomeSuggestionsDigestProject = typeof HomeSuggestionsDigestProject.Type;

export const HomeSuggestionsDigestThread = Schema.Struct({
  projectId: ProjectId,
  title: DigestText,
  updatedAt: IsoDateTime,
  /** The latest turn's state, "idle" before the first turn. */
  status: DigestText,
  /** Clipped first user message. */
  asked: DigestText,
  /** Clipped last assistant message. */
  outcome: DigestText,
});
export type HomeSuggestionsDigestThread = typeof HomeSuggestionsDigestThread.Type;

/**
 * One environment's recent work, already clipped. The generating environment
 * renders every digest in the mesh into the model's context.
 */
export const HomeSuggestionsDigest = Schema.Struct({
  environmentId: EnvironmentId,
  environmentLabel: DigestText,
  projects: Schema.Array(HomeSuggestionsDigestProject).check(
    Schema.isMaxLength(HOME_SUGGESTIONS_DIGEST_MAX_PROJECTS),
  ),
  threads: Schema.Array(HomeSuggestionsDigestThread).check(
    Schema.isMaxLength(HOME_SUGGESTIONS_DIGEST_MAX_THREADS),
  ),
});
export type HomeSuggestionsDigest = typeof HomeSuggestionsDigest.Type;

export class HomeSuggestionsError extends Schema.TaggedError<HomeSuggestionsError>()(
  "HomeSuggestionsError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Home suggestions failed: ${this.detail}`;
  }
}

export const HomeSuggestionsDismissInput = Schema.Struct({
  suggestionId: HomeSuggestionId,
});
export type HomeSuggestionsDismissInput = typeof HomeSuggestionsDismissInput.Type;
