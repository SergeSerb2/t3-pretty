import {
  AutomationsCreateInput,
  AutomationsDeleteInput,
  AutomationsDeleteResult,
  AutomationsError,
  AutomationsGetInput,
  AutomationsGetResult,
  AutomationsListInput,
  AutomationsListResult,
  AutomationsListRunsToolInput,
  AutomationsListRunsToolResult,
  AutomationsMutationResult,
  AutomationsRunNowInput,
  AutomationsRunNowResult,
  AutomationsUpdateInput,
  AutomationsValidateScheduleInput,
  AutomationsValidateScheduleResult,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  Crypto.Crypto,
];

/** Reads never change anything and may be repeated freely. */
const readTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true) as T;

/** Writes; `destructive` marks the ones a user cannot undo. */
const writeTool = <T extends Tool.Any>(tool: T, destructive: boolean): T =>
  tool.annotate(Tool.Readonly, false).annotate(Tool.Destructive, destructive) as T;

export const AutomationsListTool = readTool(
  Tool.make("automations_list", {
    description:
      "List the automations of the current project: their prompts, triggers, next scheduled run, and the outcome of their last run. Start here before creating or changing anything, so you do not duplicate an automation that already exists.",
    parameters: AutomationsListInput,
    success: AutomationsListResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "List automations"),
);

export const AutomationsGetTool = readTool(
  Tool.make("automations_get", {
    description:
      "Read one automation of the current project together with its 10 most recent runs, including failures and their error text. Use it to explain why an automation is failing or when it will run next.",
    parameters: AutomationsGetInput,
    success: AutomationsGetResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Get an automation"),
);

export const AutomationsCreateTool = writeTool(
  Tool.make("automations_create", {
    description:
      "Create an automation in the current project: a prompt that runs unattended on a schedule, on an in-app event, on a webhook delivery, on a git remote change, or on demand. Call automations_validate_schedule first for any cron, pass the user's IANA time zone (schedules must leave at least 5 minutes between runs), and show the user what you are about to create. If the automation has a webhook trigger, the returned webhook path is only half a URL: ask the user which host of this machine the sender can reach and prefix it with that.",
    parameters: AutomationsCreateInput,
    success: AutomationsMutationResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Create an automation"),
  false,
);

export const AutomationsUpdateTool = writeTool(
  Tool.make("automations_update", {
    description:
      "Change an automation of the current project: pass only the fields you want to change, everything else keeps its current value. Pass enabled false to pause it and true to resume it. Validate any new cron with automations_validate_schedule first and keep the user's IANA time zone. Setting rotateWebhookToken true mints a new webhook path and immediately breaks the old one.",
    parameters: AutomationsUpdateInput,
    success: AutomationsMutationResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Update an automation"),
  false,
);

export const AutomationsDeleteTool = writeTool(
  Tool.make("automations_delete", {
    description:
      "Delete an automation of the current project and every thread its runs created. This cannot be undone, so ask the user first; pause it with automations_update instead when in doubt.",
    parameters: AutomationsDeleteInput,
    success: AutomationsDeleteResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Delete an automation"),
  true,
);

export const AutomationsRunNowTool = writeTool(
  Tool.make("automations_run_now", {
    description:
      "Start one run of an automation of the current project right now, even when it is paused. The run happens in its own thread; this tool returns as soon as the run is requested and does not wait for it. It fails when a run of that automation is already in progress.",
    parameters: AutomationsRunNowInput,
    success: AutomationsRunNowResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Run an automation now"),
  false,
);

export const AutomationsListRunsTool = readTool(
  Tool.make("automations_list_runs", {
    description:
      "List the most recent runs of one automation of the current project, newest first, with their status, trigger, thread, error and summary. Use it to report on what an automation has been doing.",
    parameters: AutomationsListRunsToolInput,
    success: AutomationsListRunsToolResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "List automation runs"),
);

export const AutomationsValidateScheduleTool = readTool(
  Tool.make("automations_validate_schedule", {
    description:
      "Check a five-field cron expression and preview its next 5 runs before you save it. Always call this before automations_create or an automations_update that changes a schedule. Pass the user's IANA time zone (for example Europe/Berlin); schedules must leave at least 5 minutes between runs.",
    parameters: AutomationsValidateScheduleInput,
    success: AutomationsValidateScheduleResult,
    failure: AutomationsError,
    dependencies,
  }).annotate(Tool.Title, "Validate a schedule"),
);

export const AutomationsToolkit = Toolkit.make(
  AutomationsListTool,
  AutomationsGetTool,
  AutomationsCreateTool,
  AutomationsUpdateTool,
  AutomationsDeleteTool,
  AutomationsRunNowTool,
  AutomationsListRunsTool,
  AutomationsValidateScheduleTool,
);
