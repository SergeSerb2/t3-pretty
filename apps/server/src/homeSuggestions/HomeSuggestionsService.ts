/**
 * HomeSuggestionsService - the daily prompt cards on the home screen.
 *
 * Once a day at the configured local time (and once on first start, so a
 * fresh install is not empty) the service digests every project and its
 * recent threads, asks the home-suggestions model for a batch of cards, and
 * keeps the batch in `<stateDir>/home-suggestions.json`. Clients follow
 * `streamChanges`; "Refresh" enqueues the same generation by hand. A missed
 * instant (server asleep at 09:00) runs once when the server is back, because
 * the due time is derived from when the last batch was generated rather than
 * from a timer.
 *
 * One drainable worker runs the tick and the generation, so tests wait on
 * `drain` instead of sleeping.
 *
 * @module HomeSuggestionsService
 */
import {
  DEFAULT_SERVER_SETTINGS,
  EMPTY_HOME_SUGGESTIONS_SNAPSHOT,
  HOME_SUGGESTIONS_EXPLORE_COUNT,
  HOME_SUGGESTIONS_PROJECT_COUNT,
  HomeSuggestion,
  HomeSuggestionsError,
  type HomeSuggestionId,
  type HomeSuggestionsSnapshot,
  type ServerSettings,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import {
  buildHomeSuggestionsDigest,
  mapGeneratedSuggestions,
  nextHomeSuggestionsRunAt,
  rememberTitles,
  selectDigestThreads,
  type DigestThread,
} from "./HomeSuggestionsContext.ts";

export const HOME_SUGGESTIONS_TICK_INTERVAL = Duration.minutes(1);
export const HOME_SUGGESTIONS_FILE_NAME = "home-suggestions.json";

/**
 * What survives a restart. `generatedAt` is the last successful batch;
 * `lastAttemptAt` and `lastError` describe the most recent attempt, so a
 * failure is still shown after a restart and the schedule can tell "never
 * succeeded" from "succeeded, then failed".
 */
const StoredState = Schema.Struct({
  generatedAt: Schema.NullOr(Schema.String),
  lastAttemptAt: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastError: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  suggestions: Schema.Array(HomeSuggestion),
  previousTitles: Schema.Array(Schema.String),
});
type StoredState = typeof StoredState.Type;

const decodeStoredState = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredState));
const encodeStoredState = Schema.encodeEffect(Schema.fromJsonString(StoredState));

const EMPTY_STORED_STATE: StoredState = {
  generatedAt: null,
  lastAttemptAt: null,
  lastError: null,
  suggestions: [],
  previousTitles: [],
};

/** A fresh install whose first batch failed retries this often, not tomorrow. */
export const HOME_SUGGESTIONS_FIRST_BATCH_RETRY = Duration.hours(1);

type Job = { readonly kind: "tick" } | { readonly kind: "generate"; readonly reason: string };

export class HomeSuggestionsService extends Context.Service<
  HomeSuggestionsService,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly current: Effect.Effect<HomeSuggestionsSnapshot>;
    /** The current snapshot followed by every change. */
    readonly streamChanges: Stream.Stream<HomeSuggestionsSnapshot>;
    /** Queue a generation now; the result arrives on `streamChanges`. */
    readonly refresh: Effect.Effect<HomeSuggestionsSnapshot, HomeSuggestionsError>;
    readonly dismiss: (suggestionId: HomeSuggestionId) => Effect.Effect<HomeSuggestionsSnapshot>;
    /** Wait for queued work. Tests only. */
    readonly drain: Effect.Effect<void>;
    /** One tick, drained. Tests only. */
    readonly tickOnce: Effect.Effect<void>;
  }
>()("t3/homeSuggestions/HomeSuggestionsService") {}

interface Published {
  readonly seq: number;
  readonly snapshot: HomeSuggestionsSnapshot;
}

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const make = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* ServerSettingsService;
  const projection = yield* ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration;
  const backgroundPolicy = yield* BackgroundPolicy;
  const crypto = yield* Crypto.Crypto;

  const filePath = path.join(serverConfig.stateDir, HOME_SUGGESTIONS_FILE_NAME);
  const timeZone = localTimeZone();
  const settings = settingsService.getSettings.pipe(
    Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
  );
  const hostSuspended = backgroundPolicy.snapshot.pipe(
    Effect.map((snapshot) => snapshot.hostPower.suspended),
  );

  const stored = yield* Ref.make<StoredState>(EMPTY_STORED_STATE);
  const published = yield* Ref.make<Published>({
    seq: 0,
    snapshot: EMPTY_HOME_SUGGESTIONS_SNAPSHOT,
  });
  const changes = yield* PubSub.sliding<Published>(1);

  const publish = (update: (snapshot: HomeSuggestionsSnapshot) => HomeSuggestionsSnapshot) =>
    Ref.modify(published, (previous): readonly [Published, Published] => {
      const next = { seq: previous.seq + 1, snapshot: update(previous.snapshot) };
      return [next, next];
    }).pipe(Effect.tap((next) => PubSub.publish(changes, next)));

  // Never attempted: due right away, so a fresh install fills in on first
  // start. Never succeeded: retry an hour after the last attempt rather
  // than waiting for tomorrow's slot. Otherwise the first slot after the
  // last attempt, which is in the past after a long sleep and therefore
  // runs once on the next tick.
  const nextRunAtFor = (current: ServerSettings, state: StoredState, nowMs: number) => {
    if (!current.homeSuggestionsEnabled) return null;
    if (state.lastAttemptAt === null) return nowMs;
    const lastAttemptMs = Date.parse(state.lastAttemptAt);
    if (state.generatedAt === null) {
      return lastAttemptMs + Duration.toMillis(HOME_SUGGESTIONS_FIRST_BATCH_RETRY);
    }
    return nextHomeSuggestionsRunAt({
      time: current.homeSuggestionsTime,
      afterMs: Math.max(lastAttemptMs, Date.parse(state.generatedAt)),
      timeZone,
    });
  };

  const statusOf = (state: StoredState): HomeSuggestionsSnapshot["status"] =>
    state.lastError !== null ? "failed" : state.generatedAt === null ? "idle" : "ready";

  const isoOrNull = (millis: number | null) =>
    millis === null ? null : DateTime.formatIso(DateTime.makeUnsafe(millis));

  const load = Effect.gen(function* () {
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return EMPTY_STORED_STATE;
    return yield* fs.readFileString(filePath).pipe(
      Effect.flatMap(decodeStoredState),
      Effect.catchCause((cause) =>
        Effect.logWarning("home suggestions state could not be read; starting empty", {
          path: filePath,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(EMPTY_STORED_STATE)),
      ),
    );
  });

  // Dismiss runs on the RPC fiber while generation runs on the worker. Each
  // writes the *current* Ref value under one permit, so whichever write is
  // last still reflects both updates instead of a stale copy.
  const persistLock = yield* Semaphore.make(1);
  const persistCurrent = persistLock.withPermits(1)(Ref.get(stored).pipe(Effect.flatMap(persist)));

  function persist(state: StoredState) {
    return encodeStoredState(state).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath, contents })),
      Effect.catchCause((cause) =>
        Effect.logWarning("home suggestions state could not be written", {
          path: filePath,
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
  }

  const readDigestThreads = Effect.fn("HomeSuggestionsService.readDigestThreads")(function* () {
    const shell = yield* projection.getShellSnapshot();
    const shells = selectDigestThreads(shell.threads, shell.projects);
    const threads = yield* Effect.forEach(
      shells,
      (thread) =>
        projection.getThreadDetailById(thread.id, { activityKinds: [] }).pipe(
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (detail): DigestThread => ({
                shell: thread,
                messages: detail.messages.map(({ role, text }) => ({ role, text })),
              }),
            }),
          ),
          Effect.catchCause(() => Effect.succeed(null)),
        ),
      { concurrency: 4 },
    );
    return { projects: shell.projects, threads: threads.filter((thread) => thread !== null) };
  });

  const generate = Effect.fn("HomeSuggestionsService.generate")(function* (reason: string) {
    const current = yield* settings;
    const nowMs = yield* Clock.currentTimeMillis;
    yield* publish((snapshot) => ({ ...snapshot, status: "generating", error: null }));
    yield* Effect.logInfo("home suggestions generating", { reason });

    // `exit`, not `result`: a defect (a failing id generator, a projection
    // bug) must still land on `failed`, or the status stays `generating` and
    // every later tick and refresh refuses to enqueue.
    const exit = yield* Effect.gen(function* () {
      const { projects, threads } = yield* readDigestThreads();
      if (projects.length === 0) {
        return [] as ReadonlyArray<HomeSuggestion>;
      }
      const digest = buildHomeSuggestionsDigest({ projects, threads, nowMs });
      const state = yield* Ref.get(stored);
      const generated = yield* textGeneration.generateHomeSuggestions({
        // Providers bind a run to its cwd; use the digest's most recently
        // active project (P1) rather than whatever the snapshot lists first.
        cwd:
          projects.find((project) => project.id === digest.projectsByKey.get("P1"))
            ?.workspaceRoot ?? process.cwd(),
        context: digest.context,
        projectCount: HOME_SUGGESTIONS_PROJECT_COUNT,
        exploreCount: HOME_SUGGESTIONS_EXPLORE_COUNT,
        previousTitles: state.previousTitles,
        modelSelection: current.homeSuggestionsModelSelection,
      });
      const batchId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      return mapGeneratedSuggestions({
        generated: generated.suggestions,
        projectsByKey: digest.projectsByKey,
        makeId: (index) => `${batchId}:${index}`,
      });
    }).pipe(Effect.exit);

    // The attempt time always moves past this run, so a failing provider is
    // retried at the next slot (or by hand), not every minute.
    const attemptedAt = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    if (Exit.isFailure(exit)) {
      if (Cause.hasInterruptsOnly(exit.cause)) {
        return yield* Effect.interrupt;
      }
      const failure = Cause.squash(exit.cause);
      const error = failure instanceof Error ? failure.message : String(failure);
      yield* Effect.logWarning("home suggestions generation failed", { reason, error });
      const state = yield* Ref.updateAndGet(stored, (previous) => ({
        ...previous,
        lastAttemptAt: attemptedAt,
        lastError: error,
      }));
      yield* persistCurrent;
      yield* publish((snapshot) => ({
        ...snapshot,
        status: "failed",
        error,
        nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
      }));
      return;
    }
    const suggestions = exit.value;
    const state = yield* Ref.updateAndGet(stored, (previous) => ({
      generatedAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      lastError: null,
      suggestions,
      previousTitles: rememberTitles(previous.previousTitles, suggestions),
    }));
    yield* persistCurrent;
    yield* publish(() => ({
      status: "ready",
      generatedAt: attemptedAt,
      nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
      error: null,
      suggestions,
    }));
    yield* Effect.logInfo("home suggestions generated", { reason, count: suggestions.length });
  });

  const processJob = (job: Job): Effect.Effect<void> =>
    (job.kind === "tick" ? tick() : generate(job.reason)).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("home suggestions job failed", {
              kind: job.kind,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  const worker = yield* makeDrainableWorker(processJob);

  const claimGenerate = (reason: string) =>
    Effect.gen(function* () {
      const snapshot = (yield* Ref.get(published)).snapshot;
      if (snapshot.status === "generating") return snapshot;
      const generating = yield* publish((previous) => ({
        ...previous,
        status: "generating" as const,
        error: null,
      }));
      yield* worker.enqueue({ kind: "generate", reason });
      return generating.snapshot;
    });

  const tick = Effect.fn("HomeSuggestionsService.tick")(function* () {
    const current = yield* settings;
    const state = yield* Ref.get(stored);
    const nowMs = yield* Clock.currentTimeMillis;
    const dueAt = nextRunAtFor(current, state, nowMs);
    const snapshot = (yield* Ref.get(published)).snapshot;
    const nextRunAt = isoOrNull(dueAt);
    if (snapshot.nextRunAt !== nextRunAt && snapshot.status !== "generating") {
      yield* publish((previous) => ({ ...previous, nextRunAt }));
    }
    if (dueAt === null || dueAt > nowMs) return;
    if (yield* hostSuspended) return;
    // Claim generating before enqueue so a second tick (settings change,
    // the 1-minute repeat, start+tickOnce) cannot queue another LLM batch
    // while this one is still waiting on the worker.
    yield* claimGenerate("schedule");
  });

  const enqueueAndDrain = (job: Job) => worker.enqueue(job).pipe(Effect.andThen(worker.drain));

  const start: HomeSuggestionsService["Service"]["start"] = Effect.fn(
    "HomeSuggestionsService.start",
  )(function* () {
    const state = yield* load;
    yield* Ref.set(stored, state);
    const current = yield* settings;
    const nowMs = yield* Clock.currentTimeMillis;
    yield* publish(() => ({
      status: statusOf(state),
      generatedAt: state.generatedAt,
      nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
      error: state.lastError,
      suggestions: state.suggestions,
    }));
    yield* forkParked(
      enqueueAndDrain({ kind: "tick" }).pipe(
        Effect.repeat(Schedule.spaced(HOME_SUGGESTIONS_TICK_INTERVAL)),
        Effect.asVoid,
      ),
    );
    // A time or toggle change should move the due time without waiting a minute.
    yield* forkParked(
      Stream.runForEach(settingsService.streamChanges, () => worker.enqueue({ kind: "tick" })),
    );
    yield* Effect.logInfo("home suggestions started", { timeZone });
  });

  const refresh: HomeSuggestionsService["Service"]["refresh"] = Effect.gen(function* () {
    const current = yield* settings;
    if (!current.homeSuggestionsEnabled) {
      return yield* new HomeSuggestionsError({
        detail: "Home suggestions are turned off in Settings.",
      });
    }
    return yield* claimGenerate("manual");
  });

  const dismiss: HomeSuggestionsService["Service"]["dismiss"] = (suggestionId) =>
    Effect.gen(function* () {
      const state = yield* Ref.updateAndGet(stored, (previous) => ({
        ...previous,
        suggestions: previous.suggestions.filter((card) => card.id !== suggestionId),
      }));
      yield* persistCurrent;
      const next = yield* publish((previous) => ({
        ...previous,
        suggestions: state.suggestions,
      }));
      return next.snapshot;
    });

  return {
    start,
    current: Ref.get(published).pipe(Effect.map((state) => state.snapshot)),
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* Ref.get(published);
          return Stream.concat(
            Stream.make(snapshot.snapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((update) => update.seq > snapshot.seq),
              Stream.map((update) => update.snapshot),
            ),
          );
        }),
      );
    },
    refresh,
    dismiss,
    drain: worker.drain,
    tickOnce: enqueueAndDrain({ kind: "tick" }),
  } satisfies HomeSuggestionsService["Service"];
});

export const layer = Layer.effect(HomeSuggestionsService, make);
