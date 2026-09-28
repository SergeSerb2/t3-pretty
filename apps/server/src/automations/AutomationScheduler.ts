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
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationSession,
  type OrchestrationThreadShell,
  type ProjectId,
  type ServerSettings,
  type TurnId,
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
import { isOrchestrationCommandRejection } from "../orchestration/Errors.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
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

export const AUTOMATION_TICK_INTERVAL = Duration.seconds(30);
/** A schedule instant older than this counts as missed (catch-up or `run.missed`). */
export const AUTOMATION_LATE_THRESHOLD_MILLIS = 90_000;
/** A requested run without a thread after this long failed to start. */
export const AUTOMATION_STALE_REQUEST_MILLIS = 2 * 60_000;
const GIT_TIMEOUT = Duration.seconds(30);
const ORIGIN = "origin";

type Job =
  | { readonly kind: "tick" }
  | { readonly kind: "execute"; readonly run: AutomationRun }
  | {
      readonly kind: "thread";
      readonly threadId: ThreadId;
      readonly session: OrchestrationSession | null;
      /** Set by `provider.turn.start.failed`: fail the run with this reason. */
      readonly failure: string | null;
    }
  | { readonly kind: "finished"; readonly automationId: AutomationId }
  | { readonly kind: "deleted"; readonly automationId: AutomationId }
  | { readonly kind: "merged"; readonly merge: PullRequestService.PullRequestMergeEvent }
  | { readonly kind: "git-poll" };

type RunRequestTrigger = Extract<
  OrchestrationCommand,
  { type: "automation.run.request" }
>["trigger"];

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

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const settingsService = yield* ServerSettingsService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
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

  // Non-run threads whose turn is running, so a later session-set that leaves
  // `running` is recognised as that turn settling. Lost on restart, which only
  // means turns already running at boot never fire an in-app event.
  const runningTurnByThread = new Map<ThreadId, TurnId>();
  // Last remote commit per `${workspaceRoot} ${branch}`. First observation
  // baselines silently; pushes during downtime are not observed.
  const lastSeenCommit = new Map<string, string>();

  /** Rejections are the decider saying "already handled"; they are expected and only logged. */
  const dispatchQuietly = (command: OrchestrationCommand) =>
    engine.dispatch(command).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        isOrchestrationCommandRejection(error) ||
        error._tag === "OrchestrationCommandPreviouslyRejectedError"
          ? Effect.logDebug("automation command rejected", {
              commandType: command.type,
              detail: error.message,
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
    thread: OrchestrationThreadShell,
  ) {
    const turnId = thread.latestTurn?.turnId;
    if (turnId === undefined) return null;
    const detail = yield* snapshots
      .getThreadDetailById(thread.id, { activityKinds: [] })
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(detail)) return null;
    const text = detail.value.messages.findLast(
      (message) => message.role === "assistant" && message.turnId === turnId,
    )?.text;
    const trimmed = text?.trim() ?? "";
    return trimmed.length === 0 ? null : trimmed.slice(0, AUTOMATION_RUN_SUMMARY_MAX_CHARS);
  });

  /** Applies the completion rule to an active run's thread and reports the outcome. */
  const completeFromThread = Effect.fn("AutomationScheduler.completeFromThread")(function* (
    automation: AutomationShell,
    thread: OrchestrationThreadShell,
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
    const snapshot = yield* snapshots.getShellSnapshot();
    const threads = snapshot.threads
      .filter((thread) => thread.automationRun?.automationId === automationId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    return { threads, projects };
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
    thread: Pick<OrchestrationThreadShell, "id" | "worktreePath">,
    workspaceRoot: string | undefined,
  ) {
    if (workspaceRoot !== undefined) yield* removeWorktree(workspaceRoot, thread.worktreePath);
    yield* dispatchQuietly({
      type: "thread.delete",
      commandId: CommandId.make(`server:automation-thread-delete:${yield* uuid}`),
      threadId: thread.id,
    });
  });

  const interruptThread = Effect.fn("AutomationScheduler.interruptThread")(function* (
    threadId: ThreadId,
  ) {
    yield* dispatchQuietly({
      type: "thread.turn.interrupt",
      commandId: CommandId.make(`server:automation-turn-interrupt:${yield* uuid}`),
      threadId,
      createdAt: yield* nowIso,
    });
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
    const thread = yield* snapshots.getThreadShellById(active.threadId);
    if (Option.isSome(thread)) {
      yield* completeFromThread(automation, thread.value);
    }
  });

  const tick = Effect.fn("AutomationScheduler.tick")(function* () {
    if (yield* hostSuspended) return;
    const schedulesEnabled = (yield* settings).automations.enabled;
    const automations = yield* snapshots.listAutomationShells();
    for (const automation of automations) {
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

  // ponytail: duplicates the thread.create → worktree → setup script →
  // thread.turn.start sequence of ws.ts dispatchBootstrapTurnStart. That
  // closure is bound to a client connection (origin, fences, activities) and
  // extracting it costs more than these 40 lines; fold both together if a
  // third caller appears.
  const prepareAndStartTurn = Effect.fn("AutomationScheduler.prepareAndStartTurn")(function* (
    automation: AutomationShell,
    project: OrchestrationProjectShell,
    run: AutomationRun,
    threadId: ThreadId,
    modelSelection: ModelSelection,
    startedAt: IsoDateTime,
  ) {
    let worktreePath: string | null = null;
    if (automation.workspace === "worktree") {
      const cwd = project.workspaceRoot;
      const baseBranch = yield* resolveDefaultBranch(cwd);
      let baseRef = baseBranch;
      const hasOrigin = yield* git
        .remoteExists({ cwd, remoteName: ORIGIN })
        .pipe(Effect.orElseSucceed(() => false));
      if (hasOrigin) {
        yield* git.fetchRemote({ cwd, remoteName: ORIGIN }).pipe(
          Effect.timeout(GIT_TIMEOUT),
          Effect.catch((error) =>
            Effect.logWarning("automation run fetch failed; starting from local base", {
              cwd,
              cause: error,
            }),
          ),
        );
        const remoteBase = yield* git
          .resolveRemoteTrackingCommit({ cwd, refName: baseBranch, fallbackRemoteName: ORIGIN })
          .pipe(Effect.orElseSucceed(() => null));
        if (remoteBase !== null) baseRef = remoteBase.commitSha;
      }
      const worktree = yield* git.createWorktree({
        cwd,
        refName: baseRef,
        newRefName: automationRunBranchName(automation.name, DateTime.makeUnsafe(startedAt)),
        baseRefName: baseBranch,
        path: null,
      });
      worktreePath = worktree.worktree.path;
      yield* engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make(`server:automation-thread-meta:${run.id}`),
        threadId,
        branch: worktree.worktree.refName,
        worktreePath,
      });
      yield* setupScripts
        .runForThread({ threadId, projectId: project.id, projectCwd: cwd, worktreePath })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("automation run setup script failed", { threadId, cause: error }),
          ),
        );
    }

    const previous = automation.lastRun;
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
          automation.includeLastRunSummary && previous?.summary
            ? { finishedAt: previous.finishedAt ?? previous.requestedAt, summary: previous.summary }
            : null,
      },
    );
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`server:automation-turn-start:${run.id}`),
      threadId,
      message: {
        messageId: MessageId.make(yield* uuid),
        role: "user",
        text,
        attachments: [],
      },
      runtimeMode: automation.runtimeMode,
      interactionMode: "default",
      createdAt: yield* nowIso,
    });
    return worktreePath;
  });

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
    const automation = Option.getOrNull(yield* snapshots.getAutomationShellById(run.automationId));
    if (
      automation === null ||
      automation.activeRun?.runId !== run.id ||
      automation.activeRun.threadId !== null
    ) {
      yield* Effect.logDebug("automation run no longer executable", { runId: run.id });
      return;
    }
    const project = Option.getOrNull(yield* snapshots.getProjectShellById(automation.projectId));
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

    const created = yield* engine
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(`server:automation-thread-create:${run.id}`),
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
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        automationRun: { automationId: automation.id, runId: run.id },
        createdAt: startedAt,
      })
      .pipe(Effect.result);
    if (created._tag === "Failure") {
      yield* finishRun({
        automationId: automation.id,
        runId: run.id,
        status: "failed",
        error: `Thread creation failed: ${created.failure.message}`,
      });
      return;
    }
    // Attribute every later failure to a run that already owns its thread.
    const prepared = yield* engine
      .dispatch({
        type: "automation.run.started",
        commandId: CommandId.make(`server:automation-run-started:${run.id}`),
        automationId: automation.id,
        runId: run.id,
        threadId,
        startedAt,
      })
      .pipe(
        Effect.andThen(
          prepareAndStartTurn(automation, project, run, threadId, modelSelection, startedAt),
        ),
        Effect.exit,
      );
    if (Exit.isFailure(prepared)) {
      if (Cause.hasInterruptsOnly(prepared.cause)) {
        return yield* Effect.failCause(prepared.cause);
      }
      const error = describeCause(prepared.cause);
      yield* Effect.logWarning("automation run failed to start", { runId: run.id, error });
      yield* finishRun({ automationId: automation.id, runId: run.id, status: "failed", error });
      const thread = Option.getOrNull(yield* snapshots.getThreadShellById(threadId));
      yield* deleteRunThread(
        { id: threadId, worktreePath: thread?.worktreePath ?? null },
        project.workspaceRoot,
      );
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
    const automations = yield* snapshots.listAutomationShells();
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
    const shell = Option.getOrNull(yield* snapshots.getThreadShellById(job.threadId));
    if (shell === null) return;
    const marker = shell.automationRun ?? null;
    if (marker !== null) {
      const automation = Option.getOrNull(
        yield* snapshots.getAutomationShellById(marker.automationId),
      );
      if (automation === null || automation.activeRun?.threadId !== shell.id) return;
      if (job.failure !== null) {
        yield* finishRun({
          automationId: automation.id,
          runId: automation.activeRun.runId,
          status: "failed",
          error: job.failure,
        });
        return;
      }
      yield* completeFromThread(automation, shell);
      return;
    }
    const session = job.session;
    if (session === null) return;
    if (session.status === "running" && session.activeTurnId !== null) {
      runningTurnByThread.set(shell.id, session.activeTurnId);
      return;
    }
    if (session.status === "running" || session.status === "starting") return;
    if (!runningTurnByThread.delete(shell.id)) return;
    const event: AutomationEventName | null =
      session.status === "error"
        ? "turn.failed"
        : session.status === "ready" || session.status === "idle"
          ? "turn.completed"
          : null;
    if (event !== null) yield* fireEvent(shell.projectId, event, shell.id);
  });

  const onMerged = Effect.fn("AutomationScheduler.onMerged")(function* (
    merge: PullRequestService.PullRequestMergeEvent,
  ) {
    const snapshot = yield* snapshots.getShellSnapshot();
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
    const automation = Option.getOrNull(yield* snapshots.getAutomationShellById(automationId));
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
      if (thread.latestTurn?.state === "running" || thread.session?.status === "running") {
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
    const automations = (yield* snapshots.listAutomationShells()).filter(
      (automation) => automation.enabled && gitRunTriggerBranch(automation).length > 0,
    );
    if (automations.length === 0) return;

    const targets = new Map<
      string,
      { readonly cwd: string; readonly branch: string; readonly automations: Array<AutomationId> }
    >();
    for (const automation of automations) {
      const project = Option.getOrNull(yield* snapshots.getProjectShellById(automation.projectId));
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

  const onDomainEvent = (event: OrchestrationEvent): Effect.Effect<void> => {
    switch (event.type) {
      case "automation.run-requested":
        return worker.enqueue({ kind: "execute", run: event.payload.run });
      case "automation.run-finished":
        return worker.enqueue({ kind: "finished", automationId: event.payload.automationId });
      case "automation.deleted":
        return worker.enqueue({ kind: "deleted", automationId: event.payload.automationId });
      case "thread.session-set":
        return worker.enqueue({
          kind: "thread",
          threadId: event.payload.threadId,
          session: event.payload.session,
          failure: null,
        });
      case "thread.activity-appended":
        return event.payload.activity.kind === "provider.turn.start.failed"
          ? worker.enqueue({
              kind: "thread",
              threadId: event.payload.threadId,
              session: null,
              failure: event.payload.activity.summary,
            })
          : Effect.void;
      default:
        return Effect.void;
    }
  };

  const enqueueAndDrain = (job: Job) => worker.enqueue(job).pipe(Effect.andThen(worker.drain));

  const start: AutomationScheduler["Service"]["start"] = Effect.fn("AutomationScheduler.start")(
    function* () {
      const domainEvents = yield* engine.subscribeDomainEvents;
      const merges = yield* pullRequests.subscribeMerges;
      yield* forkParked(Stream.runForEach(domainEvents, onDomainEvent));
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
