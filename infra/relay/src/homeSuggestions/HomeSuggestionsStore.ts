/**
 * HomeSuggestionsStore - one home suggestions batch per account.
 *
 * Every linked environment syncs here instead of generating its own daily
 * batch. A sync uploads the environment's digest, applies dismissals, and may
 * claim a short generation lease. The lease holder reads every digest,
 * generates once, and publishes; everyone else adopts the stored batch.
 *
 * @module HomeSuggestionsStore
 */
import type { EnvironmentId, HomeSuggestionId, HomeSuggestionsDigest } from "@t3tools/contracts";
import {
  RELAY_HOME_SUGGESTIONS_MAX_DIGESTS,
  type RelayHomeSuggestionsBatch,
  type RelayHomeSuggestionsClaim,
  type RelayHomeSuggestionsLease,
  type RelayHomeSuggestionsPublishRequest,
  type RelayHomeSuggestionsPublishResponse,
  type RelayHomeSuggestionsSyncRequest,
  type RelayHomeSuggestionsSyncResponse,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import {
  relayEnvironmentLinks,
  relayHomeSuggestionDigests,
  relayHomeSuggestions,
} from "../persistence/schema.ts";

/** Long enough for one generation; a crashed holder frees the slot after this. */
export const HOME_SUGGESTIONS_LEASE_DURATION = Duration.minutes(15);
/**
 * A scheduled claim waits until the shared batch is this old, so environments
 * with different daily times or zones still generate once a day between them.
 */
export const HOME_SUGGESTIONS_SCHEDULED_MIN_AGE = Duration.hours(20);
/** Digests older than this describe a machine that has gone quiet. */
export const HOME_SUGGESTIONS_DIGEST_MAX_AGE = Duration.days(3);
/** Digests are deleted once they are this old. */
const HOME_SUGGESTIONS_DIGEST_RETENTION = Duration.days(7);

export interface HomeSuggestionsLeaseRow {
  readonly generatedAt: string | null;
  readonly leaseEnvironmentId: string | null;
  readonly leaseExpiresAt: string | null;
}

export function decideHomeSuggestionsClaim(input: {
  readonly row: HomeSuggestionsLeaseRow | null;
  readonly environmentId: string;
  readonly claim: RelayHomeSuggestionsClaim;
  readonly nowMs: number;
}): RelayHomeSuggestionsLease {
  const row = input.row;
  const leaseExpiresMs = Date.parse(row?.leaseExpiresAt ?? "");
  if (
    row?.leaseEnvironmentId != null &&
    row.leaseEnvironmentId !== input.environmentId &&
    leaseExpiresMs > input.nowMs
  ) {
    return "held";
  }
  if (input.claim === "scheduled" && row?.generatedAt != null) {
    const ageMs = input.nowMs - Date.parse(row.generatedAt);
    if (ageMs < Duration.toMillis(HOME_SUGGESTIONS_SCHEDULED_MIN_AGE)) return "none";
  }
  return "granted";
}

export function dismissFromBatch(
  batch: RelayHomeSuggestionsBatch,
  suggestionIds: ReadonlyArray<HomeSuggestionId>,
): RelayHomeSuggestionsBatch {
  const dismissed = new Set<string>(suggestionIds);
  return {
    ...batch,
    suggestions: batch.suggestions.filter((card) => !dismissed.has(card.id)),
  };
}

export class HomeSuggestionsStorePersistenceError extends Schema.TaggedError<HomeSuggestionsStorePersistenceError>()(
  "HomeSuggestionsStorePersistenceError",
  {
    environmentId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync home suggestions for environment '${this.environmentId}'`;
  }
}

export class HomeSuggestionsEnvironmentNotLinked extends Schema.TaggedError<HomeSuggestionsEnvironmentNotLinked>()(
  "HomeSuggestionsEnvironmentNotLinked",
  {
    environmentId: Schema.String,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' has no active account link`;
  }
}

const isHomeSuggestionsEnvironmentNotLinked = Schema.is(HomeSuggestionsEnvironmentNotLinked);

interface EnvironmentPrincipal {
  readonly environmentId: EnvironmentId;
  readonly environmentPublicKey: string;
}

type StoreError = HomeSuggestionsStorePersistenceError | HomeSuggestionsEnvironmentNotLinked;

export class HomeSuggestionsStore extends Context.Service<
  HomeSuggestionsStore,
  {
    readonly sync: (
      input: EnvironmentPrincipal & { readonly request: RelayHomeSuggestionsSyncRequest },
    ) => Effect.Effect<RelayHomeSuggestionsSyncResponse, StoreError>;
    readonly publish: (
      input: EnvironmentPrincipal & { readonly request: RelayHomeSuggestionsPublishRequest },
    ) => Effect.Effect<RelayHomeSuggestionsPublishResponse, StoreError>;
  }
>()("t3code-relay/homeSuggestions/HomeSuggestionsStore") {}

const isoMinus = (nowMs: number, duration: Duration.Duration) =>
  DateTime.formatIso(DateTime.makeUnsafe(nowMs - Duration.toMillis(duration)));

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const transactions = yield* RelayDb.RelayTransactions;

  // The account that owns the environment's active link. An environment is
  // linked to one account in practice; the newest link wins otherwise.
  const resolveUserId = (principal: EnvironmentPrincipal) =>
    db
      .select({ userId: relayEnvironmentLinks.userId })
      .from(relayEnvironmentLinks)
      .where(
        and(
          eq(relayEnvironmentLinks.environmentId, principal.environmentId),
          eq(relayEnvironmentLinks.environmentPublicKey, principal.environmentPublicKey),
          isNull(relayEnvironmentLinks.revokedAt),
        ),
      )
      .orderBy(desc(relayEnvironmentLinks.updatedAt))
      .limit(1)
      .pipe(
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.fail(
                new HomeSuggestionsEnvironmentNotLinked({
                  environmentId: principal.environmentId,
                }),
              )
            : Effect.succeed(row.userId),
        ),
      );

  // Creates the account row on first use, then locks it for this transaction.
  const lockRow = (userId: string, now: string) =>
    db
      .insert(relayHomeSuggestions)
      .values({ userId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .pipe(
        Effect.andThen(
          db
            .select()
            .from(relayHomeSuggestions)
            .where(eq(relayHomeSuggestions.userId, userId))
            .for("update"),
        ),
        Effect.map(([row]) => row ?? null),
      );

  const persistenceError = (environmentId: string) => (cause: unknown) =>
    isHomeSuggestionsEnvironmentNotLinked(cause)
      ? cause
      : new HomeSuggestionsStorePersistenceError({ environmentId, cause });

  const sync: HomeSuggestionsStore["Service"]["sync"] = Effect.fn("relay.home_suggestions.sync")(
    function* (input) {
      const { environmentId, request } = input;
      const nowMs = (yield* DateTime.now).epochMilliseconds;
      const now = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
      return yield* transactions
        .withTransaction(
          Effect.gen(function* () {
            const userId = yield* resolveUserId(input);
            if (request.digest !== null) {
              // The principal, not the payload, names the environment.
              const digest: HomeSuggestionsDigest = { ...request.digest, environmentId };
              yield* db
                .insert(relayHomeSuggestionDigests)
                .values({ userId, environmentId, digestJson: digest, updatedAt: now })
                .onConflictDoUpdate({
                  target: [
                    relayHomeSuggestionDigests.userId,
                    relayHomeSuggestionDigests.environmentId,
                  ],
                  set: { digestJson: digest, updatedAt: now },
                });
            }
            const row = yield* lockRow(userId, now);
            let batch = row?.batchJson ?? null;
            if (batch !== null && request.dismissedSuggestionIds.length > 0) {
              batch = dismissFromBatch(batch, request.dismissedSuggestionIds);
              yield* db
                .update(relayHomeSuggestions)
                .set({ batchJson: batch, updatedAt: now })
                .where(eq(relayHomeSuggestions.userId, userId));
            }
            const lease =
              request.claim === null
                ? "none"
                : decideHomeSuggestionsClaim({ row, environmentId, claim: request.claim, nowMs });
            if (lease !== "granted") return { batch, lease, digests: [] };
            yield* db
              .update(relayHomeSuggestions)
              .set({
                leaseEnvironmentId: environmentId,
                leaseExpiresAt: DateTime.formatIso(
                  DateTime.makeUnsafe(nowMs + Duration.toMillis(HOME_SUGGESTIONS_LEASE_DURATION)),
                ),
                updatedAt: now,
              })
              .where(eq(relayHomeSuggestions.userId, userId));
            const digests = yield* db
              .select({ digestJson: relayHomeSuggestionDigests.digestJson })
              .from(relayHomeSuggestionDigests)
              .where(
                and(
                  eq(relayHomeSuggestionDigests.userId, userId),
                  ne(relayHomeSuggestionDigests.environmentId, environmentId),
                  gte(
                    relayHomeSuggestionDigests.updatedAt,
                    isoMinus(nowMs, HOME_SUGGESTIONS_DIGEST_MAX_AGE),
                  ),
                ),
              )
              .orderBy(desc(relayHomeSuggestionDigests.updatedAt))
              .limit(RELAY_HOME_SUGGESTIONS_MAX_DIGESTS);
            return { batch, lease, digests: digests.map((digest) => digest.digestJson) };
          }),
        )
        .pipe(Effect.mapError(persistenceError(environmentId)));
    },
  );

  const publish: HomeSuggestionsStore["Service"]["publish"] = Effect.fn(
    "relay.home_suggestions.publish",
  )(function* (input) {
    const { environmentId, request } = input;
    const nowMs = (yield* DateTime.now).epochMilliseconds;
    const now = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    return yield* transactions
      .withTransaction(
        Effect.gen(function* () {
          const userId = yield* resolveUserId(input);
          const row = yield* lockRow(userId, now);
          // Publishing needs the lease or a free slot; "manual" is the claim
          // that ignores batch age.
          if (
            decideHomeSuggestionsClaim({ row, environmentId, claim: "manual", nowMs }) === "held"
          ) {
            return { batch: null };
          }
          const batch: RelayHomeSuggestionsBatch = {
            generatedAt: now,
            generatedByEnvironmentId: environmentId,
            suggestions: request.suggestions,
            previousTitles: request.previousTitles,
          };
          yield* db
            .update(relayHomeSuggestions)
            .set({
              batchJson: batch,
              generatedAt: now,
              leaseEnvironmentId: null,
              leaseExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(relayHomeSuggestions.userId, userId));
          yield* db
            .delete(relayHomeSuggestionDigests)
            .where(
              and(
                eq(relayHomeSuggestionDigests.userId, userId),
                lt(
                  relayHomeSuggestionDigests.updatedAt,
                  isoMinus(nowMs, HOME_SUGGESTIONS_DIGEST_RETENTION),
                ),
              ),
            );
          return { batch };
        }),
      )
      .pipe(Effect.mapError(persistenceError(environmentId)));
  });

  return HomeSuggestionsStore.of({ sync, publish });
});

export const layer = Layer.effect(HomeSuggestionsStore, make);
