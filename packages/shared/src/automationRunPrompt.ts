/**
 * Hidden run-context block appended after an automation's prompt when the
 * scheduler starts a run thread. It travels as plain user-message text so it
 * behaves identically across providers; the marker tags let every surface
 * strip it (see hiddenInstructionBlocks.ts). The ChatView banner carries the
 * human-readable version, so nothing here is rendered to the user.
 */
import type {
  AutomationEventName,
  AutomationRunId,
  AutomationRunTrigger,
  IsoDateTime,
} from "@t3tools/contracts";
import {
  hasHiddenInstructionSuffix,
  hiddenInstructionCloseMarker,
  hiddenInstructionOpenMarker,
} from "./hiddenInstructionBlocks.ts";

export const AUTOMATION_RUN_TAG = "automation_run";
export const AUTOMATION_RUN_OPEN_MARKER = hiddenInstructionOpenMarker(AUTOMATION_RUN_TAG);
export const AUTOMATION_RUN_CLOSE_MARKER = hiddenInstructionCloseMarker(AUTOMATION_RUN_TAG);

export interface AutomationRunSuffixInput {
  readonly automationName: string;
  readonly projectTitle: string;
  readonly runId: AutomationRunId;
  readonly trigger: AutomationRunTrigger;
  readonly startedAt: IsoDateTime;
  readonly previousRunSummary?: {
    readonly finishedAt: IsoDateTime;
    readonly summary: string;
  } | null;
}

const shortCommit = (commit: string) => commit.slice(0, 7);

const EVENT_DESCRIPTIONS: Record<AutomationEventName, string> = {
  "turn.completed": "a completed turn",
  "turn.failed": "a failed turn",
  "pull-request.merged": "a pull request merged from inside T3 Code",
};

/** Prose the agent reads: "triggered by …". */
function describeTrigger(trigger: AutomationRunTrigger): string {
  switch (trigger.type) {
    case "schedule":
      return trigger.catchUp
        ? `its schedule, catching up a run that was due at ${trigger.scheduledFor} while the server was unavailable`
        : `its schedule (due at ${trigger.scheduledFor})`;
    case "manual":
      return trigger.byThreadId === null
        ? "a user pressing Run now"
        : `an agent in thread ${trigger.byThreadId} pressing Run now`;
    case "event":
      return `${EVENT_DESCRIPTIONS[trigger.event]} (thread ${trigger.threadId})`;
    case "webhook":
      return `a webhook delivery (${trigger.deliveryId})`;
    case "git":
      return `new commits on ${trigger.branch} (${trigger.fromCommit === null ? "first observation" : shortCommit(trigger.fromCommit)} -> ${shortCommit(trigger.toCommit)})`;
  }
}

/**
 * The block text, including the leading blank lines that separate it from
 * the automation's prompt. Webhook payloads are fenced as JSON so the agent
 * treats them as data, not instructions.
 */
export function buildAutomationRunSuffix(input: AutomationRunSuffixInput): string {
  const sections = [
    `You are running unattended as the automation "${input.automationName}" for project ${input.projectTitle} (run ${input.runId}, started ${input.startedAt}, triggered by ${describeTrigger(input.trigger)}). Nobody is watching: do not ask questions unless you are truly blocked; make reasonable assumptions and say so. When you are done, end with a short plain-language summary of what you did and anything that needs a human.`,
  ];
  const previous = input.previousRunSummary;
  if (previous && previous.summary.trim().length > 0) {
    sections.push(`Previous run (${previous.finishedAt}) summary:\n${previous.summary.trim()}`);
  }
  if (input.trigger.type === "webhook" && input.trigger.payload !== null) {
    sections.push(`Webhook payload:\n\`\`\`json\n${input.trigger.payload}\n\`\`\``);
  }
  return `

${AUTOMATION_RUN_OPEN_MARKER}
${sections.join("\n\n")}
${AUTOMATION_RUN_CLOSE_MARKER}`;
}

/** Appends the run block once; re-applying to text that already carries it is a no-op. */
export function applyAutomationRunSuffix(text: string, input: AutomationRunSuffixInput): string {
  return hasHiddenInstructionSuffix(text, AUTOMATION_RUN_TAG)
    ? text
    : text + buildAutomationRunSuffix(input);
}
