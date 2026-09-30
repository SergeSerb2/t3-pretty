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
 * Environments linked to one Connect account share the batch through the
 * relay (`HomeSuggestionsMesh`). The tick polls the shared batch, uploads this
 * environment's digest, and at the due time asks the relay for the day's
 * lease instead of generating on its own. Only the lease holder calls the
 * model, from every environment's digest, and publishes; the others adopt it.
 * An unlinked or unreachable relay leaves the environment generating alone.
 *
 * One drainable worker runs the tick, the generation, and relay dismissals,
 * so tests wait on `drain` instead of sleeping.
 *
 * @module HomeSuggestionsService
 */
import {
  DEFAULT_SERVER_SETTINGS,
  EMPTY_HOME_SUGGESTIONS_SNAPSHOT,
  HOME_SUGGESTIONS_EXPLORE_COUNT,
  HOME_SUGGESTIONS_PROJECT_COUNT,
  HomeSuggestion,
  HomeSuggestionsDigest,
  HomeSuggestionsError,
  type HomeSuggestionId,
  type HomeSuggestionsSnapshot,
  type ServerSettings,
} from "@t3tools/contracts";
import type {
  RelayHomeSuggestionsBatch,
  RelayHomeSuggestionsClaim,
} from "@t3tools/contracts/relay";
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
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import {
  buildEnvironmentDigest,
  buildHomeSuggestionsDigest,
  mapGeneratedSuggestions,
  nextHomeSuggestionsRunAt,
  rememberTitles,
  selectDigestThreads,
  type DigestThread,
} from "./HomeSuggestionsContext.ts";
import { HomeSuggestionsMesh } from "./HomeSuggestionsMesh.ts";

export const HOME_SUGGESTIONS_TICK_INTERVAL = Duration.minutes(1);
export const HOME_SUGGESTIONS_FILE_NAME = "home-suggestions.json";
/** How often a linked environment checks the shared batch between due times. */
export const HOME_SUGGESTIONS_MESH_POLL_INTERVAL = Duration.minutes(10);
/** A changed digest is uploaded at most this often. */
export const HOME_SUGGESTIONS_DIGEST_UPLOAD_INTERVAL = Duration.hours(1);
/** An unchanged digest is re-sent this often so the relay still counts the machine as active. */
const HOME_SUGGESTIONS_DIGEST_KEEPALIVE = Duration.hours(12);

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
const encodeDigest = Schema.encodeEffect(Schema.fromJsonString(HomeSuggestionsDigest));

const EMPTY_STORED_STATE: StoredState = {
  generatedAt: null,
  lastAttemptAt: null,
  lastError: null,
  suggestions: [],
  previousTitles: [],
};

/** A fresh install whose first batch failed retries this often, not tomorrow. */
export const HOME_SUGGESTIONS_FIRST_BATCH_RETRY = Duration.hours(1);

type Job =
  | { readonly kind: "tick" }
  | { readonly kind: "generate"; readonly reason: string }
  | { readonly kind: "dismiss"; readonly suggestionId: HomeSuggestionId };

interface MeshState {
  readonly lastPollMs: number;
  readonly lastDigestCheckMs: number;
  readonly lastUploadMs: number;
  readonly lastUploadedDigest: string | null;
  /** Other environments' digests from a granted lease, read by the next generation. */
  readonly grantedDigests: ReadonlyArray<HomeSuggestionsDigest> | null;
}

const INITIAL_MESH_STATE: MeshState = {
  lastPollMs: Number.NEGATIVE_INFINITY,
  lastDigestCheckMs: Number.NEGATIVE_INFINITY,
  lastUploadMs: Number.NEGATIVE_INFINITY,
  lastUploadedDigest: null,
  grantedDigests: null,
};

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
  const mesh = yield* HomeSuggestionsMesh;
  const serverEnvironment = yield* ServerEnvironment;

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
  const meshState = yield* Ref.make<MeshState>(INITIAL_MESH_STATE);

  const publish = (update: (snapshot: HomeSuggestionsSnapshot) => HomeSuggestionsSnapshot) =>
    Ref.modify(published, (previous): readonly [Published, Published] => {
      const snapshot = { ...update(previous.snapshot), timeZone };
      const next = { seq: previous.seq + 1, snapshot };
      return [next, next];
    }).pipe(Effect.tap((next) => PubSub.publish(changes, next)));

  // Never attempted and never succeeded: due right away, so a fresh
  // install fills in on first start. A file that already has a batch
  // but dropped lastAttemptAt (older shape, partial write) is not a
  // first start — schedule from generatedAt. Never succeeded: retry an
  // hour after the last attempt rather than waiting for tomorrow's slot.
  // Otherwise the first slot after the last attempt, which is in the
  // past after a long sleep and therefore runs once on the next tick.
  const nextRunAtFor = (current: ServerSettings, state: StoredState, nowMs: number) => {
    if (!current.homeSuggestionsEnabled) return null;
    if (state.lastAttemptAt === null && state.generatedAt === null) return nowMs;
    const lastAttemptMs = Date.parse(state.lastAttemptAt ?? state.generatedAt ?? "");
    if (!Number.isFinite(lastAttemptMs)) return null;
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

  // Dismiss runs on the RPC fiber while generation runs on the worker. Hold
  // the permit across the Ref update and the atomic write so a generate
  // cannot persist a pre-dismiss snapshot after dismiss already wrote.
  const persistLock = yield* Semaphore.make(1);

  const persist = (state: StoredState) =>
    encodeStoredState(state).pipe(
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

  const persistUpdate = (update: (previous: StoredState) => StoredState) =>
    persistLock.withPermits(1)(Ref.updateAndGet(stored, update).pipe(Effect.tap(persist)));

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

  const readOwnDigest = Effect.fn("HomeSuggestionsService.readOwnDigest")(function* () {
    const { projects, threads } = yield* readDigestThreads();
    const descriptor = yield* serverEnvironment.getDescriptor;
    const digest = buildEnvironmentDigest({
      environmentId: descriptor.environmentId,
      environmentLabel: descriptor.label,
      projects,
      threads,
    });
    return { projects, digest };
  });

  // A shared batch replaces the local one when it is newer, or when it is the
  // same batch with different cards (a dismissal on another machine). A local
  // batch newer than the shared one (generated while the relay was down)
  // stays until the mesh publishes again.
  const adopt = (batch: RelayHomeSuggestionsBatch | null) =>
    Effect.gen(function* () {
      if (batch === null) return;
      const state = yield* Ref.get(stored);
      const sharedMs = Date.parse(batch.generatedAt);
      const localMs = Date.parse(state.generatedAt ?? "");
      const sameCards =
        batch.suggestions.length === state.suggestions.length &&
        batch.suggestions.every((card, index) => card.id === state.suggestions[index]?.id);
      if (Number.isFinite(localMs) && (sharedMs < localMs || (sharedMs === localMs && sameCards))) {
        return;
      }
      const current = yield* settings;
      const nowMs = yield* Clock.currentTimeMillis;
      const next = yield* persistUpdate((previous) => ({
        ...previous,
        generatedAt: batch.generatedAt,
        lastError: null,
        suggestions: batch.suggestions,
        previousTitles: batch.previousTitles,
      }));
      yield* publish((snapshot) => ({
        ...snapshot,
        // A generation running here will publish its own result.
        status: snapshot.status === "generating" ? "generating" : "ready",
        generatedAt: next.generatedAt,
        nextRunAt: isoOrNull(nextRunAtFor(current, next, nowMs)),
        error: null,
        suggestions: next.suggestions,
      }));
      yield* Effect.logInfo("home suggestions adopted the shared batch", {
        generatedBy: batch.generatedByEnvironmentId,
        count: batch.suggestions.length,
      });
    });

  // Hourly at most, and only when it changed (or the relay copy is going
  // stale), because building it reads every recent thread.
  const digestToUpload = (nowMs: number) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(meshState);
      if (
        nowMs - state.lastDigestCheckMs <
        Duration.toMillis(HOME_SUGGESTIONS_DIGEST_UPLOAD_INTERVAL)
      ) {
        return null;
      }
      yield* Ref.update(meshState, (previous) => ({ ...previous, lastDigestCheckMs: nowMs }));
      const { digest } = yield* readOwnDigest();
      const encoded = yield* encodeDigest(digest);
      const keepalive =
        nowMs - state.lastUploadMs >= Duration.toMillis(HOME_SUGGESTIONS_DIGEST_KEEPALIVE);
      return encoded !== state.lastUploadedDigest || keepalive ? { digest, encoded } : null;
    });

  /** Uploads the digest when due, claims when asked, and adopts the shared batch. */
  const meshSync = (claim: RelayHomeSuggestionsClaim | null) =>
    Effect.gen(function* () {
      if (!(yield* mesh.linked)) return Option.none();
      const nowMs = yield* Clock.currentTimeMillis;
      // Counted before the call, so an unreachable relay (or one without this
      // endpoint yet) is retried at the poll interval, not every tick.
      yield* Ref.update(meshState, (previous) => ({ ...previous, lastPollMs: nowMs }));
      const upload = yield* digestToUpload(nowMs).pipe(Effect.orElseSucceed(() => null));
      const response = yield* mesh.sync({
        digest: upload?.digest ?? null,
        claim,
        dismissedSuggestionIds: [],
      });
      if (Option.isNone(response)) return response;
      yield* Ref.update(meshState, (previous) => ({
        ...previous,
        ...(upload === null ? {} : { lastUploadMs: nowMs, lastUploadedDigest: upload.encoded }),
        ...(response.value.lease === "granted" ? { grantedDigests: response.value.digests } : {}),
      }));
      yield* adopt(response.value.batch);
      return response;
    });

  const generate = Effect.fn("HomeSuggestionsService.generate")(function* (reason: string) {
    const current = yield* settings;
    const nowMs = yield* Clock.currentTimeMillis;
    yield* publish((snapshot) => ({ ...snapshot, status: "generating", error: null }));
    yield* Effect.logInfo("home suggestions generating", { reason });

    // Set when the relay granted this environment the mesh's lease: the
    // batch covers every linked machine and is published back for them.
    const grantedDigests = yield* Ref.modify(meshState, (state) => [
      state.grantedDigests,
      { ...state, grantedDigests: null },
    ]);

    // `exit`, not `result`: a defect (a failing id generator, a projection
    // bug) must still land on `failed`, or the status stays `generating` and
    // every later tick and refresh refuses to enqueue.
    const exit = yield* Effect.gen(function* () {
      const { projects, digest: own } = yield* readOwnDigest();
      // No projects is not a batch. Leave generatedAt/lastAttemptAt alone so
      // the first real workspace still gets the first-start slot.
      if (projects.length === 0) {
        return { kind: "empty" as const };
      }
      const digests = [
        own,
        ...(grantedDigests ?? []).filter((digest) => digest.environmentId !== own.environmentId),
      ];
      const digest = buildHomeSuggestionsDigest({ digests, nowMs, timeZone });
      const state = yield* Ref.get(stored);
      const generated = yield* textGeneration.generateHomeSuggestions({
        // Providers bind a run to its cwd; use this environment's most
        // recently active project rather than whatever the snapshot lists first.
        cwd:
          projects.find((project) => project.id === own.projects[0]?.id)?.workspaceRoot ??
          process.cwd(),
        context: digest.context,
        projectCount: HOME_SUGGESTIONS_PROJECT_COUNT,
        exploreCount: HOME_SUGGESTIONS_EXPLORE_COUNT,
        previousTitles: state.previousTitles,
        modelSelection: current.homeSuggestionsModelSelection,
      });
      const batchId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      const suggestions = mapGeneratedSuggestions({
        generated: generated.suggestions,
        projectsByKey: digest.projectsByKey,
        makeId: (index) => `${batchId}:${index}`,
      });
      if (grantedDigests === null) {
        return { kind: "batch" as const, suggestions, sharedAt: null };
      }
      // The relay stamps the shared batch; if it is unreachable or another
      // machine took over, this batch still stands here.
      const shared = yield* mesh.publish({
        suggestions,
        previousTitles: rememberTitles(state.previousTitles, suggestions),
      });
      const batch = Option.getOrNull(shared);
      return {
        kind: "batch" as const,
        suggestions: batch?.suggestions ?? suggestions,
        sharedAt: batch?.generatedAt ?? null,
      };
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
      const state = yield* persistUpdate((previous) => ({
        ...previous,
        lastAttemptAt: attemptedAt,
        lastError: error,
      }));
      yield* publish((snapshot) => ({
        ...snapshot,
        status: "failed",
        error,
        nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
      }));
      return;
    }
    if (exit.value.kind === "empty") {
      const state = yield* Ref.get(stored);
      yield* publish((snapshot) => ({
        ...snapshot,
        status: statusOf(state),
        error: state.lastError,
        nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
        suggestions: state.suggestions,
      }));
      return;
    }
    const { suggestions, sharedAt } = exit.value;
    const generatedAt = sharedAt ?? attemptedAt;
    const state = yield* persistUpdate((previous) => ({
      generatedAt,
      lastAttemptAt: attemptedAt,
      lastError: null,
      suggestions,
      previousTitles: rememberTitles(previous.previousTitles, suggestions),
    }));
    yield* publish(() => ({
      status: "ready",
      generatedAt,
      nextRunAt: isoOrNull(nextRunAtFor(current, state, nowMs)),
      timeZone,
      error: null,
      suggestions,
    }));
    yield* Effect.logInfo("home suggestions generated", {
      reason,
      count: suggestions.length,
      environments: grantedDigests === null ? 1 : grantedDigests.length + 1,
      shared: sharedAt !== null,
    });
  });

  const dismissShared = (suggestionId: HomeSuggestionId) =>
    Effect.gen(function* () {
      if (!(yield* mesh.linked)) return;
      const response = yield* mesh.sync({
        digest: null,
        claim: null,
        dismissedSuggestionIds: [suggestionId],
      });
      if (Option.isSome(response)) yield* adopt(response.value.batch);
    });

  const runJob = (job: Job) => {
    switch (job.kind) {
      case "tick":
        return tick();
      case "generate":
        return generate(job.reason);
      case "dismiss":
        return dismissShared(job.suggestionId);
    }
  };

  const processJob = (job: Job): Effect.Effect<void> =>
    runJob(job).pipe(
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

  // One `Ref.modify` decides who claims the run: a tick and a refresh that
  // race each other cannot both see "not generating" and enqueue two batches.
  const claimGenerate = (reason: string) =>
    Effect.gen(function* () {
      const [claimed, next] = yield* Ref.modify(
        published,
        (previous): readonly [readonly [boolean, Published], Published] => {
          if (previous.snapshot.status === "generating") return [[false, previous], previous];
          const generating = {
            seq: previous.seq + 1,
            snapshot: {
              ...previous.snapshot,
              status: "generating" as const,
              error: null,
              timeZone,
            },
          };
          return [[true, generating], generating];
        },
      );
      if (!claimed) return next.snapshot;
      yield* PubSub.publish(changes, next);
      yield* worker.enqueue({ kind: "generate", reason });
      return next.snapshot;
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
    if (dueAt === null) return;
    const due = dueAt <= nowMs;
    const pollDue =
      nowMs - (yield* Ref.get(meshState)).lastPollMs >=
      Duration.toMillis(HOME_SUGGESTIONS_MESH_POLL_INTERVAL);
    if (!due && !(pollDue && (yield* mesh.linked))) return;
    if (yield* hostSuspended) return;
    const shell = yield* projection
      .getShellSnapshot()
      .pipe(Effect.orElseSucceed(() => ({ projects: [] as const })));
    // Only an environment with projects claims the day's lease; one with
    // none still follows the shared batch.
    const claim = due && shell.projects.length > 0 ? "scheduled" : null;
    const shared = yield* meshSync(claim);
    if (claim === null) return;
    if (Option.isSome(shared)) {
      const { lease } = shared.value;
      // Another machine is generating: its batch arrives on a later poll.
      if (lease === "held") return;
      if (lease === "none") {
        // Today's shared batch is already adopted. Record the attempt so this
        // slot is spent instead of asking the relay every minute.
        const state = yield* persistUpdate((previous) => ({
          ...previous,
          lastAttemptAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
        }));
        const nextShared = isoOrNull(nextRunAtFor(current, state, nowMs));
        yield* publish((previous) => ({ ...previous, nextRunAt: nextShared }));
        return;
      }
    }
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
      timeZone,
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
    if (yield* mesh.linked) {
      const shared = yield* mesh.sync({
        digest: null,
        claim: "manual",
        dismissedSuggestionIds: [],
      });
      if (Option.isSome(shared)) {
        if (shared.value.lease === "held") {
          return yield* new HomeSuggestionsError({
            detail:
              "Another connected machine is generating suggestions now. They will appear here when it finishes.",
          });
        }
        const digests = shared.value.digests;
        yield* Ref.update(meshState, (previous) => ({ ...previous, grantedDigests: digests }));
      }
    }
    return yield* claimGenerate("manual");
  });

  const dismiss: HomeSuggestionsService["Service"]["dismiss"] = (suggestionId) =>
    Effect.gen(function* () {
      const state = yield* persistUpdate((previous) => ({
        ...previous,
        suggestions: previous.suggestions.filter((card) => card.id !== suggestionId),
      }));
      const next = yield* publish((previous) => ({
        ...previous,
        suggestions: state.suggestions,
      }));
      yield* worker.enqueue({ kind: "dismiss", suggestionId });
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
