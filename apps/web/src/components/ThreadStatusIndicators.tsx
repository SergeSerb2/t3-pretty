import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { pullRequestDetailToVcsStatus } from "@t3tools/client-runtime/state/pull-requests";
import {
  type EnvironmentId,
  resolveEnvironmentMachineKind,
  type ThreadLinkedPullRequest,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { FolderGit2Icon, TerminalIcon } from "lucide-react";
import { useMemo } from "react";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { useEnvironmentQuery } from "../state/query";
import { StatusPulseDot, useStatusPulse } from "../hooks/useStatusPulse";
import { linkedPullRequestDetailAtom, useSharedPullRequestSummary } from "../state/pullRequests";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useUiStateStore } from "../uiStateStore";
import { resolveChangeRequestPresentation } from "../sourceControlPresentation";
import { resolveThreadStatusPill, type ThreadStatusPill } from "./Sidebar.logic";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
import type { SidebarThreadSummary } from "../types";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Run-status vocabulary shared by the Agents panel and automation rows.
 * In-flight subagent states all present as Working (detail belongs in the
 * activity sub-line); only settled states differentiate. The automation keys
 * extend the table with the states a scheduled run can be in.
 */
export type StatusVisualKey =
  | RuntimeSubagent["status"]
  | "attention"
  | "paused"
  | "ready"
  | "skipped"
  | "missed";

export const STATUS_VISUALS: Record<StatusVisualKey, { dotClass: string; label: string }> = {
  pending: { dotClass: "bg-info", label: "Working" },
  running: { dotClass: "bg-info", label: "Working" },
  waiting: { dotClass: "bg-info", label: "Working" },
  // Idle reads as settled (muted, not sky): a resting Codex child looks done
  // unless resumed — live-test: sky idle dots read as stuck in-progress.
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle · resumable" },
  completed: { dotClass: "bg-success", label: "Completed" },
  failed: { dotClass: "bg-destructive", label: "Failed" },
  cancelled: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  interrupted: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  attention: { dotClass: "bg-warning", label: "Needs attention" },
  paused: { dotClass: "bg-muted-foreground/40", label: "Paused" },
  ready: { dotClass: "bg-success", label: "Ready" },
  skipped: { dotClass: "bg-muted-foreground/40", label: "Skipped" },
  missed: { dotClass: "bg-muted-foreground/40", label: "Missed" },
};

export function StatusDot({ status, className }: { status: StatusVisualKey; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_VISUALS[status].dotClass, className)}
    />
  );
}

export interface PrStatusIndicator {
  label: string;
  colorClass: string;
  tooltip: string;
  tooltipLead: string;
  tooltipTitle: string;
  url: string;
  automatedReview: AutomatedReviewIndicator | null;
}

export interface AutomatedReviewIndicator {
  state: NonNullable<NonNullable<ThreadPr>["automatedReview"]>["state"] | "no_signal";
  label: string;
  shortLabel: string;
  description: string;
  colorClass: string;
}

export interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

export type ThreadPr = VcsStatusResult["pr"];

export function automatedReviewIndicator(
  signal: NonNullable<ThreadPr>["automatedReview"],
): AutomatedReviewIndicator | null {
  const presentation = resolveAutomatedReviewPresentation(signal);
  if (presentation === null) return null;
  const state = signal?.state ?? "no_signal";
  const colorClass =
    state === "reviewing"
      ? "text-sky-600 dark:text-sky-300"
      : state === "passed"
        ? "text-emerald-600 dark:text-emerald-300"
        : state === "feedback"
          ? "text-amber-700 dark:text-amber-300"
          : "text-muted-foreground/55";
  return { state, colorClass, ...presentation };
}

export interface LinkedThreadPullRequestStatus {
  readonly pr: NonNullable<ThreadPr>;
  readonly sourceControlProvider: NonNullable<VcsStatusResult["sourceControlProvider"]>;
}

/** Keep cached summaries visible when an offscreen row stops live queries. */
export function useLinkedThreadPullRequest(
  environmentId: EnvironmentId | null,
  linkedPullRequest: ThreadLinkedPullRequest | null | undefined,
  enabled = true,
): LinkedThreadPullRequestStatus | null {
  const queried = useEnvironmentQuery(
    !enabled || environmentId === null || linkedPullRequest == null
      ? null
      : linkedPullRequestDetailAtom({
          environmentId,
          input: {
            projectId: linkedPullRequest.projectId,
            repository: linkedPullRequest.repository,
            number: linkedPullRequest.number,
          },
        }),
  ).data;
  const detail = useSharedPullRequestSummary(environmentId, linkedPullRequest ?? null, queried);

  return useMemo(
    () =>
      detail === null
        ? null
        : {
            pr: pullRequestDetailToVcsStatus(detail),
            sourceControlProvider: {
              kind: detail.provider,
              name: detail.provider,
              baseUrl: "",
            },
          },
    [detail],
  );
}
export function settledPrHoverColorClass(
  state: NonNullable<ThreadPr>["state"],
  isDraft = false,
): string {
  switch (state) {
    case "open":
      if (isDraft) {
        return "group-hover/v2-row:text-zinc-500 dark:group-hover/v2-row:text-zinc-400/80";
      }
      return "group-hover/v2-row:text-emerald-600 dark:group-hover/v2-row:text-emerald-300/90";
    case "merged":
      return "group-hover/v2-row:text-violet-600 dark:group-hover/v2-row:text-violet-300/90";
    case "closed":
      return "group-hover/v2-row:text-red-600 dark:group-hover/v2-row:text-red-300/90";
  }
}

export function prStatusIndicator(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
): PrStatusIndicator | null {
  function formatPrState(pr: NonNullable<ThreadPr>): string {
    if (pr.state === "open" && pr.isDraft === true) return "Draft";
    return pr.state.charAt(0).toUpperCase() + pr.state.slice(1);
  }

  function formatPrStatusLead(pr: NonNullable<ThreadPr>, changeRequestShortName: string): string {
    return `${changeRequestShortName} #${pr.number} - ${formatPrState(pr)}`;
  }
  if (!pr) return null;
  const presentation = resolveChangeRequestPresentation(provider);

  const tooltipLead = formatPrStatusLead(pr, presentation.shortName);
  const automatedReview = automatedReviewIndicator(pr.automatedReview);
  const tooltip = `${tooltipLead}: ${pr.title}${automatedReview ? `. ${automatedReview.label}.` : ""}`;

  if (pr.state === "open") {
    const isDraft = pr.isDraft === true;
    return {
      label: `${presentation.shortName} ${isDraft ? "draft" : "open"}`,
      colorClass: isDraft
        ? "text-zinc-500 dark:text-zinc-400/80"
        : "text-emerald-600 dark:text-emerald-300/90",
      tooltip,
      tooltipLead,
      tooltipTitle: pr.title,
      url: pr.url,
      automatedReview,
    };
  }
  if (pr.state === "closed") {
    return {
      label: `${presentation.shortName} closed`,
      colorClass: "text-red-600 dark:text-red-300/90",
      tooltip,
      tooltipLead,
      tooltipTitle: pr.title,
      url: pr.url,
      automatedReview,
    };
  }
  if (pr.state === "merged") {
    return {
      label: `${presentation.shortName} merged`,
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip,
      tooltipLead,
      tooltipTitle: pr.title,
      url: pr.url,
      automatedReview,
    };
  }
  return null;
}

export function AutomatedReviewStatusIcon({
  status,
  className,
}: {
  status: AutomatedReviewIndicator;
  className?: string | undefined;
}) {
  const Icon =
    status.state === "reviewing"
      ? EyeIcon
      : status.state === "passed"
        ? CheckIcon
        : status.state === "feedback"
          ? MessageSquareWarningIcon
          : status.state === "stale"
            ? HistoryIcon
            : CircleDashedIcon;
  return <Icon aria-hidden="true" className={`${className ?? "size-3"} ${status.colorClass}`} />;
}

export function ChangeRequestStatusIcon({
  state,
  isDraft = false,
  className,
}: Pick<NonNullable<ThreadPr>, "state"> & {
  readonly isDraft?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const presentation = resolvePullRequestState({ state, isDraft });
  return <presentation.Icon aria-hidden="true" className={className} />;
}

export function PrStatusTooltipContent({ status }: { status: PrStatusIndicator }) {
  return (
    <span className="flex max-w-[min(34rem,calc(100vw-2rem))] flex-col gap-1.5 overflow-hidden">
      <span className="flex items-stretch whitespace-nowrap">
        <span className="shrink-0 pr-2 font-medium">{status.tooltipLead}</span>
        <span className="min-h-4 shrink-0 border-border/70 border-l" aria-hidden="true" />
        <span className="min-w-0 truncate pl-2">{status.tooltipTitle}</span>
      </span>
      {status.automatedReview ? (
        <span className="flex items-start gap-1.5 whitespace-normal text-xs leading-snug">
          <AutomatedReviewStatusIcon
            status={status.automatedReview}
            className="mt-px size-3 shrink-0"
          />
          <span>
            <span className="font-medium">{status.automatedReview.label}.</span>{" "}
            <span className="text-muted-foreground">{status.automatedReview.description}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function terminalStatusFromRunningIds(
  runningTerminalIds: ReadonlyArray<string>,
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

export function ThreadWorktreeIndicator({
  thread,
}: {
  thread: Pick<SidebarThreadSummary, "id" | "branch" | "worktreePath">;
}) {
  const worktreePath = thread.worktreePath?.trim();
  if (!worktreePath) {
    return null;
  }

  const displayPath = formatWorktreePathForDisplay(worktreePath);
  const tooltip = thread.branch
    ? `Worktree: ${displayPath} (${thread.branch})`
    : `Worktree: ${displayPath}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={tooltip}
            data-testid={`thread-worktree-${thread.id}`}
            className="inline-flex items-center justify-center"
          />
        }
      >
        <FolderGit2Icon className="size-3 text-muted-foreground/40" />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export function ThreadStatusLabel({
  status,
  compact = false,
}: {
  status: ThreadStatusPill;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={status.label}
              className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
            />
          }
        >
          <StatusPulseDot active={status.pulse} className={`size-[9px] ${status.dotClass}`} />
        </TooltipTrigger>
        <TooltipPopup side="top">{status.label}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={status.label}
            className={`inline-flex items-center gap-1 text-[10px] ${status.colorClass}`}
          />
        }
      >
        <StatusPulseDot active={status.pulse} className={`h-1.5 w-1.5 ${status.dotClass}`} />
        <span className="hidden md:inline">{status.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Non-interactive leading status icons for a thread row in compact contexts
 * like the command palette. Shows the change request state icon (if present) and the
 * thread status dot, matching the sidebar's leading indicators.
 */
export function ThreadRowLeadingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const pullRequest = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest ?? thread.branchPullRequest,
  );
  const pr = pullRequest?.pr ?? null;
  const prStatus = prStatusIndicator(pr, pullRequest?.sourceControlProvider);
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });

  if (!prStatus && !threadStatus) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {prStatus && pr ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={prStatus.tooltip}
                className={`inline-flex items-center justify-center ${prStatus.colorClass}`}
              />
            }
          >
            <ChangeRequestStatusIcon state={pr.state} isDraft={pr.isDraft} className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <PrStatusTooltipContent status={prStatus} />
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {threadStatus ? <ThreadStatusLabel status={threadStatus} /> : null}
    </span>
  );
}

/**
 * Non-interactive trailing status icons for a thread row in compact contexts
 * like the command palette. Shows a terminal-running indicator and a remote
 * environment indicator, matching the sidebar's trailing indicators.
 */
export function ThreadRowTrailingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const environment = useEnvironment(thread.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  // No primary (the hosted app) means every thread is remote, and the machine
  // glyph is what tells the environments apart.
  const isRemoteThread = thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = environment?.label ?? null;
  const threadEnvironmentLabel = isRemoteThread ? (remoteEnvLabel ?? "Remote") : null;
  const remoteMachine = resolveEnvironmentMachineKind(environment?.serverConfig ?? null);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  useStatusPulse(terminalStatus?.pulse === true);

  if (!terminalStatus && !isRemoteThread) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {terminalStatus ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={terminalStatus.label}
                className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
              />
            }
          >
            <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "status-pulse" : ""}`} />
          </TooltipTrigger>
          <TooltipPopup side="top">{terminalStatus.label}</TooltipPopup>
        </Tooltip>
      ) : null}
      {isRemoteThread ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={threadEnvironmentLabel ?? "Remote"}
                className="inline-flex items-center justify-center"
              />
            }
          >
            <EnvironmentMachineIcon
              kind={remoteMachine}
              className="size-3 text-muted-foreground/60"
            />
          </TooltipTrigger>
          <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}
