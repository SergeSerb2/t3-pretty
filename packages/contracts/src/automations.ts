/**
 * Automations — prompts that run unattended on a schedule, on an in-app
 * event, on a webhook delivery, on a git remote change, or on demand.
 *
 * The domain records (`Automation`, `AutomationRun`) live in the
 * event-sourced orchestration aggregate `automation`; `AutomationShell` is
 * the projected row clients render. The MCP toolkit `t3-code-automations`
 * (`apps/server/src/mcp/toolkits/automations/`) uses the tool I/O schemas at
 * the bottom of this module.
 *
 * Keep this module schema-only plus the pure cron check the schema needs;
 * runtime lives in `apps/server`, presentation helpers in `packages/shared`.
 */
import * as Cron from "effect/Cron";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  AutomationId,
  AutomationRunId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { DEFAULT_RUNTIME_MODE, ModelSelection, RuntimeMode } from "./modelSelection.ts";

export const AUTOMATION_MAX_TRIGGERS = 8;
export const AUTOMATION_KEEP_RUN_THREADS = 25;
export const AUTOMATION_RUN_SUMMARY_MAX_CHARS = 2000;
export const AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS = 32_768;
export const AUTOMATION_NAME_MAX_LENGTH = 120;
export const AUTOMATION_PROMPT_MAX_LENGTH = 120_000;
export const AUTOMATION_MIN_INTERVAL_MAX_SECONDS = 86_400;
export const AUTOMATION_TIMEOUT_MAX_MINUTES = 1440;
export const AUTOMATION_LIST_RUNS_MAX_LIMIT = 200;
export const AUTOMATION_LIST_RUNS_DEFAULT_LIMIT = 50;
/** Densest schedule accepted: consecutive instants must be this far apart. */
export const AUTOMATION_SCHEDULE_MIN_GAP_MILLIS = 5 * 60_000;

/**
 * Ordering used to clamp the runtime mode an agent may grant an automation to
 * the mode its own thread runs with. `yolo` is Kimi's full-access spelling.
 */
export const AUTOMATION_RUNTIME_MODE_RANK: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
  yolo: 3,
};

// ---------------------------------------------------------------------------
// Cron validation (shared by the schema check, the server, and both clients)
// ---------------------------------------------------------------------------

/**
 * Fixed anchor for the density check so the verdict never depends on when
 * the automation was saved.
 */
const SCHEDULE_GAP_EPOCH = DateTime.makeUnsafe("2024-01-01T00:00:00Z");

/**
 * `Cron.next` throws when a schedule can never fire (e.g. `0 0 31 2 *`).
 * Returns null instead so callers treat it like "no next run".
 */
export function automationCronNext(
  cron: Cron.Cron,
  from: DateTime.DateTime.Input,
): DateTime.Utc | null {
  try {
    return DateTime.makeUnsafe(Cron.next(cron, from));
  } catch {
    return null;
  }
}

/** Gaps checked from the anchor; enough to catch `0,59 * * * *`-style pairs. */
const SCHEDULE_GAP_SAMPLES = 4;

/**
 * Parses an automation schedule: exactly five fields, an IANA time zone, and
 * at least `AUTOMATION_SCHEDULE_MIN_GAP_MILLIS` between each of the first few
 * instants. Failure carries the message shown to the user or agent.
 */
export function validateAutomationCron(
  cron: string,
  timezone: string,
): Result.Result<Cron.Cron, string> {
  if (cron.trim().split(/\s+/u).length !== 5) {
    return Result.fail("Cron expression must have exactly 5 fields: minute hour day month weekday");
  }
  const zone = DateTime.zoneMakeNamed(timezone);
  if (Option.isNone(zone)) {
    return Result.fail(`Unknown time zone: ${timezone}`);
  }
  const parsed = Cron.parse(cron, zone.value);
  if (Result.isFailure(parsed)) {
    return Result.fail(parsed.failure.message);
  }
  let previous = automationCronNext(parsed.success, SCHEDULE_GAP_EPOCH);
  for (let sample = 0; sample < SCHEDULE_GAP_SAMPLES; sample += 1) {
    const next = previous === null ? null : automationCronNext(parsed.success, previous);
    if (previous === null || next === null) {
      return Result.fail("Schedule never fires");
    }
    if (
      DateTime.toEpochMillis(next) - DateTime.toEpochMillis(previous) <
      AUTOMATION_SCHEDULE_MIN_GAP_MILLIS
    ) {
      return Result.fail("Schedule must leave at least 5 minutes between runs");
    }
    previous = next;
  }
  return Result.succeed(parsed.success);
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const AutomationCron = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export const AutomationTimezone = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const AutomationScheduleTrigger = Schema.Struct({
  type: Schema.Literal("schedule"),
  cron: AutomationCron,
  /** IANA zone name. Required: an absent zone would be a fixed UTC offset in effect/Cron and drift across DST. */
  timezone: AutomationTimezone,
}).check(
  Schema.makeFilter((trigger) => {
    const validated = validateAutomationCron(trigger.cron, trigger.timezone);
    return Result.isFailure(validated) ? validated.failure : true;
  }),
);
export type AutomationScheduleTrigger = typeof AutomationScheduleTrigger.Type;

/** `pull-request.merged` fires only for merges performed inside T3. */
export const AutomationEventName = Schema.Literals([
  "turn.completed",
  "turn.failed",
  "pull-request.merged",
]);
export type AutomationEventName = typeof AutomationEventName.Type;

export const AutomationEventTrigger = Schema.Struct({
  type: Schema.Literal("event"),
  event: AutomationEventName,
});
export type AutomationEventTrigger = typeof AutomationEventTrigger.Type;

export const AutomationWebhookTrigger = Schema.Struct({
  type: Schema.Literal("webhook"),
});
export type AutomationWebhookTrigger = typeof AutomationWebhookTrigger.Type;

export const AutomationGitBranch = TrimmedNonEmptyString.check(Schema.isMaxLength(255));

export const AutomationGitTrigger = Schema.Struct({
  type: Schema.Literal("git"),
  /** null = the project's default branch. */
  branch: Schema.NullOr(AutomationGitBranch),
});
export type AutomationGitTrigger = typeof AutomationGitTrigger.Type;

export const AutomationTrigger = Schema.Union([
  AutomationScheduleTrigger,
  AutomationEventTrigger,
  AutomationWebhookTrigger,
  AutomationGitTrigger,
]);
export type AutomationTrigger = typeof AutomationTrigger.Type;

export const AutomationTriggers = Schema.Array(AutomationTrigger).check(
  Schema.isMaxLength(AUTOMATION_MAX_TRIGGERS),
);
export type AutomationTriggers = typeof AutomationTriggers.Type;

// ---------------------------------------------------------------------------
// Automation (definition)
// ---------------------------------------------------------------------------

export const AutomationName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTOMATION_NAME_MAX_LENGTH),
);
export const AutomationPrompt = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(AUTOMATION_PROMPT_MAX_LENGTH),
);
export const AutomationWorkspace = Schema.Literals(["checkout", "worktree"]);
export type AutomationWorkspace = typeof AutomationWorkspace.Type;
export const AutomationMinIntervalSeconds = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(AUTOMATION_MIN_INTERVAL_MAX_SECONDS),
);
export const AutomationTimeoutMinutes = PositiveInt.check(
  Schema.isLessThanOrEqualTo(AUTOMATION_TIMEOUT_MAX_MINUTES),
);
export const AutomationWebhookToken = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const DEFAULT_AUTOMATION_WORKSPACE: AutomationWorkspace = "checkout";
export const DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS = 60;
export const DEFAULT_AUTOMATION_TIMEOUT_MINUTES = 120;

/** `createPullRequest` defaults from the workspace: a fresh worktree exists to land as a PR. */
export const automationCreatePullRequestDefault = (workspace: AutomationWorkspace): boolean =>
  workspace === "worktree";

/**
 * Fields a user or agent edits. Used with decode defaults by the create
 * command and MCP create tool; `AutomationPatch` is the all-optional twin.
 * `createPullRequest` has no static default — absent means "derive from
 * workspace" (see `automationCreatePullRequestDefault`).
 */
const AutomationEditableFieldsShape = {
  name: AutomationName,
  prompt: AutomationPrompt,
  triggers: AutomationTriggers,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** null = project default model, then the environment's default. */
  modelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  workspace: AutomationWorkspace.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AUTOMATION_WORKSPACE)),
  ),
  createPullRequest: Schema.optionalKey(Schema.Boolean),
  includeLastRunSummary: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  catchUpMissedRuns: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Debounce for event/git/webhook triggers only; schedules ignore it. */
  minIntervalSeconds: AutomationMinIntervalSeconds.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS)),
  ),
  timeoutMinutes: AutomationTimeoutMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AUTOMATION_TIMEOUT_MINUTES)),
  ),
} as const;

export const AutomationEditableFields = Schema.Struct(AutomationEditableFieldsShape);
export type AutomationEditableFields = typeof AutomationEditableFields.Type;

export const AutomationPatch = Schema.Struct({
  name: Schema.optionalKey(AutomationName),
  prompt: Schema.optionalKey(AutomationPrompt),
  triggers: Schema.optionalKey(AutomationTriggers),
  enabled: Schema.optionalKey(Schema.Boolean),
  modelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  workspace: Schema.optionalKey(AutomationWorkspace),
  createPullRequest: Schema.optionalKey(Schema.Boolean),
  includeLastRunSummary: Schema.optionalKey(Schema.Boolean),
  catchUpMissedRuns: Schema.optionalKey(Schema.Boolean),
  minIntervalSeconds: Schema.optionalKey(AutomationMinIntervalSeconds),
  timeoutMinutes: Schema.optionalKey(AutomationTimeoutMinutes),
});
export type AutomationPatch = typeof AutomationPatch.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  projectId: ProjectId,
  ...AutomationEditableFieldsShape,
  createPullRequest: Schema.Boolean,
  /** Server-minted while a webhook trigger exists; rotatable. */
  webhookToken: Schema.NullOr(AutomationWebhookToken).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** Thread that created it through the MCP toolkit. */
  sourceThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const AutomationRunStatus = Schema.Literals([
  "requested",
  "running",
  "completed",
  "failed",
  "interrupted",
  "skipped",
  "missed",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

/** Terminal statuses the server reports through `automation.run.finished`. */
export const AutomationRunFinishedStatus = Schema.Literals(["completed", "failed", "interrupted"]);
export type AutomationRunFinishedStatus = typeof AutomationRunFinishedStatus.Type;

export const AutomationWebhookPayload = Schema.String.check(
  Schema.isMaxLength(AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS),
);

export const AutomationRunTrigger = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("schedule"),
    scheduledFor: IsoDateTime,
    /** True when the scheduler caught up a missed window rather than firing on time. */
    catchUp: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("manual"),
    /** Thread whose agent pressed Run now through MCP; null for a user. */
    byThreadId: Schema.NullOr(ThreadId),
  }),
  Schema.Struct({
    type: Schema.Literal("event"),
    event: AutomationEventName,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("webhook"),
    deliveryId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    /** JSON text, truncated to `AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS`. */
    payload: Schema.NullOr(AutomationWebhookPayload),
  }),
  Schema.Struct({
    type: Schema.Literal("git"),
    branch: AutomationGitBranch,
    fromCommit: Schema.NullOr(TrimmedNonEmptyString),
    toCommit: TrimmedNonEmptyString,
  }),
]);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

export const AutomationRunSummary = Schema.String.check(
  Schema.isMaxLength(AUTOMATION_RUN_SUMMARY_MAX_CHARS),
);

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  status: AutomationRunStatus,
  trigger: AutomationRunTrigger,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  /** Failure, skip, or miss reason. */
  error: Schema.NullOr(Schema.String),
  /** Final assistant message of the run thread, trimmed. */
  summary: Schema.NullOr(AutomationRunSummary),
});
export type AutomationRun = typeof AutomationRun.Type;

/** Marker on a thread that belongs to an automation run. */
export const ThreadAutomationRun = Schema.Struct({
  automationId: AutomationId,
  runId: AutomationRunId,
});
export type ThreadAutomationRun = typeof ThreadAutomationRun.Type;

// ---------------------------------------------------------------------------
// Shell (what clients and the decider see)
// ---------------------------------------------------------------------------

export const AutomationActiveRun = Schema.Struct({
  runId: AutomationRunId,
  threadId: Schema.NullOr(ThreadId),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationActiveRun = typeof AutomationActiveRun.Type;

export const AutomationLastRun = Schema.Struct({
  runId: AutomationRunId,
  status: AutomationRunStatus,
  threadId: Schema.NullOr(ThreadId),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(AutomationRunSummary),
});
export type AutomationLastRun = typeof AutomationLastRun.Type;

export const automationWebhookPath = (automationId: AutomationId, token: string): string =>
  `/hooks/automations/${automationId}/${token}`;

export const AutomationShell = Schema.Struct({
  ...Automation.fields,
  /** null when paused or without a schedule trigger. */
  nextRunAt: Schema.NullOr(IsoDateTime),
  activeRun: Schema.NullOr(AutomationActiveRun),
  /** Most recent run with status outside {skipped, missed}, excluding the active one. */
  lastRun: Schema.NullOr(AutomationLastRun),
  /** Set on run-requested only; the debounce clock for event/git/webhook triggers. */
  lastRequestedAt: Schema.NullOr(IsoDateTime),
  /** Coalesced non-manual trigger waiting for the active run to finish. */
  pendingTrigger: Schema.NullOr(AutomationRunTrigger),
  consecutiveFailures: NonNegativeInt,
  runCount: NonNegativeInt,
  /** `/hooks/automations/<id>/<token>`; clients prefix their own httpBaseUrl. */
  webhookPath: Schema.NullOr(Schema.String),
});
export type AutomationShell = typeof AutomationShell.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const AutomationsOperation = Schema.Literals([
  "capability",
  "list",
  "get",
  "create",
  "update",
  "delete",
  "run-now",
  "list-runs",
  "get-run",
  "validate-schedule",
]);
export type AutomationsOperation = typeof AutomationsOperation.Type;

/** `message` is shown verbatim to agents (MCP) and users (RPC): keep it a plain sentence. */
export class AutomationsError extends Schema.TaggedErrorClass<AutomationsError>()(
  "AutomationsError",
  {
    operation: AutomationsOperation,
    automationId: Schema.optional(AutomationId),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// RPC (rpc.ts: automations.listRuns / automations.getRun)
// ---------------------------------------------------------------------------

export const AutomationsListRunsLimit = PositiveInt.check(
  Schema.isLessThanOrEqualTo(AUTOMATION_LIST_RUNS_MAX_LIMIT),
);

export const AutomationsListRunsInput = Schema.Struct({
  automationId: AutomationId,
  limit: AutomationsListRunsLimit.pipe(
    Schema.withDecodingDefault(Effect.succeed(AUTOMATION_LIST_RUNS_DEFAULT_LIMIT)),
  ),
  /** Opaque `nextCursor` from the previous page. */
  beforeCursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type AutomationsListRunsInput = typeof AutomationsListRunsInput.Type;

export const AutomationsListRunsResult = Schema.Struct({
  runs: Schema.Array(AutomationRun),
  nextCursor: Schema.NullOr(Schema.String),
});
export type AutomationsListRunsResult = typeof AutomationsListRunsResult.Type;

export const AutomationsGetRunInput = Schema.Struct({
  runId: AutomationRunId,
});
export type AutomationsGetRunInput = typeof AutomationsGetRunInput.Type;

export const AutomationsGetRunResult = Schema.NullOr(AutomationRun);
export type AutomationsGetRunResult = typeof AutomationsGetRunResult.Type;

// ---------------------------------------------------------------------------
// MCP tool I/O (toolkit `t3-code-automations`)
// ---------------------------------------------------------------------------

const AutomationIdInput = AutomationId.annotate({
  description: "Automation id from automations_list or automations_create.",
});

// An empty Struct also accepts primitives in Effect; MCP inputs must be objects.
export const AutomationsListInput = Schema.Record(Schema.String, Schema.Never).annotate({
  description: "No parameters. Lists the automations of the current thread's project.",
});
export type AutomationsListInput = typeof AutomationsListInput.Type;

export const AutomationsListResult = Schema.Struct({
  automations: Schema.Array(AutomationShell),
});
export type AutomationsListResult = typeof AutomationsListResult.Type;

export const AutomationsGetInput = Schema.Struct({
  automationId: AutomationIdInput,
});
export type AutomationsGetInput = typeof AutomationsGetInput.Type;

export const AutomationsGetResult = Schema.Struct({
  automation: AutomationShell,
  /** Newest first, at most 10. */
  runs: Schema.Array(AutomationRun),
});
export type AutomationsGetResult = typeof AutomationsGetResult.Type;

/**
 * Trigger as an agent writes it: `timezone` may be omitted and the server
 * fills its own zone before validating against `AutomationTrigger`.
 */
export const AutomationsToolTrigger = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("schedule"),
    cron: AutomationCron.annotate({
      description:
        "Five-field cron (minute hour day month weekday). Runs must be at least 5 minutes apart. Presets: hourly '0 * * * *', daily 09:00 '0 9 * * *', weekdays 09:00 '0 9 * * 1-5', Mondays 09:00 '0 9 * * 1'.",
    }),
    timezone: Schema.optional(
      AutomationTimezone.annotate({
        description: "IANA zone such as Europe/Berlin. Defaults to the server's zone.",
      }),
    ),
  }),
  AutomationEventTrigger.annotate({
    description:
      "Fires after a turn in this project completes or fails, or after a pull request is merged from inside T3 Code.",
  }),
  AutomationWebhookTrigger.annotate({
    description: "Fires on POST to the automation's webhook path; the server mints the token.",
  }),
  AutomationGitTrigger.annotate({
    description:
      "Fires when the remote branch receives new commits (polled). branch null = the project's default branch.",
  }),
]);
export type AutomationsToolTrigger = typeof AutomationsToolTrigger.Type;

const AutomationsToolTriggers = Schema.Array(AutomationsToolTrigger)
  .check(Schema.isMaxLength(AUTOMATION_MAX_TRIGGERS))
  .annotate({ description: "Up to 8 triggers. Omit or pass [] for a manual-only automation." });

const AutomationsToolEditableFields = {
  name: AutomationName.annotate({ description: "Short display name, at most 120 characters." }),
  prompt: AutomationPrompt.annotate({
    description:
      "The full instructions the agent receives on every run. Write it for an unattended agent.",
  }),
  triggers: AutomationsToolTriggers,
  enabled: Schema.Boolean.annotate({
    description: "false creates the automation paused. Defaults to true.",
  }),
  modelSelection: Schema.NullOr(ModelSelection).annotate({
    description: "Model to run with; null uses the project default.",
  }),
  runtimeMode: RuntimeMode.annotate({
    description:
      "Permission mode for run threads. Cannot exceed the calling thread's mode; the server clamps it.",
  }),
  workspace: AutomationWorkspace.annotate({
    description:
      "'checkout' runs in the project checkout (default); 'worktree' creates a fresh worktree per run.",
  }),
  createPullRequest: Schema.Boolean.annotate({
    description:
      "Ask the agent to open a pull request when done. Defaults to true for worktree runs.",
  }),
  includeLastRunSummary: Schema.Boolean.annotate({
    description: "Append the previous run's final summary to the prompt. Defaults to false.",
  }),
  catchUpMissedRuns: Schema.Boolean.annotate({
    description:
      "Run once for a schedule window missed while the server was down. Defaults to true.",
  }),
  minIntervalSeconds: AutomationMinIntervalSeconds.annotate({
    description:
      "Debounce for event, git, and webhook triggers in seconds (0..86400). Defaults to 60.",
  }),
  timeoutMinutes: AutomationTimeoutMinutes.annotate({
    description: "Interrupt a run after this many minutes (1..1440). Defaults to 120.",
  }),
} as const;

export const AutomationsCreateInput = Schema.Struct({
  name: AutomationsToolEditableFields.name,
  prompt: AutomationsToolEditableFields.prompt,
  triggers: Schema.optional(AutomationsToolEditableFields.triggers),
  enabled: Schema.optional(AutomationsToolEditableFields.enabled),
  modelSelection: Schema.optional(AutomationsToolEditableFields.modelSelection),
  runtimeMode: Schema.optional(AutomationsToolEditableFields.runtimeMode),
  workspace: Schema.optional(AutomationsToolEditableFields.workspace),
  createPullRequest: Schema.optional(AutomationsToolEditableFields.createPullRequest),
  includeLastRunSummary: Schema.optional(AutomationsToolEditableFields.includeLastRunSummary),
  catchUpMissedRuns: Schema.optional(AutomationsToolEditableFields.catchUpMissedRuns),
  minIntervalSeconds: Schema.optional(AutomationsToolEditableFields.minIntervalSeconds),
  timeoutMinutes: Schema.optional(AutomationsToolEditableFields.timeoutMinutes),
}).annotate({
  description:
    "Creates an automation in the current project. Validate schedules with automations_validate_schedule first and show the user a summary before calling this.",
});
export type AutomationsCreateInput = typeof AutomationsCreateInput.Type;

export const AutomationsUpdateInput = Schema.Struct({
  automationId: AutomationIdInput,
  name: Schema.optional(AutomationsToolEditableFields.name),
  prompt: Schema.optional(AutomationsToolEditableFields.prompt),
  triggers: Schema.optional(AutomationsToolEditableFields.triggers),
  enabled: Schema.optional(AutomationsToolEditableFields.enabled),
  modelSelection: Schema.optional(AutomationsToolEditableFields.modelSelection),
  runtimeMode: Schema.optional(AutomationsToolEditableFields.runtimeMode),
  workspace: Schema.optional(AutomationsToolEditableFields.workspace),
  createPullRequest: Schema.optional(AutomationsToolEditableFields.createPullRequest),
  includeLastRunSummary: Schema.optional(AutomationsToolEditableFields.includeLastRunSummary),
  catchUpMissedRuns: Schema.optional(AutomationsToolEditableFields.catchUpMissedRuns),
  minIntervalSeconds: Schema.optional(AutomationsToolEditableFields.minIntervalSeconds),
  timeoutMinutes: Schema.optional(AutomationsToolEditableFields.timeoutMinutes),
  rotateWebhookToken: Schema.optional(
    Schema.Boolean.annotate({
      description: "Mint a new webhook token; the old webhook URL stops working immediately.",
    }),
  ),
}).annotate({
  description: "Updates only the fields provided; omitted fields keep their current values.",
});
export type AutomationsUpdateInput = typeof AutomationsUpdateInput.Type;

/** Shared by automations_create and automations_update. */
export const AutomationsMutationResult = Schema.Struct({
  automation: AutomationShell,
  /** Up to 5 upcoming schedule instants. */
  nextRuns: Schema.Array(IsoDateTime),
  webhookPath: Schema.NullOr(Schema.String),
  /** Guidance for the agent (webhook reachability, clamped runtime mode). */
  note: Schema.NullOr(Schema.String),
});
export type AutomationsMutationResult = typeof AutomationsMutationResult.Type;

export const AutomationsDeleteInput = Schema.Struct({
  automationId: AutomationIdInput,
}).annotate({
  description: "Deletes the automation and its run threads. Irreversible.",
});
export type AutomationsDeleteInput = typeof AutomationsDeleteInput.Type;

export const AutomationsDeleteResult = Schema.Struct({
  automationId: AutomationId,
});
export type AutomationsDeleteResult = typeof AutomationsDeleteResult.Type;

export const AutomationsRunNowInput = Schema.Struct({
  automationId: AutomationIdInput,
}).annotate({
  description: "Starts a run immediately, even when the automation is paused.",
});
export type AutomationsRunNowInput = typeof AutomationsRunNowInput.Type;

export const AutomationsRunNowResult = Schema.Struct({
  runId: AutomationRunId,
});
export type AutomationsRunNowResult = typeof AutomationsRunNowResult.Type;

export const AutomationsListRunsToolInput = Schema.Struct({
  automationId: AutomationIdInput,
  limit: Schema.optional(
    AutomationsListRunsLimit.annotate({
      description: "Newest runs to return (1..200). Defaults to 50.",
    }),
  ),
});
export type AutomationsListRunsToolInput = typeof AutomationsListRunsToolInput.Type;

export const AutomationsListRunsToolResult = Schema.Struct({
  runs: Schema.Array(AutomationRun),
});
export type AutomationsListRunsToolResult = typeof AutomationsListRunsToolResult.Type;

export const AutomationsValidateScheduleInput = Schema.Struct({
  cron: AutomationCron.annotate({ description: "Five-field cron expression to check." }),
  timezone: Schema.optional(
    AutomationTimezone.annotate({
      description: "IANA zone the schedule is evaluated in. Defaults to the server's zone.",
    }),
  ),
}).annotate({
  description: "Checks a cron expression and previews its next runs without creating anything.",
});
export type AutomationsValidateScheduleInput = typeof AutomationsValidateScheduleInput.Type;

export const AutomationsValidateScheduleResult = Schema.Struct({
  valid: Schema.Boolean,
  timezone: AutomationTimezone,
  nextRuns: Schema.Array(IsoDateTime),
  description: Schema.String,
  error: Schema.NullOr(Schema.String),
});
export type AutomationsValidateScheduleResult = typeof AutomationsValidateScheduleResult.Type;
