/**
 * ActivityHeadlineReactor - live status headlines for running turns.
 *
 * Raw activity summaries are provider-shaped: full commands, truncated error
 * text, tool payload titles. While a turn runs, this reactor asks the text
 * generation model (the same selection thread titles use) for a short
 * human-readable headline of the latest tool activity and republishes it as a
 * `turn.headline` activity with a stable per-turn id, so the projector
 * replaces the row in place and clients swap the live label without growing
 * the log. Work is coalesced per thread (only the latest activity is
 * summarized) and throttled, so a busy turn costs at most one generation per
 * interval.
 *
 * @module ActivityHeadlineReactor
 */
import {
  CommandId,
  EventId,
  type OrchestrationThreadActivity,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

export const HEADLINE_ACTIVITY_KIND = "turn.headline";

/** A busy turn generates at most one headline per interval per thread. */
export const HEADLINE_MIN_INTERVAL_MS = 3_000;

/** Stable per-turn id: every generation replaces the previous headline row. */
export function headlineActivityId(turnId: TurnId): EventId {
  return EventId.make(`${turnId}:headline`);
}

interface HeadlineJob {
  readonly turnId: TurnId;
  readonly summary: string;
  readonly command: string | undefined;
  readonly detail: string | undefined;
}

/** Kinds worth narrating: tool lifecycle plus error rows. */
export function activitySeedsHeadline(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind === HEADLINE_ACTIVITY_KIND || activity.turnId === null) {
    return false;
  }
  return activity.kind.startsWith("tool.") || activity.tone === "error";
}

export function headlineJobForActivity(activity: OrchestrationThreadActivity): HeadlineJob | null {
  if (!activitySeedsHeadline(activity) || activity.turnId === null) {
    return null;
  }
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const command = typeof payload?.command === "string" ? payload.command : undefined;
  const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
  return { turnId: activity.turnId, summary: activity.summary, command, detail };
}

export class ActivityHeadlineReactor extends Context.Service<
  ActivityHeadlineReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration/Layers/ActivityHeadlineReactor") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const projection = yield* ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const lastRunByThread = new Map<ThreadId, { atMs: number; inputKey: string }>();

  const processThread = Effect.fn("ActivityHeadlineReactor.processThread")(function* (
    threadId: ThreadId,
    job: HeadlineJob,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("activity headline generation could not read settings", {
          threadId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (!settings?.generateActivityHeadlines) {
      return;
    }

    // ponytail: drop-not-defer throttle — a burst's final tick may stay
    // unsummarized until the next activity lands; fine for a status line.
    const inputKey = `${job.turnId}:${job.summary}:${job.command ?? ""}:${job.detail ?? ""}`;
    const last = lastRunByThread.get(threadId);
    const now = yield* Clock.currentTimeMillis;
    if (last && (last.inputKey === inputKey || now - last.atMs < HEADLINE_MIN_INTERVAL_MS)) {
      return;
    }

    const resolveRunningThread = Effect.gen(function* () {
      const threadOption = yield* projection
        .getThreadShellById(threadId)
        .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
      if (Option.isNone(threadOption)) {
        return null;
      }
      const thread = threadOption.value;
      if (thread.latestTurn?.state !== "running" || thread.latestTurn.turnId !== job.turnId) {
        return null;
      }
      return thread;
    });

    const thread = yield* resolveRunningThread;
    if (!thread) {
      lastRunByThread.delete(threadId);
      return;
    }
    const projectOption = yield* projection
      .getProjectShellById(thread.projectId)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: Option.isSome(projectOption) ? [projectOption.value] : [],
      }) ?? process.cwd();

    lastRunByThread.set(threadId, { atMs: now, inputKey });
    const generated = yield* textGeneration
      .generateActivityHeadline({
        cwd,
        summary: job.summary,
        command: job.command,
        detail: job.detail,
        modelSelection: settings.textGenerationModelSelection,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("activity headline generation failed", {
            threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
    if (!generated || generated.headline.length === 0) {
      return;
    }

    // The turn may have settled while the model ran; a late headline for a
    // finished turn is never rendered but would still bump the thread.
    if (!(yield* resolveRunningThread)) {
      lastRunByThread.delete(threadId);
      return;
    }

    const commandId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:activity-headline:${uuid}`)),
    );
    const createdAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    yield* orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId,
        threadId,
        activity: {
          id: headlineActivityId(job.turnId),
          tone: "info",
          kind: HEADLINE_ACTIVITY_KIND,
          summary: generated.headline,
          payload: {},
          turnId: job.turnId,
          createdAt,
        },
        createdAt,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("activity headline append failed", {
            threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
  });

  const worker = yield* makeKeyedCoalescingWorker({
    merge: (_current: HeadlineJob, next: HeadlineJob): HeadlineJob => next,
    process: (threadId: ThreadId, job: HeadlineJob) =>
      processThread(threadId, job).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("activity headline generation failed", {
            threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
  });

  const start: ActivityHeadlineReactor["Service"]["start"] = Effect.fn(
    "ActivityHeadlineReactor.start",
  )(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.activity-appended") {
          return Effect.void;
        }
        const job = headlineJobForActivity(event.payload.activity);
        if (job === null) {
          return Effect.void;
        }
        return worker.enqueue(event.payload.threadId, job);
      }),
    );
  });

  return ActivityHeadlineReactor.of({ start });
});

export const layer = Layer.effect(ActivityHeadlineReactor, make);
