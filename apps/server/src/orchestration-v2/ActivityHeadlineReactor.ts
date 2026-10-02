/** Live generated headlines and plan progress from V2 turn items. Generation is
 * coalesced and throttled; updates are guarded by the current run before commit. */
import {
  CommandId,
  RunId,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { ProjectStoreV2 } from "./ProjectStore.ts";

/** A busy run generates at most one headline per interval per thread. */
export const HEADLINE_MIN_INTERVAL_MS = 3_000;
export interface HeadlineJob {
  readonly turnId: RunId;
  readonly summary: string;
  readonly command: string | undefined;
  readonly detail: string | undefined;
}

export function headlineJobForTurnItem(item: OrchestrationV2TurnItem): HeadlineJob | null {
  if (item.runId === null || !["command_execution", "file_change", "file_search", "tool_call", "subagent_task", "error"].includes(item.type)) return null;
  if (item.status === "cancelled" || item.status === "pending") return null;
  return {
    turnId: item.runId,
    summary: item.title ?? (item.type === "file_change" ? `Editing ${item.fileName}` : item.type.replaceAll("_", " ")),
    command: item.type === "command_execution" ? item.input : undefined,
    detail: item.type === "error" ? item.failure.message : undefined,
  };
}

export function progressForTodoList(item: Extract<OrchestrationV2TurnItem, { type: "todo_list" }>) {
  const current = item.steps.find(step => step.status === "running") ?? item.steps.find(step => step.status === "pending");
  return { step: current?.text ?? "", completedSteps: item.steps.filter(step => step.status === "completed").length, totalSteps: item.steps.length };
}

export class ActivityHeadlineReactor extends Context.Service<
  ActivityHeadlineReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/ActivityHeadlineReactor") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const projection = yield* ThreadManagementService;
  const projects = yield* ProjectStoreV2;
  const textGeneration = yield* TextGeneration;

  const crypto = yield* Crypto.Crypto;

  // ponytail: cleared wholesale past the cap instead of per-thread LRU;
  // losing throttle state only costs one extra generation per active thread.
  const LAST_RUN_MAX_THREADS = 512;
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
        .getThreadShell(threadId)
        .pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (threadOption === null) {
        return null;
      }
      const thread = threadOption;
      if (thread.status !== "running" || thread.latestRunId !== String(job.turnId)) {
        return null;
      }
      return thread;
    });

    const thread = yield* resolveRunningThread;
    if (!thread) {
      lastRunByThread.delete(threadId);
      return;
    }
    const projectOption = yield* projects
      .getShell(thread.projectId)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: Option.isSome(projectOption) ? [projectOption.value] : [],
      }) ?? process.cwd();

    if (lastRunByThread.size >= LAST_RUN_MAX_THREADS && !lastRunByThread.has(threadId)) {
      lastRunByThread.clear();
    }
    // Stamp the time now so failing generations stay throttled, but keep the
    // previous dedupe key until this input yields a usable headline — a
    // transient failure must not permanently pin its input as "done".
    lastRunByThread.set(threadId, { atMs: now, inputKey: last?.inputKey ?? "" });
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
    lastRunByThread.set(threadId, { atMs: now, inputKey });

    // The turn may have settled while the model ran; a late headline for a
    // finished turn is never rendered but would still bump the thread.
    if (!(yield* resolveRunningThread)) {
      lastRunByThread.delete(threadId);
      return;
    }

    const commandId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:activity-headline:${uuid}`)),
    );
    yield* projection
      .dispatch({
        type: "thread.metadata.update",
        commandId,
        threadId,
        expectedRunId: RunId.make(String(job.turnId)),
        liveHeadline: generated.headline,
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
      Stream.runForEach(projection.streamDomainEvents, (event) => {
        if (event.type !== "turn-item.updated") return Effect.void;
        const item = event.payload;
        if (item.type === "todo_list" && item.runId !== null) {
          return crypto.randomUUIDv4.pipe(Effect.orDie, Effect.flatMap((id) => projection.dispatch({ type: "thread.metadata.update", commandId: CommandId.make(`server:plan-progress:${id}`), threadId: event.threadId, expectedRunId: item.runId!, planProgress: progressForTodoList(item) })), Effect.ignore);
        }
        const job = headlineJobForTurnItem(item);
        return job === null ? Effect.void : worker.enqueue(event.threadId, job);
      }),
    );
  });

  return ActivityHeadlineReactor.of({ start });
});

export const layer = Layer.effect(ActivityHeadlineReactor, make);
