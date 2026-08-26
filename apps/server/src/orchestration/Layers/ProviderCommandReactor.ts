import {
  type ChatAttachment,
  CommandId,
  EventId,
  type MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  type ProjectId,
  type OrchestrationSession,
  type ProviderInstanceId,
  type SkillId,
  ThreadId,
  renderSubagentPolicyInstructions,
  resolveSubagentPolicy,
  type ResolvedSubagentPolicy,
  type ProviderSession,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import { extractSkillMentions, skillLoadIdKey, skillLoadNameKey } from "@t3tools/shared/skillTool";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import { canReplaceThreadTitle, DEFAULT_THREAD_TITLE } from "../threadTitles.ts";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../../serverSettings.ts";
import { isAppAttachable } from "../../apps/AppsService.ts";
import { extractAppMentions, renderAppMentionsPrelude } from "@t3tools/shared/appMentions";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import {
  SkillMaterializer,
  sanitizeSkillDirectoryName,
  skillNameMatches,
  type SkillDocument,
  type SkillMaterializeResult,
} from "../../skills/SkillMaterializer.ts";
import { renderSkillsPrelude } from "../../skills/SkillPrelude.ts";
import {
  HANDOFF_TRANSCRIPT_MAX_CHARS,
  renderProviderHandoffPrelude,
} from "../providerHandoffTranscript.ts";
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.meta-updated"
      | "thread.runtime-mode-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested"
      | "thread.session-set";
  }
>;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function withSubagentPolicyInstructions(
  input: string | undefined,
  policy: ResolvedSubagentPolicy | undefined,
): string | undefined {
  const instructions = policy ? renderSubagentPolicyInstructions(policy) : undefined;
  if (instructions === undefined) {
    return input;
  }
  if (input === undefined) {
    return instructions.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
      ? instructions
      : instructions.slice(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
  }
  const combined = `${instructions}\n\n${input}`;
  if (combined.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
    return combined;
  }
  const budget = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - instructions.length - 2;
  if (budget <= 0) {
    return instructions.slice(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
  }
  return `${instructions}\n\n${input.slice(0, budget)}`;
}

function asActivityRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Keys for every skill the thread log shows as loaded into the main agent's
 * context: T3's own `skill.loaded` rows and the agent's successful Skill tool
 * calls. A T3 row for a store skill counts by id only, so two installed
 * skills that share a name never shadow each other; rows without an id
 * (mentions, agent calls) count by name. Subagent calls load into the
 * subagent's context, and failed or still-running calls loaded nothing, so
 * neither counts.
 */
function collectedSkillLoadKeys(
  activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>,
): Set<string> {
  const keys = new Set<string>();
  for (const activity of activities) {
    const payload = asActivityRecord(activity.payload);
    const isOwnRow = activity.kind === "skill.loaded";
    const isAgentRow =
      activity.kind === "tool.completed" &&
      payload?.itemType === "skill_load" &&
      payload.status !== "failed" &&
      payload.status !== "declined" &&
      payload.agentId === undefined &&
      payload.parentToolUseId === undefined;
    if (!isOwnRow && !isAgentRow) {
      continue;
    }
    if (typeof payload?.skillId === "string" && payload.skillId.trim().length > 0) {
      keys.add(skillLoadIdKey(payload.skillId));
      continue;
    }
    const nameCandidates = [payload?.detail, payload?.skillName];
    for (const candidate of nameCandidates) {
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        continue;
      }
      keys.add(skillLoadNameKey(candidate));
      keys.add(skillLoadNameKey(sanitizeSkillDirectoryName(candidate)));
    }
  }
  return keys;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
/** Room kept for the handoff prelude and message framing when sizing the skills prelude. */
const SKILLS_PRELUDE_INPUT_RESERVE_CHARS = 1_000;
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const MAX_REGENERATION_ATTACHMENTS = 4;
const MAX_THREAD_TITLE_CONTEXT_CHARS = 8_000;
const MAX_FIRST_USER_TITLE_CONTEXT_CHARS = 2_000;
const THREAD_TITLE_CONTEXT_TRUNCATION_MARKER = "[Earlier content truncated]\n\n";
const FIRST_USER_CONTEXT_TRUNCATION_MARKER = "\n[First user message truncated]";

type ThreadTitleMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
};

function formatThreadTitleSection(message: ThreadTitleMessage): string | undefined {
  if (message.role === "system") {
    return undefined;
  }
  const text = message.text.trim();
  const attachmentSummary = (message.attachments ?? [])
    .map((attachment) => attachment.name)
    .join(", ");
  const contents = [
    ...(text.length > 0 ? [text] : []),
    ...(attachmentSummary.length > 0 ? [`[Attachments: ${attachmentSummary}]`] : []),
  ].join("\n");
  return contents.length > 0 ? `${message.role.toUpperCase()}:\n${contents}` : undefined;
}

function limitFirstUserSection(section: string): string {
  if (section.length <= MAX_FIRST_USER_TITLE_CONTEXT_CHARS) {
    return section;
  }
  return `${section.slice(
    0,
    MAX_FIRST_USER_TITLE_CONTEXT_CHARS - FIRST_USER_CONTEXT_TRUNCATION_MARKER.length,
  )}${FIRST_USER_CONTEXT_TRUNCATION_MARKER}`;
}

function collectRecentThreadTitleContext(
  messages: ReadonlyArray<ThreadTitleMessage>,
  maxChars: number,
): {
  readonly context: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly truncated: boolean;
} {
  let context = "";
  let truncated = false;
  const retainedAttachments: Array<ChatAttachment> = [];

  for (const message of messages.toReversed()) {
    const section = formatThreadTitleSection(message);
    if (section === undefined) {
      continue;
    }

    const separator = context.length > 0 ? "\n\n" : "";
    const available = maxChars - context.length - separator.length;
    if (section.length > available) {
      if (available > 0) {
        context = `${section.slice(-available)}${separator}${context}`;
        retainedAttachments.unshift(...(message.attachments ?? []));
      }
      truncated = true;
      break;
    }
    context = `${section}${separator}${context}`;
    retainedAttachments.unshift(...(message.attachments ?? []));
  }

  return { context, attachments: retainedAttachments, truncated };
}

function formatThreadTitleContext(messages: ReadonlyArray<ThreadTitleMessage>): {
  readonly message: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const recent = collectRecentThreadTitleContext(messages, MAX_THREAD_TITLE_CONTEXT_CHARS);
  if (!recent.truncated) {
    return {
      message: recent.context,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const firstUserMessage = messages.find(
    (message) => message.role === "user" && formatThreadTitleSection(message),
  );
  const firstUserSection = firstUserMessage
    ? formatThreadTitleSection(firstUserMessage)
    : undefined;
  if (!firstUserMessage || !firstUserSection) {
    return {
      message: `${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${recent.context}`,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const pinnedSection = limitFirstUserSection(firstUserSection);
  const recentContextBudget =
    MAX_THREAD_TITLE_CONTEXT_CHARS -
    pinnedSection.length -
    "\n\n".length -
    THREAD_TITLE_CONTEXT_TRUNCATION_MARKER.length;
  const retainedRecent = collectRecentThreadTitleContext(messages, recentContextBudget);
  const pinnedAttachment = firstUserMessage.attachments?.[0];
  const recentAttachments = retainedRecent.attachments.filter(
    (attachment) => attachment.id !== pinnedAttachment?.id,
  );

  return {
    message: `${pinnedSection}\n\n${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${retainedRecent.context}`,
    attachments: [
      ...(pinnedAttachment ? [pinnedAttachment] : []),
      ...recentAttachments.slice(
        -(MAX_REGENERATION_ATTACHMENTS - (pinnedAttachment === undefined ? 0 : 1)),
      ),
    ],
  };
}

export function providerErrorLabel(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

export function providerErrorLabelFromInstanceHint(input: {
  readonly instanceId?: string | undefined;
  readonly modelSelectionInstanceId?: string | undefined;
  readonly sessionProvider?: string | undefined;
}): string {
  return providerErrorLabel(
    input.instanceId ?? input.modelSelectionInstanceId ?? input.sessionProvider,
  );
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return isProviderAdapterRequestError(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request") ||
      detail.includes("unknown pending codex user input request")
    );
  }
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("unknown pending user-input request") ||
    message.includes("unknown pending user input request") ||
    message.includes("unknown pending codex user input request")
  );
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const providerRegistry = yield* ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService;
  const fileSystem = yield* FileSystem.FileSystem;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const skillMaterializer = yield* SkillMaterializer;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();

  // Turn starts sent with delivery "queue" while the thread's turn is running.
  // Held here until the session leaves "running", then dispatched one per
  // turn boundary in arrival order.
  // ponytail: in-memory, lost on restart — same durability as the hot domain
  // event stream this reactor consumes; persist alongside pending turn starts
  // if restart-surviving queues become a requirement.
  const queuedTurnStarts = new Map<
    string,
    Array<Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>>
  >();

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("provider-failure-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "error",
            kind: input.kind,
            summary: input.summary,
            payload: {
              detail: input.detail,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const formatFailureDetail = (cause: Cause.Cause<unknown>): string => {
    const failReason = cause.reasons.find(Cause.isFailReason);
    const providerError = isProviderAdapterRequestError(failReason?.error)
      ? failReason.error
      : undefined;
    if (providerError) {
      return providerError.detail;
    }
    return Cause.pretty(cause);
  };

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly activeUserMessageId?: MessageId;
    readonly createdAt: string;
  }) =>
    serverCommandId("provider-session-set").pipe(
      Effect.flatMap((commandId) =>
        orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId,
          threadId: input.threadId,
          session: input.session,
          ...(input.activeUserMessageId !== undefined
            ? { activeUserMessageId: input.activeUserMessageId }
            : {}),
          createdAt: input.createdAt,
        }),
      ),
    );

  const setThreadSessionErrorOnTurnStartFailure = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    const session = thread.session;
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...(session ?? {
          threadId: input.threadId,
          providerName: null,
          providerInstanceId: thread.modelSelection.instanceId,
          runtimeMode: thread.runtimeMode,
        }),
        status: session?.status === "stopped" ? "stopped" : "error",
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const resolveThreadSubagentPolicy = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly modelSelection?: ModelSelection;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return undefined;
    }
    const modelSelection = input.modelSelection ?? thread.modelSelection;
    const instanceInfo = Option.getOrUndefined(
      yield* providerService.getInstanceInfo(modelSelection.instanceId).pipe(Effect.option),
    );
    if (instanceInfo === undefined) {
      return undefined;
    }
    const settings = yield* serverSettingsService.getSettings.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.succeed(undefined);
      }),
    );
    return resolveSubagentPolicy({
      global: settings?.subagentPolicy ?? null,
      thread: thread.subagentPolicy ?? null,
      parentModel: modelSelection.model,
      parentInstanceId: modelSelection.instanceId,
      driver: instanceInfo.driverKind,
    });
  });

  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    return yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  /**
   * Recreates a thread's worktree from its branch when the directory has
   * disappeared. Provider sessions resume into the persisted cwd, so a missing
   * worktree makes every later turn fail as a bogus "session not found".
   * Best-effort: on failure the turn proceeds and reports the real error.
   */
  const ensureThreadWorktree = Effect.fnUntraced(function* (thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }) {
    const { worktreePath, branch } = thread;
    if (!worktreePath || !branch) {
      return;
    }
    const exists = yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => true));
    if (exists) {
      return;
    }
    const project = yield* resolveProject(thread.projectId);
    if (!project) {
      return;
    }
    const cwd = project.workspaceRoot;
    yield* Effect.logWarning("provider command reactor recreating missing worktree", {
      threadId: thread.id,
      worktreePath,
      branch,
    });
    // A directory deleted without `git worktree remove` leaves an admin entry
    // that makes `git worktree add` refuse the path; prune clears it.
    yield* gitWorkflow.pruneWorktrees({ cwd }).pipe(
      Effect.andThen(gitWorkflow.createWorktree({ cwd, refName: branch, path: worktreePath })),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("provider command reactor failed to recreate worktree", {
              threadId: thread.id,
              worktreePath,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const rejectStartedThreadModelChangeIfRequired = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly currentModelSelection: ModelSelection;
    readonly requestedModelSelection: ModelSelection | undefined;
  }) {
    const requestedModelSelection = input.requestedModelSelection;
    if (
      requestedModelSelection === undefined ||
      (input.currentModelSelection.instanceId === requestedModelSelection.instanceId &&
        input.currentModelSelection.model === requestedModelSelection.model)
    ) {
      return;
    }
    const providers = yield* providerRegistry.getProviders;
    const requiresNewThread =
      providers.find((snapshot) => snapshot.instanceId === input.currentModelSelection.instanceId)
        ?.requiresNewThreadForModelChange === true ||
      providers.find((snapshot) => snapshot.instanceId === requestedModelSelection.instanceId)
        ?.requiresNewThreadForModelChange === true;
    if (!requiresNewThread) {
      return;
    }
    return yield* new ProviderAdapterRequestError({
      provider: providerErrorLabelFromInstanceHint({
        instanceId: String(requestedModelSelection.instanceId),
        modelSelectionInstanceId: String(input.currentModelSelection.instanceId),
      }),
      method: "thread.turn.start",
      detail: `Thread '${input.threadId}' cannot switch models after the conversation has started. Start a new thread to use '${requestedModelSelection.model}'.`,
    });
  });

  /**
   * Skills a turn should carry: the enabled set (global settings ∪ thread
   * picks) materialized into the workspace plus `$skill` mentions in the
   * message, minus anything the thread log already shows as loaded (by T3 or
   * by the agent's own Skill tool). Their SKILL.md bodies travel with the
   * turn input, so "Skill" rows are only recorded once the provider accepted
   * the turn (`recordLoaded`); a failed send leaves nothing to dedupe against.
   * A provider handoff starts a fresh context, so it reloads everything.
   * Skills must never block a turn: any failure is logged and the turn
   * proceeds without a prelude.
   */
  const prepareSkillsForTurnStart = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly threadEnabledSkillIds: ReadonlyArray<SkillId>;
    readonly cwd: string | undefined;
    readonly providerInstanceId: ProviderInstanceId;
    readonly createdAt: string;
    readonly messageText: string | undefined;
    readonly reloadAll: boolean;
  }) {
    // Interrupts propagate; every other failure degrades to "no result".
    const orUndefinedOnFailure =
      (message: string) =>
      <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A | undefined, E, R> =>
        self.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning(message, {
                  threadId: input.threadId,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(undefined)),
          ),
        );

    let loaded: SkillMaterializeResult["loaded"] = [];
    if (input.cwd !== undefined) {
      const cwd = input.cwd;
      const settings = yield* serverSettingsService.getSettings.pipe(
        orUndefinedOnFailure(
          "provider command reactor failed to read skills settings; using thread skills only",
        ),
      );
      const ownSkillIds = new Set<SkillId>([
        ...(settings?.skills.enabledSkillIds ?? []),
        ...input.threadEnabledSkillIds,
      ]);
      // The workspace is shared by every live thread on the same cwd (local
      // mode, or several threads on one worktree), so the folders on disk
      // must cover all of their picks: reconciling to this thread's set alone
      // would delete a sibling's skill out from under its running agent. Only
      // this thread's own set is loaded into its context, though.
      const shells = yield* projectionSnapshotQuery
        .getShellSnapshot()
        .pipe(
          orUndefinedOnFailure(
            "provider command reactor failed to read sibling threads for skill materialization",
          ),
        );
      const siblingSkillIds =
        shells?.threads.flatMap((shell) =>
          shell.id !== input.threadId &&
          shell.archivedAt === null &&
          resolveThreadWorkspaceCwd({ thread: shell, projects: shells.projects }) === cwd
            ? shell.enabledSkillIds
            : [],
        ) ?? [];
      const materializeResult = yield* skillMaterializer
        .materialize({ cwd, skillIds: [...new Set<SkillId>([...ownSkillIds, ...siblingSkillIds])] })
        .pipe(orUndefinedOnFailure("provider command reactor failed to materialize skills"));
      loaded = (materializeResult?.loaded ?? []).filter((skill) => ownSkillIds.has(skill.id));
    }

    const mentionedNames = extractSkillMentions(input.messageText ?? "").filter(
      (name) => !loaded.some((skill) => skillNameMatches(skill.name, name)),
    );
    let mentioned: ReadonlyArray<SkillDocument> = [];
    if (mentionedNames.length > 0) {
      const providers = yield* providerRegistry.getProviders.pipe(
        orUndefinedOnFailure(
          "provider command reactor failed to read provider skills for $skill mentions",
        ),
      );
      const candidates =
        providers?.find((provider) => provider.instanceId === input.providerInstanceId)?.skills ??
        [];
      mentioned =
        (yield* skillMaterializer
          .resolveMentions({ cwd: input.cwd, names: mentionedNames, candidates })
          .pipe(
            orUndefinedOnFailure("provider command reactor failed to resolve $skill mentions"),
          )) ?? [];
    }

    // Store skills are distinct by id (two marketplaces can ship a "tdd");
    // mentions are distinct by name, and mentions matching a loaded store
    // skill were already dropped above.
    const nameKeys = (name: string) => [
      skillLoadNameKey(name),
      skillLoadNameKey(sanitizeSkillDirectoryName(name)),
    ];
    const pending: Array<{
      readonly document: SkillDocument;
      readonly skillId?: SkillId;
      readonly keys: ReadonlyArray<string>;
    }> = [
      ...loaded.map((skill) => ({
        document: skill,
        skillId: skill.id,
        keys: [skillLoadIdKey(skill.id), ...nameKeys(skill.name)],
      })),
      ...mentioned.map((skill) => ({ document: skill, keys: nameKeys(skill.name) })),
    ];
    if (pending.length === 0) {
      return { prelude: undefined, recordLoaded: Effect.void };
    }

    const thread = input.reloadAll
      ? undefined
      : yield* resolveThread(input.threadId).pipe(
          orUndefinedOnFailure(
            "provider command reactor failed to read the thread log for skill dedupe",
          ),
        );
    const alreadyShown = collectedSkillLoadKeys(thread?.activities ?? []);
    const toLoad = pending.filter((skill) => !skill.keys.some((key) => alreadyShown.has(key)));
    if (toLoad.length === 0) {
      return { prelude: undefined, recordLoaded: Effect.void };
    }

    const rendered = renderSkillsPrelude({
      skills: toLoad.map((skill) => skill.document),
      maxChars: Math.max(
        0,
        PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
          (input.messageText?.trim().length ?? 0) -
          SKILLS_PRELUDE_INPUT_RESERVE_CHARS,
      ),
    });
    if (rendered === undefined) {
      yield* Effect.logWarning("provider command reactor could not fit any skill into the turn", {
        threadId: input.threadId,
        skills: toLoad.map((skill) => skill.document.name),
      });
      return { prelude: undefined, recordLoaded: Effect.void };
    }
    if (rendered.omitted.length > 0) {
      yield* Effect.logWarning(
        "provider command reactor omitted skills that exceed the turn size",
        {
          threadId: input.threadId,
          skills: rendered.omitted.map((skill) => skill.name),
        },
      );
    }
    const includedDocuments = new Set(rendered.included);
    const included = toLoad.filter((skill) => includedDocuments.has(skill.document));

    const recordLoaded = Effect.gen(function* () {
      for (const skill of included) {
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: yield* serverCommandId("skill-loaded-activity"),
          threadId: input.threadId,
          activity: {
            id: yield* serverEventId(),
            tone: "tool",
            kind: "skill.loaded",
            summary: "Skill",
            payload: {
              itemType: "skill_load",
              status: "completed",
              title: "Skill",
              detail: skill.document.name,
              ...(skill.skillId !== undefined ? { skillId: skill.skillId } : {}),
              skillName: skill.document.name,
              directory: skill.document.directory,
            },
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to record loaded skills", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
    return { prelude: rendered.text, recordLoaded };
  });

  const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly pendingTurnStart?: boolean;
      readonly messageText?: string;
    },
  ) {
    const thread = yield* resolveThread(threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const activeSession = yield* resolveActiveSession(threadId);
    const activeThreadSession =
      thread.session !== null && thread.session.status !== "stopped" && activeSession
        ? thread.session
        : null;
    if (
      activeThreadSession !== null &&
      activeSession !== undefined &&
      (activeThreadSession.providerInstanceId === undefined ||
        activeSession.providerInstanceId === undefined)
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeThreadSession.providerName ?? undefined),
        method: "thread.turn.start",
        detail: `Thread '${threadId}' has an active provider session without a provider instance id.`,
      });
    }
    const currentInstanceId =
      activeThreadSession !== null &&
      activeSession !== undefined &&
      activeSession.providerInstanceId !== undefined
        ? activeSession.providerInstanceId
        : (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId);
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredInstanceId = desiredModelSelection.instanceId;
    const unknownSourceInstanceError = () =>
      new ProviderAdapterRequestError({
        provider: providerErrorLabelFromInstanceHint({
          instanceId: String(currentInstanceId),
          modelSelectionInstanceId: String(thread.modelSelection.instanceId),
          sessionProvider: thread.session?.providerName ?? undefined,
        }),
        method: "thread.turn.start",
        detail: `Thread '${threadId}' references unknown provider instance '${currentInstanceId}'. The instance is not configured in this build.`,
      });
    const currentInfo = Option.getOrUndefined(
      yield* providerService.getInstanceInfo(currentInstanceId).pipe(Effect.option),
    );
    if (currentInfo === undefined && desiredInstanceId === currentInstanceId) {
      return yield* unknownSourceInstanceError();
    }
    const desiredInfo = yield* providerService.getInstanceInfo(desiredInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(desiredModelSelection.instanceId),
            }),
            method: "thread.turn.start",
            detail: `Requested provider instance '${desiredInstanceId}' is not configured in this build.`,
          }),
      ),
    );
    const desiredDriverKind = desiredInfo.driverKind;
    if (!isProviderDriverKind(desiredDriverKind)) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(String(desiredDriverKind)),
        method: "thread.turn.start",
        detail: `Requested provider instance '${desiredInstanceId}' uses unknown provider driver '${desiredDriverKind}'. The driver is not installed in this build.`,
      });
    }
    const preferredProvider: ProviderDriverKind = desiredDriverKind;
    const sourceUnresolved = currentInfo === undefined;
    const requestedDifferentInstance =
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId !== currentInstanceId;
    const pendingUncommittedHandoff =
      requestedModelSelection !== undefined &&
      thread.modelSelection.instanceId !== requestedModelSelection.instanceId &&
      (thread.session?.providerInstanceId === requestedModelSelection.instanceId ||
        activeSession?.providerInstanceId === requestedModelSelection.instanceId);
    const incompatibleContinuation =
      currentInfo !== undefined &&
      (currentInfo.driverKind !== desiredInfo.driverKind ||
        currentInfo.continuationIdentity.continuationKey !==
          desiredInfo.continuationIdentity.continuationKey);
    const isProviderHandoff =
      pendingUncommittedHandoff ||
      (requestedDifferentInstance && (sourceUnresolved || incompatibleContinuation));
    if (options?.pendingTurnStart === true && thread.session?.status !== "running") {
      yield* setThreadSession({
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: activeSession?.provider ?? preferredProvider,
          providerInstanceId: activeSession?.providerInstanceId ?? desiredInstanceId,
          runtimeMode: desiredRuntimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    }
    if (thread.session !== null && !isProviderHandoff) {
      yield* rejectStartedThreadModelChangeIfRequired({
        threadId,
        currentModelSelection:
          activeSession?.model !== undefined
            ? {
                ...thread.modelSelection,
                instanceId: currentInstanceId,
                model: activeSession.model,
              }
            : thread.modelSelection,
        requestedModelSelection,
      });
    }
    const currentModel = activeSession?.model ?? thread.modelSelection.model;
    const modelSelectionChangedForStartedThread =
      thread.session !== null &&
      requestedModelSelection !== undefined &&
      (desiredInstanceId !== currentInstanceId || desiredModelSelection.model !== currentModel);
    const sourceInfoForHandoffNotice =
      !isProviderHandoff ||
      (currentInfo !== undefined && currentInstanceId === thread.modelSelection.instanceId)
        ? currentInfo
        : Option.getOrUndefined(
            yield* providerService
              .getInstanceInfo(thread.modelSelection.instanceId)
              .pipe(Effect.option),
          );
    const appendModelChangedNotice = (input: { readonly isHandoff: boolean }) =>
      Effect.gen(function* () {
        if (!input.isHandoff && !modelSelectionChangedForStartedThread) {
          return;
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: yield* serverCommandId("thread-model-changed-notice"),
          threadId,
          activity: {
            id: yield* serverEventId(),
            tone: "info",
            kind: "thread.model-changed",
            summary: `Switched model to ${desiredModelSelection.model}`,
            payload: {
              fromInstanceId: String(
                input.isHandoff ? thread.modelSelection.instanceId : currentInstanceId,
              ),
              fromModel: input.isHandoff ? thread.modelSelection.model : currentModel,
              fromDriverKind: input.isHandoff
                ? (sourceInfoForHandoffNotice?.driverKind ?? "unknown")
                : (currentInfo?.driverKind ?? "unknown"),
              toInstanceId: String(desiredInstanceId),
              toModel: desiredModelSelection.model,
              toDriverKind: desiredInfo.driverKind,
              isHandoff: input.isHandoff,
            },
            turnId: null,
            createdAt,
          },
          createdAt,
        });
      });
    const finalizeHandoff = isProviderHandoff
      ? Effect.gen(function* () {
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: yield* serverCommandId("provider-handoff-model-selection"),
            threadId,
            modelSelection: desiredModelSelection,
          });
          yield* appendModelChangedNotice({ isHandoff: true });
        })
      : Effect.void;
    const project = yield* resolveProject(thread.projectId);
    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    });
    // Skills materialize before the provider session boots so the CLI sees
    // the enabled set on disk; the returned prelude travels with the turn.
    const skills =
      options?.pendingTurnStart === true
        ? yield* prepareSkillsForTurnStart({
            threadId,
            threadEnabledSkillIds: thread.enabledSkillIds,
            cwd: effectiveCwd,
            providerInstanceId: desiredInstanceId,
            createdAt,
            messageText: options.messageText,
            reloadAll: isProviderHandoff,
          })
        : { prelude: undefined, recordLoaded: Effect.void };

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderDriverKind;
    }) =>
      resolveThreadSubagentPolicy({
        threadId,
        modelSelection: desiredModelSelection,
      }).pipe(
        Effect.flatMap((subagentPolicy) =>
          providerService.startSession(threadId, {
            threadId,
            ...(preferredProvider ? { provider: preferredProvider } : {}),
            providerInstanceId: desiredInstanceId,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
            ...(thread.title ? { title: thread.title } : {}),
            modelSelection: desiredModelSelection,
            ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
            runtimeMode: desiredRuntimeMode,
            ...(subagentPolicy !== undefined ? { subagentPolicy } : {}),
          }),
        ),
      );

    const bindSessionToThread = (session: ProviderSession) =>
      Effect.gen(function* () {
        if (session.providerInstanceId === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: providerErrorLabel(session.provider),
            method: "thread.turn.start",
            detail: `Provider session '${session.threadId}' started without a provider instance id.`,
          });
        }
        yield* setThreadSession({
          threadId,
          session: {
            threadId,
            status:
              options?.pendingTurnStart === true && session.status === "ready"
                ? "starting"
                : mapProviderSessionStatusToOrchestrationStatus(session.status),
            providerName: session.provider,
            providerInstanceId: session.providerInstanceId,
            runtimeMode: desiredRuntimeMode,
            // Provider turn ids are not orchestration turn ids.
            activeTurnId: null,
            lastError: session.lastError ?? null,
            updatedAt: session.updatedAt,
          },
          createdAt,
        });
      });

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" && activeSession ? thread.id : null;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const sessionModelSwitch = (yield* providerService.getCapabilities(desiredInstanceId))
        .sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      const instanceChanged =
        requestedModelSelection !== undefined &&
        activeSession?.providerInstanceId !== requestedModelSelection.instanceId;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = threadModelSelections.get(threadId);
      const shouldRestartForModelSelectionChange =
        preferredProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !instanceChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        if (!isProviderHandoff) {
          yield* appendModelChangedNotice({ isHandoff: false });
        }
        return {
          threadId: existingSessionThreadId,
          handedOff: isProviderHandoff,
          finalizeHandoff,
          skills,
        };
      }

      const resumeCursor =
        shouldRestartForModelChange || isProviderHandoff
          ? undefined
          : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider: activeSession?.provider,
        currentInstanceId,
        desiredInstanceId,
        desiredProvider: desiredModelSelection.instanceId,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        modelChanged,
        instanceChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        isProviderHandoff,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToThread(restartedSession);
      if (!isProviderHandoff) {
        yield* appendModelChangedNotice({ isHandoff: false });
      }
      return {
        threadId: restartedSession.threadId,
        handedOff: isProviderHandoff,
        finalizeHandoff,
        skills,
      };
    }

    const startedSession = yield* startProviderSession(undefined);
    yield* bindSessionToThread(startedSession);
    if (!isProviderHandoff) {
      yield* appendModelChangedNotice({ isHandoff: false });
    }
    return {
      threadId: startedSession.threadId,
      handedOff: isProviderHandoff,
      finalizeHandoff,
      skills,
    };
  });

  const buildSendTurnRequestForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly messageId?: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly delivery?: "steer" | "queue";
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${input.threadId}' was not found in read model.`),
      );
    }
    const ensuredSession = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      pendingTurnStart: true,
      messageText: input.messageText,
    });
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, input.modelSelection);
    }
    const normalizedInput = toNonEmptyProviderInput(input.messageText);
    const subagentPolicy = yield* resolveThreadSubagentPolicy({
      threadId: input.threadId,
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    });
    const subagentPolicyInstructions = subagentPolicy
      ? renderSubagentPolicyInstructions(subagentPolicy)
      : undefined;
    const subagentPolicyChars =
      subagentPolicyInstructions === undefined ? 0 : subagentPolicyInstructions.length + 2;
    const skillsPrelude = ensuredSession.skills.prelude;
    const handoffPrelude = ensuredSession.handedOff
      ? renderProviderHandoffPrelude({
          messages: thread.messages,
          activities: thread.activities,
          ...(input.messageId !== undefined ? { excludeMessageId: input.messageId } : {}),
          maxChars: Math.min(
            HANDOFF_TRANSCRIPT_MAX_CHARS,
            PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
              (normalizedInput?.length ?? 0) -
              (skillsPrelude?.length ?? 0) -
              subagentPolicyChars -
              1_000,
          ),
        })
      : undefined;
    // `@app` mentions get a one-line pointer to the MCP server that carries the
    // app's tools; small enough to never fight the budget above.
    const appsPrelude = normalizedInput
      ? renderAppMentionsPrelude(
          extractAppMentions(
            normalizedInput,
            Object.values(
              (yield* serverSettingsService.getSettings.pipe(Effect.orElseSucceed(() => undefined)))
                ?.apps.connections ?? {},
            ).filter(isAppAttachable),
          ),
        )
      : undefined;
    // Skills first: they are standing instructions, the handoff is history.
    const inputWithPreludes =
      skillsPrelude || handoffPrelude || appsPrelude
        ? [skillsPrelude, appsPrelude, handoffPrelude, normalizedInput].filter(Boolean).join("\n\n")
        : normalizedInput;
    const inputWithSubagentPolicy = withSubagentPolicyInstructions(
      inputWithPreludes,
      subagentPolicy,
    );
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : activeSession.providerInstanceId === undefined
          ? yield* new ProviderAdapterRequestError({
              provider: providerErrorLabel(activeSession.provider),
              method: "thread.turn.start",
              detail: `Active provider session '${activeSession.threadId}' is missing a provider instance id.`,
            })
          : (yield* providerService.getCapabilities(activeSession.providerInstanceId))
              .sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported" && input.modelSelection === undefined
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    return {
      request: {
        threadId: input.threadId,
        ...(inputWithSubagentPolicy ? { input: inputWithSubagentPolicy } : {}),
        ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
        ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
        ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
        ...(input.delivery !== undefined ? { delivery: input.delivery } : {}),
      },
      // Runs once the provider accepted the turn: persists the handoff and the
      // Skill rows for the documents this turn carried.
      afterSendTurn: ensuredSession.finalizeHandoff.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to persist provider handoff", {
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.andThen(ensuredSession.skills.recordLoaded),
      ),
    };
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn(
    "maybeGenerateAndRenameWorktreeBranchForFirstTurn",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const settings = yield* serverSettingsService.getSettings;
      const modelSelection =
        settings.sourceControlWriterModelSelection === null
          ? settings.textGenerationModelSelection
          : resolveSourceControlWriterModelSelection(
              settings,
              yield* providerRegistry.getProviders,
            );

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* gitWorkflow.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
      yield* vcsStatusBroadcaster.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly titleSeed?: string;
    }) {
      const attachments = input.attachments ?? [];
      yield* Effect.gen(function* () {
        const { textGenerationModelSelection: modelSelection } =
          yield* serverSettingsService.getSettings;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: input.cwd,
          message: input.messageText,
          ...(attachments.length > 0 ? { attachments } : {}),
          modelSelection,
        });
        if (!generated) return;

        const thread = yield* resolveThread(input.threadId);
        if (!thread) return;
        if (!canReplaceThreadTitle(thread.title, input.titleSeed)) {
          return;
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* serverCommandId("thread-title-rename"),
          threadId: input.threadId,
          title: generated.title,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to generate or rename thread title", {
            threadId: input.threadId,
            cwd: input.cwd,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  );

  const regenerateThreadTitle = Effect.fn("regenerateThreadTitle")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>,
    requestId: CommandId,
  ) {
    if (event.payload.regenerateTitle !== true) {
      return { _tag: "Superseded" } as const;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread || thread.titleRegeneration?.requestId !== requestId) {
      return { _tag: "Superseded" } as const;
    }

    const { message, attachments } = formatThreadTitleContext(thread.messages);
    if (message.length === 0) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const previousTitle = event.payload.previousTitle ?? thread.title;
    if (thread.title !== previousTitle) {
      return { _tag: "Superseded" } as const;
    }
    const project = yield* resolveProject(thread.projectId);
    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      }) ?? process.cwd();
    const { textGenerationModelSelection: modelSelection } =
      yield* serverSettingsService.getSettings;
    const generated = yield* textGeneration.generateThreadTitle({
      cwd,
      message,
      previousTitle,
      ...(attachments.length > 0 ? { attachments } : {}),
      modelSelection,
    });
    if (generated.title === DEFAULT_THREAD_TITLE || generated.title === previousTitle) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const latestThread = yield* resolveThread(event.payload.threadId);
    if (
      !latestThread ||
      latestThread.titleRegeneration?.requestId !== requestId ||
      latestThread.title !== previousTitle
    ) {
      return { _tag: "Superseded" } as const;
    }

    return { _tag: "Completed", title: generated.title } as const;
  });
  const dispatchThreadTitleRegenerationCompletion = Effect.fn(
    "dispatchThreadTitleRegenerationCompletion",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly title?: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: yield* serverCommandId("thread-title-regeneration-complete"),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
  });
  const findInterruptedThreadTitleRegenerations = Effect.fn(
    "findInterruptedThreadTitleRegenerations",
  )(function* () {
    const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
    return readModel.threads.flatMap((thread) => {
      const requestId = thread.titleRegeneration?.requestId;
      return requestId === undefined ? [] : [{ threadId: thread.id, requestId }];
    });
  });
  const clearInterruptedThreadTitleRegenerations = Effect.fn(
    "clearInterruptedThreadTitleRegenerations",
  )(function* (
    interrupted: ReadonlyArray<{ readonly threadId: ThreadId; readonly requestId: CommandId }>,
  ) {
    yield* Effect.forEach(
      interrupted,
      ({ threadId, requestId }) => {
        return dispatchThreadTitleRegenerationCompletion({
          threadId,
          requestId,
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning(
              "provider command reactor failed to clear interrupted title regeneration",
              {
                threadId,
                cause: Cause.pretty(cause),
              },
            );
          }),
        );
      },
      { discard: true },
    );
  });
  const processThreadTitleRegenerationSafely = Effect.fn("processThreadTitleRegenerationSafely")(
    function* (event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>) {
      if (event.payload.regenerateTitle !== true) {
        return;
      }

      const requestId = event.payload.titleRegeneration?.requestId ?? event.commandId;
      if (requestId === null) {
        return;
      }
      const result = yield* regenerateThreadTitle(event, requestId).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("provider command reactor failed to regenerate thread title", {
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as({ _tag: "Completed", title: undefined } as const));
        }),
      );
      if (result._tag === "Superseded") {
        return;
      }

      const completion = {
        threadId: event.payload.threadId,
        requestId,
        ...(result.title !== undefined ? { title: result.title } : {}),
      };
      yield* dispatchThreadTitleRegenerationCompletion(completion).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor retrying title regeneration completion",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          ).pipe(Effect.andThen(dispatchThreadTitleRegenerationCompletion(completion)));
        }),
      );
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor failed to complete title regeneration",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          );
        }),
      ),
  );
  const threadTitleRegenerationWorker = yield* makeDrainableWorker(
    processThreadTitleRegenerationSafely,
  );

  const dispatchTurnStart = Effect.fn("dispatchTurnStart")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
    placement: "tail" | "head" = "tail",
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    // "starting" holds too: a flushed predecessor moves the session through
    // starting before its turn runs, and a queued message must not jump in
    // ahead of it. A flush re-entry that lands here (stale duplicate
    // session-set snapshot) goes back to the HEAD so the queue keeps arrival
    // order; only fresh arrivals append.
    if (
      event.payload.delivery === "queue" &&
      (thread.session?.status === "running" || thread.session?.status === "starting")
    ) {
      const queue = queuedTurnStarts.get(event.payload.threadId);
      if (!queue) {
        queuedTurnStarts.set(event.payload.threadId, [event]);
      } else if (placement === "head") {
        queue.unshift(event);
      } else {
        queue.push(event);
      }
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    yield* ensureThreadWorktree(thread);

    const isFirstUserMessageTurn =
      thread.messages.filter((entry) => entry.role === "user").length === 1;
    if (isFirstUserMessageTurn) {
      const project = yield* resolveProject(thread.projectId);
      const generationCwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: project ? [project] : [],
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        ...generationInput,
      }).pipe(Effect.forkScoped);

      if (canReplaceThreadTitle(thread.title, event.payload.titleSeed)) {
        yield* maybeGenerateThreadTitleForFirstTurn({
          threadId: event.payload.threadId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    const handleTurnStartFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      const detail = formatFailureDetail(cause);
      return setThreadSessionErrorOnTurnStartFailure({
        threadId: event.payload.threadId,
        detail,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.flatMap(() =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.turn.start.failed",
            summary: "Provider turn start failed",
            detail,
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
        Effect.asVoid,
      );
    };

    const recoverTurnStartFailure = (cause: Cause.Cause<unknown>) =>
      handleTurnStartFailure(cause).pipe(
        Effect.catchCause((recoveryCause) =>
          Effect.logWarning("provider command reactor failed to recover turn start failure", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(recoveryCause),
            originalCause: Cause.pretty(cause),
          }),
        ),
      );

    const sendTurnRequest = yield* buildSendTurnRequestForThread({
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
      messageText: message.text,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      ...(event.payload.delivery !== undefined ? { delivery: event.payload.delivery } : {}),
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => handleTurnStartFailure(cause).pipe(Effect.as(Option.none()))),
    );

    if (Option.isNone(sendTurnRequest)) {
      return;
    }

    yield* providerService.sendTurn(sendTurnRequest.value.request).pipe(
      Effect.tap((turn) =>
        Effect.gen(function* () {
          const startedThread = yield* resolveThread(event.payload.threadId);
          if (startedThread?.session) {
            const acceptedAt = DateTime.formatIso(yield* DateTime.now);
            yield* setThreadSession({
              threadId: event.payload.threadId,
              activeUserMessageId: event.payload.messageId,
              session: {
                ...startedThread.session,
                status: "running",
                activeTurnId: turn.turnId,
                lastError: null,
                updatedAt: acceptedAt,
              },
              createdAt: acceptedAt,
            });
          }
          yield* sendTurnRequest.value.afterSendTurn;
        }),
      ),
      Effect.catchCause(recoverTurnStartFailure),
      Effect.forkScoped,
    );
  });

  // Drain while the live session is idle. One-at-a-time: after a successful
  // dispatch, ensureSession has marked the session starting/running, so the
  // next iteration stops. Re-read live status each pass — a stale
  // session-set(ready) still sitting on this worker must not shift the next
  // queued start just because its payload says ready.
  const flushQueuedTurnStarts = Effect.fn("flushQueuedTurnStarts")(function* (threadId: ThreadId) {
    while (true) {
      const thread = yield* resolveThread(threadId);
      if (thread?.session?.status === "running" || thread?.session?.status === "starting") {
        return;
      }
      const queue = queuedTurnStarts.get(threadId);
      const next = queue?.shift();
      if (queue === undefined || next === undefined) {
        queuedTurnStarts.delete(threadId);
        return;
      }
      if (queue.length === 0) {
        queuedTurnStarts.delete(threadId);
      }
      // "head": if a concurrent status write re-holds this event mid-dispatch,
      // it must go back in front of its younger siblings, not behind them.
      yield* dispatchTurnStart(next, "head");
    }
  });

  const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }
    yield* dispatchTurnStart(event);
    // Close the wake-up race: a session-set that committed between the hold's
    // thread snapshot and its map insert was dropped by the stream filter
    // (the map was still empty), so no later flush is guaranteed. If the
    // event was held but the session has already left running/starting,
    // flush here instead of waiting for a wake-up that never comes.
    if (queuedTurnStarts.has(event.payload.threadId)) {
      const current = yield* resolveThread(event.payload.threadId);
      const status = current?.session?.status;
      if (status !== "running" && status !== "starting") {
        yield* flushQueuedTurnStarts(event.payload.threadId);
      }
    }
  });

  const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const session = thread.session;
    if (!session || session.status === "stopped") {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    const recoverInterruptFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.interrupt;
      }

      const detail = formatFailureDetail(cause);
      return Effect.gen(function* () {
        const latestThread = yield* resolveThread(event.payload.threadId);
        const latestSession = latestThread?.session;
        if (
          !latestSession ||
          latestSession.status === "stopped" ||
          latestSession.status === "ready" ||
          (event.payload.turnId !== undefined &&
            latestSession.activeTurnId !== null &&
            latestSession.activeTurnId !== event.payload.turnId)
        ) {
          return;
        }

        yield* providerService.stopSession({ threadId: event.payload.threadId }).pipe(
          Effect.catchCause((stopCause) => {
            if (Cause.hasInterruptsOnly(stopCause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning(
              "provider command reactor failed to stop session after interrupt failure",
              {
                threadId: event.payload.threadId,
                cause: Cause.pretty(stopCause),
                originalCause: Cause.pretty(cause),
              },
            );
          }),
        );
        const stoppedThread = yield* resolveThread(event.payload.threadId);
        const stoppedSession = stoppedThread?.session;
        if (
          !stoppedSession ||
          stoppedSession.status === "stopped" ||
          stoppedSession.status === "ready" ||
          (event.payload.turnId !== undefined &&
            stoppedSession.activeTurnId !== null &&
            stoppedSession.activeTurnId !== event.payload.turnId)
        ) {
          return;
        }

        yield* setThreadSession({
          threadId: event.payload.threadId,
          session: {
            ...stoppedSession,
            status: "stopped",
            activeTurnId: null,
            lastError: detail,
            updatedAt: event.payload.createdAt,
          },
          createdAt: event.payload.createdAt,
        });
        yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.interrupt.failed",
          summary: "Provider turn interrupt failed",
          detail,
          turnId: event.payload.turnId ?? null,
          createdAt: event.payload.createdAt,
        });
      });
    };

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService
      .interruptTurn({ threadId: event.payload.threadId })
      .pipe(Effect.catchCause(recoverInterruptFailure));
  });

  const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            detail: isUnknownPendingApprovalRequestError(cause)
              ? stalePendingRequestDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(
    function* (
      event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
    ) {
      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      const hasSession = thread.session && thread.session.status !== "stopped";
      if (!hasSession) {
        return yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: "No active provider session is bound to this thread.",
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        });
      }

      yield* providerService
        .respondToUserInput({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
        })
        .pipe(
          Effect.catchCause((cause) =>
            appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.user-input.respond.failed",
              summary: "Provider user input response failed",
              detail: isUnknownPendingUserInputRequestError(cause)
                ? stalePendingRequestDetail("user-input", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            }),
          ),
        );
    },
  );

  const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    if (thread.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        ...(thread.session?.providerInstanceId !== undefined
          ? { providerInstanceId: thread.session.providerInstanceId }
          : {}),
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: ProviderIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.thread_id": event.payload.threadId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });
    switch (event.type) {
      case "thread.meta-updated":
        yield* threadTitleRegenerationWorker.enqueue(event);
        return;
      case "thread.runtime-mode-set": {
        const thread = yield* resolveThread(event.payload.threadId);
        if (!thread?.session || thread.session.status === "stopped") {
          return;
        }
        const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
        yield* ensureSessionForThread(
          event.payload.threadId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
        );
        return;
      }
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
      case "thread.turn-interrupt-requested":
        yield* processTurnInterruptRequested(event);
        return;
      case "thread.approval-response-requested":
        yield* processApprovalResponseRequested(event);
        return;
      case "thread.user-input-response-requested":
        yield* processUserInputResponseRequested(event);
        return;
      case "thread.session-stop-requested":
        yield* processSessionStopRequested(event);
        return;
      case "thread.session-set": {
        // Use the projected session, not the event payload: a ready event that
        // was queued before a flushed turn marked the session starting must
        // not start the next queued message.
        const thread = yield* resolveThread(event.payload.threadId);
        const status = thread?.session?.status;
        if (status !== "running" && status !== "starting") {
          yield* flushQueuedTurnStarts(event.payload.threadId);
        }
        return;
      }
    }
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const interruptedTitleRegenerations = yield* findInterruptedThreadTitleRegenerations().pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to find interrupted title regenerations",
          { cause: Cause.pretty(cause) },
        ).pipe(Effect.as([]));
      }),
    );
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        (event.type === "thread.meta-updated" && event.payload.regenerateTitle === true) ||
        event.type === "thread.runtime-mode-set" ||
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.turn-interrupt-requested" ||
        event.type === "thread.approval-response-requested" ||
        event.type === "thread.user-input-response-requested" ||
        event.type === "thread.session-stop-requested" ||
        // Session-set only matters here as a flush trigger, so skip the worker
        // round-trip unless this thread actually holds queued starts. A
        // session-set that races ahead of its queued turn-start is harmless:
        // the hold check reads the already-updated projection and sends
        // immediately instead of holding.
        (event.type === "thread.session-set" && queuedTurnStarts.has(event.payload.threadId))
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));

    // The domain event stream is hot, so work pending before this reactor
    // starts cannot be resumed. Correlated completions only clear the request
    // captured here, leaving any newer request untouched.
    const clearInterrupted = clearInterruptedThreadTitleRegenerations(
      interruptedTitleRegenerations,
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to clear interrupted title regenerations",
          {
            cause: Cause.pretty(cause),
          },
        );
      }),
    );
    const activation = yield* ServerActivation;
    if (activation === undefined) {
      yield* clearInterrupted;
    } else {
      yield* forkParked(clearInterrupted);
    }
  });

  return {
    start,
    drain: Effect.gen(function* () {
      yield* worker.drain;
      yield* threadTitleRegenerationWorker.drain;
    }),
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
