/**
 * AutomationScheduler - runs automations. Every decision is derived from the
 * projected automation rows (`nextRunAt`, `activeRun`, `pendingTrigger`,
 * `lastRequestedAt`): there are no scheduler tables and no per-run timers,
 * so a restart loses nothing except the in-memory git baselines.
 *
 * One drainable worker processes every job sequentially: the 30 s tick (due
 * schedules, stale requests, timeouts, settled-thread sweep, pending
 * triggers), the run executor, the completion tracker, in-app event and git
 * trigger sources, retention, and the delete cascade. Tests drive it with
 * `tickOnce` / `pollGitOnce` and `drain`; nothing here sleeps to synchronise.
 */
import {
  AUTOMATION_KEEP_RUN_THREADS,
  AUTOMATION_RUN_SUMMARY_MAX_CHARS,
  AutomationRunId,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type AutomationEventName,
  type AutomationId,
  type AutomationRun,
  type AutomationShell,
  type IsoDateTime,
  type ModelSelection,
  type AutomationCommand,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2Run,
  type ProjectId,
  type ServerSettings,
  type RunId,
} from "@t3tools/contracts";
import { applyAutomationRunSuffix } from "@t3tools/shared/automationRunPrompt";
import { applyCreatePullRequestSuffix } from "@t3tools/shared/createPullRequestPrompt";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as AutomationStore from "./AutomationStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import { resolveAutomationRunCompletion } from "./automationRunCompletion.ts";
import { automationRunBranchName, automationRunTitle } from "./automationRunTitle.ts";

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
    /** One tick, drained. Tests only. */
    readonly tickOnce: Effect.Effect<void>;
    /** One git poll, drained. Tests only. */
    readonly pollGitOnce: Effect.Effect<void>;
  }
>()("t3/automations/AutomationScheduler") {}

const AUTOMATION_TICK_INTERVAL = Duration.seconds(30);
/** A schedule instant older than this counts as missed (catch-up or `run.missed`). */
const AUTOMATION_LATE_THRESHOLD_MILLIS = 90_000;
/** A requested run without a thread after this long failed to start. */
const AUTOMATION_STALE_REQUEST_MILLIS = 2 * 60_000;
const GIT_TIMEOUT = Duration.seconds(30);
const ORIGIN = "origin";

type Job =
  | { readonly kind: "tick" }
  | { readonly kind: "execute"; readonly run: AutomationRun }
  | {
      readonly kind: "thread";
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly status: OrchestrationV2Run["status"];
    }
  | { readonly kind: "finished"; readonly automationId: AutomationId }
  | { readonly kind: "deleted"; readonly automationId: AutomationId }
  | { readonly kind: "merged"; readonly merge: PullRequestService.PullRequestMergeEvent }
  | { readonly kind: "git-poll" };

type RunRequestTrigger = Extract<AutomationCommand, { type: "automation.run.request" }>["trigger"];

function fallbackModelSelection(settings: ServerSettings): ModelSelection {
  const enabled = Object.entries(settings.providers).find(([, provider]) => provider.enabled);
  const driver = ProviderDriverKind.make(enabled?.[0] ?? "codex");
  return {
    instanceId: ProviderInstanceId.make(driver),
    model: DEFAULT_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL,
  };
}

function scheduleTimezone(automation: AutomationShell): string | null {
  for (const trigger of automation.triggers) {
    if (trigger.type === "schedule") return trigger.timezone;
  }
  return null;
}

function describeCause(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);
  return failure instanceof Error ? failure.message : String(failure);
}

const gitRunTriggerBranch = (automation: AutomationShell) =>
  automation.triggers.flatMap((trigger) => (trigger.type === "git" ? [trigger.branch] : []));

/**
 * A parked trigger is re-dispatched only when the decider would accept it:
 * nothing else clears `pendingTrigger`, so dispatching while paused or
 * debounced would just produce a rejected receipt every tick.
 */
const readyPendingTrigger = (
  automation: AutomationShell,
  schedulesEnabled: boolean,
  nowMs: number,
) =>
  schedulesEnabled &&
  automation.enabled &&
  automation.activeRun === null &&
  (automation.lastRequestedAt === null ||
    Date.parse(automation.lastRequestedAt) + automation.minIntervalSeconds * 1000 <= nowMs)
    ? automation.pendingTrigger
    : null;

const make = Effect.gen(function* () {
  const store = yield* AutomationStore.AutomationStore;
  const threadService = yield* ThreadManagement.ThreadManagementService;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const settingsService = yield* ServerSettingsService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const crypto = yield* Crypto.Crypto;

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const settings = settingsService.getSettings.pipe(
    Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
  );
  const hostSuspended = backgroundPolicy.snapshot.pipe(
    Effect.map((snapshot) => snapshot.hostPower.suspended),
  );

  // Remember non-automation runs observed in progress so only their transition
  // to a terminal state triggers other automations. Lost on restart.
  const runningTurnByThread = new Map<ThreadId, RunId>();
  // Last remote commit per `${workspaceRoot} ${branch}`. First observation
  // baselines silently; pushes during downtime are not observed.
  const lastSeenCommit = new Map<string, string>();

  /** Rejections are the decider saying "already handled"; they are expected and only logged. */
  const dispatchQuietly = (command: AutomationCommand) =>
    store.dispatch(command).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        error.cause === undefined
          ? Effect.logDebug("automation command rejected", {
              commandType: command.type,
              detail: error.detail,
            })
          : Effect.logWarning("automation command failed", {
              commandType: command.type,
              cause: error,
            }),
      ),
    );

  const finishRun = Effect.fn("AutomationScheduler.finishRun")(function* (input: {
    readonly automationId: AutomationId;
    readonly runId: AutomationRunId;
    readonly status: "completed" | "failed" | "interrupted";
    readonly error: string | null;
    readonly summary?: string | null;
  }) {
    yield* dispatchQuietly({
      type: "automation.run.finished",
      commandId: CommandId.make(`server:automation-run-finished:${input.runId}`),
      automationId: input.automationId,
      runId: input.runId,
      status: input.status,
      finishedAt: yield* nowIso,
      error: input.error,
      summary: input.summary ?? null,
    });
  });

  const requestRun = Effect.fn("AutomationScheduler.requestRun")(function* (
    automationId: AutomationId,
    trigger: RunRequestTrigger,
    tag: string,
  ) {
    yield* dispatchQuietly({
      type: "automation.run.request",
      commandId: CommandId.make(`server:automation-${tag}:${yield* uuid}`),
      automationId,
      runId: AutomationRunId.make(yield* uuid),
      trigger,
      requestedAt: yield* nowIso,
    });
  });

  /** Final assistant message of the settled turn, trimmed for the run row. */
  const readRunSummary = Effect.fn("AutomationScheduler.readRunSummary")(function* (
    thread: OrchestrationV2ThreadShell,
  ) {
    const turnId = thread.latestRunId;
    if (turnId === null) return null;
    const detail = yield* threadService
      .getThreadProjection(thread.id)
      .pipe(Effect.orElseSucceed(() => null));
    if (detail === null) return null;
    const text = detail.messages.findLast(
      (message) => message.role === "assistant" && message.runId === turnId,
    )?.text;
    const trimmed = text?.trim() ?? "";
    return trimmed.length === 0 ? null : trimmed.slice(0, AUTOMATION_RUN_SUMMARY_MAX_CHARS);
  });

  /** Applies the completion rule to an active run's thread and reports the outcome. */
  const completeFromThread = Effect.fn("AutomationScheduler.completeFromThread")(function* (
    automation: AutomationShell,
    thread: OrchestrationV2ThreadShell,
  ) {
    const active = automation.activeRun;
    if (active === null || active.threadId !== thread.id) return;
    const completion = resolveAutomationRunCompletion(thread);
    if (completion === null) return;
    yield* finishRun({
      automationId: automation.id,
      runId: active.runId,
      ...completion,
      summary: yield* readRunSummary(thread),
    });
  });

  /** Existing run threads of one automation, newest first. */
  const listRunThreads = Effect.fn("AutomationScheduler.listRunThreads")(function* (
    automationId: AutomationId,
  ) {
    const active = yield* threadService.getShellSnapshot({ location: "active" });
    const archive = yield* threadService.getShellSnapshot({ location: "archive" });
    const threads = [...active.threads, ...archive.archivedThreads]
      .filter((thread) => thread.automationRun?.automationId === automationId)
      .toSorted(
        (left, right) =>
          DateTime.toEpochMillis(right.createdAt) - DateTime.toEpochMillis(left.createdAt),
      );
    const projectMap = new Map(
      (yield* projects.listShells()).map((project) => [project.id, project]),
    );
    return { threads, projects: projectMap };
  });

  const removeWorktree = (workspaceRoot: string, worktreePath: string | null) =>
    worktreePath === null
      ? Effect.void
      : git.removeWorktree({ cwd: workspaceRoot, path: worktreePath, force: true }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("automation run worktree removal failed", {
              worktreePath,
              cause: error,
            }),
          ),
        );

  const deleteRunThread = Effect.fn("AutomationScheduler.deleteRunThread")(function* (
    thread: Pick<OrchestrationV2ThreadShell, "id" | "worktreePath">,
    workspaceRoot: string | undefined,
  ) {
    if (workspaceRoot !== undefined) yield* removeWorktree(workspaceRoot, thread.worktreePath);
    yield* threadService
      .dispatch({
        type: "thread.delete",
        commandId: CommandId.make(`server:automation-thread-delete:${yield* uuid}`),
        threadId: thread.id,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("automation run thread deletion failed", { cause }),
        ),
      );
  });

  const interruptThread = Effect.fn("AutomationScheduler.interruptThread")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* threadService.getThreadShell(threadId);
    if (thread === null) return;
    yield* threadService
      .interruptThread({
        projectId: thread.projectId,
        commandId: CommandId.make(`server:automation-interrupt:${yield* uuid}`),
        threadId,
      })
      .pipe(
        Effect.catch((cause) => Effect.logWarning("automation run interruption failed", { cause })),
      );
  });

  // ---------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------

  const tickAutomation = Effect.fn("AutomationScheduler.tickAutomation")(function* (
    automation: AutomationShell,
    schedulesEnabled: boolean,
  ) {
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const at = DateTime.formatIso(now);

    if (
      schedulesEnabled &&
      automation.enabled &&
      automation.nextRunAt !== null &&
      Date.parse(automation.nextRunAt) <= nowMs
    ) {
      const late = nowMs - Date.parse(automation.nextRunAt) > AUTOMATION_LATE_THRESHOLD_MILLIS;
      if (late && !automation.catchUpMissedRuns) {
        yield* dispatchQuietly({
          type: "automation.run.missed",
          commandId: CommandId.make(
            `server:automation-missed:${automation.id}:${automation.nextRunAt}`,
          ),
          automationId: automation.id,
          runId: AutomationRunId.make(yield* uuid),
          scheduledFor: automation.nextRunAt,
          at,
        });
      } else {
        yield* dispatchQuietly({
          type: "automation.run.request",
          commandId: CommandId.make(
            `server:automation-schedule:${automation.id}:${automation.nextRunAt}`,
          ),
          automationId: automation.id,
          runId: AutomationRunId.make(yield* uuid),
          trigger: { type: "schedule", scheduledFor: automation.nextRunAt, catchUp: late },
          requestedAt: at,
        });
      }
    }

    const active = automation.activeRun;
    if (active === null) {
      const pending = readyPendingTrigger(automation, schedulesEnabled, nowMs);
      if (pending !== null) yield* requestRun(automation.id, pending, "pending");
      return;
    }
    if (active.threadId === null) {
      if (nowMs - Date.parse(active.requestedAt) > AUTOMATION_STALE_REQUEST_MILLIS) {
        yield* finishRun({
          automationId: automation.id,
          runId: active.runId,
          status: "failed",
          error: "The run never started (server restarted or thread creation failed)",
        });
      }
      return;
    }
    if (
      active.startedAt !== null &&
      Date.parse(active.startedAt) + automation.timeoutMinutes * 60_000 < nowMs
    ) {
      // Finish first so the tracker's later "interrupted" lands on a run that
      // is no longer active and the timeout reason survives.
      yield* finishRun({
        automationId: automation.id,
        runId: active.runId,
        status: "interrupted",
        error: `Timed out after ${automation.timeoutMinutes} minutes`,
      });
      yield* interruptThread(active.threadId);
      return;
    }
    const thread = yield* threadService.getThreadShell(active.threadId);
    if (thread !== null) {
      yield* completeFromThread(automation, thread);
    } else if (Date.parse(active.requestedAt) + AUTOMATION_STALE_REQUEST_MILLIS < nowMs) {
      yield* finishRun({
        automationId: automation.id,
        runId: active.runId,
        status: "failed",
        error: "Run thread disappeared or failed to launch",
      });
    }
  });

  const tick = Effect.fn("AutomationScheduler.tick")(function* () {
    if (yield* hostSuspended) return;
    const schedulesEnabled = (yield* settings).automations.enabled;
    const automations = yield* store.listAutomationShells();
    for (const automation of automations) {
      if (Option.isNone(yield* projects.getShell(automation.projectId))) {
        yield* dispatchQuietly({
          type: "automation.delete",
          commandId: CommandId.make(`server:automation-project-deleted:${automation.id}`),
          automationId: automation.id,
        });
        continue;
      }
      yield* tickAutomation(automation, schedulesEnabled).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("automation tick step failed", {
                automationId: automation.id,
                cause: Cause.pretty(cause),
              }),
        ),
      );
    }
  });

  // ---------------------------------------------------------------------
  // Executor
  // ---------------------------------------------------------------------

  /** Local default branch (`isDefault` ref), else the checked-out branch, else `main`. */
  const resolveDefaultBranch = Effect.fn("AutomationScheduler.resolveDefaultBranch")(function* (
    cwd: string,
  ) {
    const refs = yield* git
      .listRefs({ cwd, refKind: "local" })
      .pipe(Effect.orElseSucceed(() => null));
    const fromRefs = refs?.refs.find((ref) => ref.isDefault && ref.isRemote !== true)?.name;
    if (fromRefs !== undefined) return fromRefs;
    const status = yield* git.localStatus({ cwd }).pipe(Effect.orElseSucceed(() => null));
    return status?.refName ?? "main";
  });

  const execute = Effect.fn("AutomationScheduler.execute")(function* (run: AutomationRun) {
    const automation = Option.getOrNull(yield* store.getAutomationShellById(run.automationId));
    if (
      automation === null ||
      automation.activeRun?.runId !== run.id ||
      automation.activeRun.threadId !== null
    ) {
      yield* Effect.logDebug("automation run no longer executable", { runId: run.id });
      return;
    }
    const project = Option.getOrNull(yield* projects.getShell(automation.projectId));
    if (project === null) {
      yield* finishRun({
        automationId: automation.id,
        runId: run.id,
        status: "failed",
        error: "Project not found",
      });
      return;
    }
    const modelSelection =
      automation.modelSelection ??
      project.defaultModelSelection ??
      fallbackModelSelection(yield* settings);
    const startedAt = yield* nowIso;
    const threadId = ThreadId.make(yield* uuid);

    const text = applyAutomationRunSuffix(
      applyCreatePullRequestSuffix({
        text: automation.prompt,
        autoCreatePullRequest: automation.createPullRequest,
        threadHasStarted: false,
        model: modelSelection.model,
      }),
      {
        automationName: automation.name,
        projectTitle: project.title,
        runId: run.id,
        trigger: run.trigger,
        startedAt,
        previousRunSummary:
          automation.includeLastRunSummary && automation.lastRun?.summary
            ? {
                finishedAt: automation.lastRun.finishedAt ?? automation.lastRun.requestedAt,
                summary: automation.lastRun.summary,
              }
            : null,
      },
    );
    // Record ownership before launch. A crash during workspace/provider preparation
    // is then recovered by the timeout/stale-thread sweep instead of duplicating it.
    yield* store.dispatch({
      type: "automation.run.started",
      commandId: CommandId.make(`server:automation-run-started:${run.id}`),
      automationId: automation.id,
      runId: run.id,
      threadId,
      startedAt,
    });
    const launched = yield* launch
      .launch({
        commandId: CommandId.make(`server:automation-thread-launch:${run.id}`),
        threadId,
        projectId: project.id,
        title: automationRunTitle(
          automation.name,
          DateTime.makeUnsafe(startedAt),
          run.trigger.type === "schedule" ? scheduleTimezone(automation) : null,
        ),
        modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: "default",
        automationRun: { automationId: automation.id, runId: run.id },
        workspaceStrategy:
          automation.workspace === "worktree"
            ? {
                type: "worktree",
                baseRef: yield* resolveDefaultBranch(project.workspaceRoot),
                branch: automationRunBranchName(automation.name, DateTime.makeUnsafe(startedAt)),
                startFromOrigin: true,
              }
            : { type: "root" },
        initialMessage: { messageId: MessageId.make(yield* uuid), text, attachments: [] },
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.exit);
    if (Exit.isFailure(launched)) {
      if (Cause.hasInterruptsOnly(launched.cause)) return yield* Effect.failCause(launched.cause);
      yield* finishRun({
        automationId: automation.id,
        runId: run.id,
        status: "failed",
        error: describeCause(launched.cause),
      });
      const thread = yield* threadService.getThreadShell(threadId);
      if (thread !== null) yield* deleteRunThread(thread, project.workspaceRoot);
    }
  });

  // ---------------------------------------------------------------------
  // Completion tracker + in-app event source
  // ---------------------------------------------------------------------

  const fireEvent = Effect.fn("AutomationScheduler.fireEvent")(function* (
    projectId: ProjectId,
    event: AutomationEventName,
    threadId: ThreadId,
  ) {
    if (!(yield* settings).automations.enabled) return;
    const automations = yield* store.listAutomationShells();
    for (const automation of automations) {
      if (
        automation.projectId !== projectId ||
        !automation.enabled ||
        !automation.triggers.some((trigger) => trigger.type === "event" && trigger.event === event)
      ) {
        continue;
      }
      yield* requestRun(automation.id, { type: "event", event, threadId }, "event");
    }
  });

  const onThread = Effect.fn("AutomationScheduler.onThread")(function* (
    job: Extract<Job, { kind: "thread" }>,
  ) {
    const shell = yield* threadService.getThreadShell(job.threadId);
    if (shell === null) return;
    const marker = shell.automationRun ?? null;
    if (marker !== null) {
      const automation = Option.getOrNull(yield* store.getAutomationShellById(marker.automationId));
      if (automation !== null && automation.activeRun?.threadId === shell.id)
        yield* completeFromThread(automation, shell);
      return;
    }
    // Use the event's run state: the projection may already have advanced to
    // completed by the time this worker reads a very short running turn.
    if (["preparing", "starting", "running", "waiting"].includes(job.status)) {
      runningTurnByThread.set(shell.id, job.runId);
      return;
    }
    if (runningTurnByThread.get(shell.id) !== job.runId) return;
    runningTurnByThread.delete(shell.id);
    if (job.status === "failed" || job.status === "completed") {
      yield* fireEvent(
        shell.projectId,
        job.status === "failed" ? "turn.failed" : "turn.completed",
        shell.id,
      );
    }
  });

  const onMerged = Effect.fn("AutomationScheduler.onMerged")(function* (
    merge: PullRequestService.PullRequestMergeEvent,
  ) {
    const snapshot = yield* threadService.getShellSnapshot();
    const repository = merge.repository.toLowerCase();
    const thread = snapshot.threads.find(
      (candidate) =>
        candidate.linkedPullRequest != null &&
        candidate.linkedPullRequest.projectId === merge.projectId &&
        candidate.linkedPullRequest.number === merge.number &&
        candidate.linkedPullRequest.repository.toLowerCase() === repository,
    );
    // Run threads never fire in-app events, including their own merged PR.
    if (thread === undefined || thread.automationRun != null) return;
    yield* fireEvent(thread.projectId, "pull-request.merged", thread.id);
  });

  // ---------------------------------------------------------------------
  // After a run: pending trigger, retention. Delete cascade.
  // ---------------------------------------------------------------------

  const afterFinished = Effect.fn("AutomationScheduler.afterFinished")(function* (
    automationId: AutomationId,
  ) {
    const automation = Option.getOrNull(yield* store.getAutomationShellById(automationId));
    if (automation === null) return;
    const schedulesEnabled = (yield* settings).automations.enabled;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const pending = readyPendingTrigger(automation, schedulesEnabled, nowMs);
    if (pending !== null) yield* requestRun(automation.id, pending, "pending");
    const { threads, projects } = yield* listRunThreads(automationId);
    const workspaceRoot = projects.get(automation.projectId)?.workspaceRoot;
    const activeThreadId = automation.activeRun?.threadId ?? null;
    for (const thread of threads
      .filter((thread) => thread.id !== activeThreadId)
      .slice(AUTOMATION_KEEP_RUN_THREADS)) {
      yield* deleteRunThread(thread, workspaceRoot);
    }
  });

  const onDeleted = Effect.fn("AutomationScheduler.onDeleted")(function* (
    automationId: AutomationId,
  ) {
    // The row and its run rows are already gone, so the active run cannot be
    // finished through the decider; interrupting and deleting its thread is
    // the whole cascade.
    const { threads, projects } = yield* listRunThreads(automationId);
    for (const thread of threads) {
      if (thread.activeRunId !== null) {
        yield* interruptThread(thread.id);
      }
      yield* deleteRunThread(thread, projects.get(thread.projectId)?.workspaceRoot);
    }
  });

  // ---------------------------------------------------------------------
  // Git source
  // ---------------------------------------------------------------------

  const pollGit = Effect.fn("AutomationScheduler.pollGit")(function* () {
    if (yield* hostSuspended) return;
    if (!(yield* settings).automations.enabled) return;
    const automations = (yield* store.listAutomationShells()).filter(
      (automation) => automation.enabled && gitRunTriggerBranch(automation).length > 0,
    );
    if (automations.length === 0) return;

    const targets = new Map<
      string,
      { readonly cwd: string; readonly branch: string; readonly automations: Array<AutomationId> }
    >();
    for (const automation of automations) {
      const project = Option.getOrNull(yield* projects.getShell(automation.projectId));
      if (project === null) continue;
      const cwd = project.workspaceRoot;
      for (const configured of gitRunTriggerBranch(automation)) {
        const branch = configured ?? (yield* resolveDefaultBranch(cwd));
        const key = `${cwd} ${branch}`;
        const target = targets.get(key) ?? { cwd, branch, automations: [] };
        target.automations.push(automation.id);
        targets.set(key, target);
      }
    }

    for (const [key, target] of targets) {
      const commit = yield* git.fetchRemote({ cwd: target.cwd, remoteName: ORIGIN }).pipe(
        Effect.timeout(GIT_TIMEOUT),
        Effect.andThen(
          git.resolveRemoteTrackingCommit({
            cwd: target.cwd,
            refName: target.branch,
            fallbackRemoteName: ORIGIN,
          }),
        ),
        Effect.map((resolved) => resolved.commitSha),
        Effect.catch((error) =>
          Effect.logWarning("automation git poll failed", { key, cause: error }).pipe(
            Effect.as(null),
          ),
        ),
      );
      if (commit === null) continue;
      const previous = lastSeenCommit.get(key);
      lastSeenCommit.set(key, commit);
      if (previous === undefined || previous === commit) continue;
      for (const automationId of target.automations) {
        yield* requestRun(
          automationId,
          { type: "git", branch: target.branch, fromCommit: previous, toCommit: commit },
          "git",
        );
      }
    }
  });

  // ---------------------------------------------------------------------
  // Worker + roots
  // ---------------------------------------------------------------------

  // One job never takes the worker down: failures and defects are logged,
  // interruption still propagates. The explicit return type keeps each job's
  // error union out of the worker's inferred signature.
  const guardJob = <E>(kind: Job["kind"], effect: Effect.Effect<void, E>): Effect.Effect<void> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("automation scheduler job failed", {
              kind,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  const process = (job: Job): Effect.Effect<void> => {
    switch (job.kind) {
      case "tick":
        return guardJob(job.kind, tick());
      case "execute":
        return guardJob(job.kind, execute(job.run));
      case "thread":
        return guardJob(job.kind, onThread(job));
      case "finished":
        return guardJob(job.kind, afterFinished(job.automationId));
      case "deleted":
        return guardJob(job.kind, onDeleted(job.automationId));
      case "merged":
        return guardJob(job.kind, onMerged(job.merge));
      case "git-poll":
        return guardJob(job.kind, pollGit());
    }
  };
  const worker = yield* makeDrainableWorker(process);

  const onStoreEvent = (event: AutomationStore.AutomationStoreEvent): Effect.Effect<void> => {
    switch (event.type) {
      case "automation.run-requested":
        return worker.enqueue({ kind: "execute", run: event.run });
      case "automation.run-finished":
        return worker.enqueue({ kind: "finished", automationId: event.automationId });
      case "automation.removed":
        return worker.enqueue({ kind: "deleted", automationId: event.automationId });
      default:
        return Effect.void;
    }
  };

  const enqueueAndDrain = (job: Job) => worker.enqueue(job).pipe(Effect.andThen(worker.drain));

  const start: AutomationScheduler["Service"]["start"] = Effect.fn("AutomationScheduler.start")(
    function* () {
      const merges = yield* pullRequests.subscribeMerges;
      yield* forkParked(Stream.runForEach(store.subscribeChanges, onStoreEvent));
      yield* forkParked(
        Stream.runForEach(threadService.streamDomainEvents, (event) =>
          event.type === "run.created" || event.type === "run.updated"
            ? worker.enqueue({
                kind: "thread",
                threadId: event.payload.threadId,
                runId: event.payload.id,
                status: event.payload.status,
              })
            : Effect.void,
        ).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("automation thread event subscription failed", { cause }),
          ),
        ),
      );
      yield* forkParked(
        Stream.runForEach(merges, (merge) => worker.enqueue({ kind: "merged", merge })),
      );
      yield* forkParked(
        enqueueAndDrain({ kind: "tick" }).pipe(
          Effect.repeat(Schedule.spaced(AUTOMATION_TICK_INTERVAL)),
          Effect.asVoid,
        ),
      );
      // The poll interval is re-read from settings each round so an edit takes
      // effect without restarting the fiber.
      yield* forkParked(
        Effect.forever(
          enqueueAndDrain({ kind: "git-poll" }).pipe(
            Effect.andThen(settings),
            Effect.flatMap((current) =>
              Effect.sleep(Duration.seconds(current.automations.gitPollIntervalSeconds)),
            ),
          ),
        ),
      );
      yield* Effect.logInfo("automation scheduler started");
    },
  );

  return {
    start,
    drain: worker.drain,
    tickOnce: enqueueAndDrain({ kind: "tick" }),
    pollGitOnce: enqueueAndDrain({ kind: "git-poll" }),
  } satisfies AutomationScheduler["Service"];
});

export const layer = Layer.effect(AutomationScheduler, make);
