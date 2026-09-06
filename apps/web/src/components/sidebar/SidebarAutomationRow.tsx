/**
 * One automation on the sidebar shelf: a slim row (status dot, name,
 * project, countdown) that unfolds into its last five runs. Rows are memoized
 * and containment-sized like thread rows; the only thing that pulses is the
 * dot while a run is active, on the shared ticker.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  AutomationStatus,
  EnvironmentAutomation,
  ScopedAutomationRef,
} from "@t3tools/client-runtime/state/automations";
import { formatUntilLabel } from "@t3tools/client-runtime/state/automations";
import { AUTOMATION_LIST_RUNS_DEFAULT_LIMIT, type AutomationRun } from "@t3tools/contracts";
import type {
  ContextMenuPosition,
  EnvironmentId,
  ProjectIconOverride,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { automationRunTriggerLabel } from "@t3tools/shared/automationSchedule";
import { ChevronRightIcon } from "lucide-react";
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { StatusPulseDot } from "../../hooks/useStatusPulse";
import { cn } from "../../lib/utils";
import { formatDuration } from "../../session-logic";
import { automationEnvironment } from "../../state/automations";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { STATUS_VISUALS, StatusDot } from "../ThreadStatusIndicators";
import { AutomationTriggerIcon } from "../automations/AutomationTriggerIcon";
import {
  automationRunDurationMs,
  automationRunStatusVisual,
  automationStatusVisual,
} from "../automations/automations.logic";

const SHELF_RUN_COUNT = 5;

export interface SidebarAutomationRowProps {
  automation: EnvironmentAutomation;
  status: AutomationStatus;
  isActive: boolean;
  expanded: boolean;
  /** Minute-quantized clock from the sidebar; drives the countdown label. */
  nowMs: number;
  projectTitle: string | null;
  projectCwd: string | null;
  projectFaviconPath: string | null;
  projectIcon: ProjectIconOverride | null;
  /** Shown only when the sidebar scope spans every project. */
  environmentLabel: string | null;
  onOpen: (ref: ScopedAutomationRef) => void;
  onToggleExpanded: (ref: ScopedAutomationRef) => void;
  onContextMenu: (ref: ScopedAutomationRef, position: ContextMenuPosition) => void;
  onOpenThread: (ref: ScopedThreadRef) => void;
}

function trailingLabel(automation: EnvironmentAutomation, status: AutomationStatus, nowMs: number) {
  if (status === "running") return { text: "Running", className: "text-info" };
  if (status === "needs-attention") return { text: "Needs input", className: "text-warning" };
  if (!automation.enabled) return { text: "Paused", className: "text-secondary-label" };
  if (automation.nextRunAt !== null) {
    return {
      text: formatUntilLabel(automation.nextRunAt, nowMs),
      className: "text-secondary-label",
    };
  }
  return null;
}

export const SidebarAutomationRow = memo(function SidebarAutomationRow(
  props: SidebarAutomationRowProps,
) {
  const { automation, status } = props;
  const ref: ScopedAutomationRef = {
    environmentId: automation.environmentId,
    automationId: automation.id,
  };
  const visual = automationStatusVisual(status);
  const trailing = trailingLabel(automation, status, props.nowMs);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onOpen(ref);
    } else if (event.key === "ArrowRight" && !props.expanded) {
      event.preventDefault();
      props.onToggleExpanded(ref);
    } else if (event.key === "ArrowLeft" && props.expanded) {
      event.preventDefault();
      props.onToggleExpanded(ref);
    }
  };
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    props.onContextMenu(ref, { x: event.clientX, y: event.clientY });
  };

  return (
    <li
      data-automation-item
      data-thread-selection-safe
      className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_34px]"
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="sidebar-automation-row"
        aria-label={`${automation.name}, ${STATUS_VISUALS[visual].label}`}
        className={cn(
          "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
          props.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
        onClick={() => props.onOpen(ref)}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          aria-label={props.expanded ? "Hide recent runs" : "Show recent runs"}
          aria-expanded={props.expanded}
          tabIndex={-1}
          className="-ml-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleExpanded(ref);
          }}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3.5 transition-transform", props.expanded && "rotate-90")}
          />
        </button>
        {status === "running" ? (
          <StatusPulseDot className={cn("size-1.5 shrink-0", STATUS_VISUALS.running.dotClass)} />
        ) : (
          <StatusDot status={visual} />
        )}
        <ProjectFavicon
          environmentId={automation.environmentId}
          cwd={props.projectCwd ?? ""}
          projectName={props.projectTitle ?? ""}
          faviconPath={props.projectFaviconPath}
          projectIcon={props.projectIcon}
          className="size-4 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-sm">{automation.name}</span>
        {props.environmentLabel ? (
          <span className="max-w-24 shrink truncate text-xs text-secondary-label">
            {props.environmentLabel}
          </span>
        ) : null}
        {trailing ? (
          <span className={cn("shrink-0 text-xs tabular-nums", trailing.className)}>
            {trailing.text}
          </span>
        ) : null}
      </div>
      {props.expanded ? (
        <SidebarAutomationRuns
          automation={automation}
          nowMs={props.nowMs}
          onOpen={props.onOpen}
          onOpenThread={props.onOpenThread}
        />
      ) : null}
    </li>
  );
});

function SidebarAutomationRuns({
  automation,
  nowMs,
  onOpen,
  onOpenThread,
}: {
  automation: EnvironmentAutomation;
  nowMs: number;
  onOpen: (ref: ScopedAutomationRef) => void;
  onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  // The first page is what the automation page renders too, so the two
  // surfaces share one cached query; the shelf just shows its head.
  const page = useEnvironmentQuery(
    automationEnvironment.listRuns({
      environmentId: automation.environmentId,
      input: { automationId: automation.id, limit: AUTOMATION_LIST_RUNS_DEFAULT_LIMIT },
    }),
  );
  const runs = (page.data?.runs ?? []).slice(0, SHELF_RUN_COUNT);
  return (
    <ul
      role="list"
      className="mb-1 ml-5 flex flex-col gap-px border-l border-sidebar-border/60 pl-2"
    >
      {page.isPending && runs.length === 0 ? (
        <li className="px-2 py-1 text-xs text-secondary-label">Loading runs…</li>
      ) : runs.length === 0 ? (
        <li className="px-2 py-1 text-xs text-secondary-label">No runs yet</li>
      ) : (
        runs.map((run) => (
          <SidebarAutomationRunRow
            key={run.id}
            environmentId={automation.environmentId}
            run={run}
            nowMs={nowMs}
            onOpenThread={onOpenThread}
          />
        ))
      )}
      <li>
        <button
          type="button"
          className="w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-secondary-label hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={() =>
            onOpen({ environmentId: automation.environmentId, automationId: automation.id })
          }
        >
          View all
        </button>
      </li>
    </ul>
  );
}

const SidebarAutomationRunRow = memo(function SidebarAutomationRunRow({
  environmentId,
  run,
  nowMs,
  onOpenThread,
}: {
  environmentId: EnvironmentId;
  run: AutomationRun;
  nowMs: number;
  onOpenThread: (ref: ScopedThreadRef) => void;
}) {
  // Point read off the unfiltered index so only this run's own thread
  // re-renders the row, never another thread's streaming tokens.
  const threadRef = run.threadId === null ? null : scopeThreadRef(environmentId, run.threadId);
  const hasThread = useThreadShell(threadRef) !== null;
  const failed = run.status === "failed";
  const duration = automationRunDurationMs(run, nowMs);
  const removed = threadRef !== null && !hasThread;
  const detail = [run.error ?? run.summary, removed ? "Thread removed" : null]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        disabled={!hasThread}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left",
          hasThread
            ? "cursor-pointer hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            : "cursor-default",
          failed ? "text-destructive" : "text-sidebar-foreground/80",
        )}
        onClick={() => {
          if (threadRef !== null && hasThread) onOpenThread(threadRef);
        }}
      >
        <span className="flex items-center gap-1.5 text-xs">
          <StatusDot status={automationRunStatusVisual(run.status)} />
          <AutomationTriggerIcon type={run.trigger.type} className="size-3 shrink-0 opacity-70" />
          <span className="min-w-0 truncate">{automationRunTriggerLabel(run.trigger)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-secondary-label">
            {formatRelativeTimeLabel(run.requestedAt)}
            {duration !== null ? ` · ${formatDuration(duration)}` : ""}
          </span>
        </span>
        {detail ? (
          <span className={cn("truncate text-xs", failed ? "" : "text-secondary-label")}>
            {detail}
          </span>
        ) : null}
      </button>
    </li>
  );
});
