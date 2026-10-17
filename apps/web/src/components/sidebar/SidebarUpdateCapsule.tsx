import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useServerUpdate } from "../ServerUpdateAction";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  describeUpdateCapsule,
  formatUpdateElapsed,
  RUN_STATUS_LABELS,
  resolveUpdateRunMachineStatus,
  type UpdateEverythingRun,
  type UpdateRunLocalState,
  type UpdateRunMachineView,
} from "./updateEverything.logic";
import {
  dismissSettledUpdateRunMachines,
  postponeUpdateRestart,
  retryFailedUpdateRunServers,
} from "./updateEverythingRun";

/** The current time, rounded down to `intervalMs` so it changes once per
    interval. With null it is read only when something else renders. */
function useNow(intervalMs: number | null): number {
  const step = intervalMs ?? 60_000;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (intervalMs === null) return () => {};
      const timer = setInterval(onChange, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / step) * step);
}

function useUpdateRunMachineViews(run: UpdateEverythingRun): ReadonlyArray<UpdateRunMachineView> {
  const viewsAtom = useMemo(
    () =>
      Atom.make((get) =>
        run.machines.map((machine) => ({
          machine,
          status: resolveUpdateRunMachineStatus(
            machine,
            run.phase,
            get(serverEnvironment.updateStateAtom(machine.environmentId)),
          ),
        })),
      ),
    [run],
  );
  return useAtomValue(viewsAtom);
}

function localStatusLabel(run: UpdateEverythingRun, local: UpdateRunLocalState, now: number) {
  if (run.phase === "countdown" && run.restartAt !== null) {
    return `restarts in ${Math.max(0, Math.ceil((run.restartAt - now) / 1000))}s`;
  }
  if (run.phase === "installing") return "restarting";
  if (local?.status === "downloading") {
    return `downloading${local.percent === null ? "" : ` ${Math.floor(local.percent)}%`}`;
  }
  return "restarts after the servers";
}

/**
 * The sidebar update button while an "update everything" pass runs. The rail
 * stacks the icon and compact progress; horizontal footers show the full
 * status inline. Click it for every machine and the rail's actions.
 * Time labels change once a second only during the
 * countdown, and otherwise once every 30 seconds.
 */
export function SidebarUpdateCapsule({
  run,
  local,
  icon,
  onRestart,
  vertical = false,
}: {
  readonly run: UpdateEverythingRun;
  readonly local: UpdateRunLocalState;
  readonly icon: ReactNode;
  readonly vertical?: boolean;
  /** Installs this app's downloaded update after the user postponed it. */
  readonly onRestart?: () => Promise<void>;
}) {
  const machines = useUpdateRunMachineViews(run);
  const hasActiveMachine = machines.some(
    ({ status }) => status !== "done" && status !== "failed" && status !== "waiting",
  );
  const now = useNow(run.phase === "countdown" ? 1_000 : hasActiveMachine ? 30_000 : null);
  const view = describeUpdateCapsule(run, machines, local, now);
  const updateServer = useServerUpdate();
  const failed = machines.some(({ status }) => status === "failed");
  const settled = !hasActiveMachine && run.localVersion === null;
  const statusLabel = view.slow
    ? `${view.label} ${view.slow.status} ${view.slow.elapsed}`
    : view.label;

  const actionLabel =
    view.action === "later" ? "Later" : view.action === "retry" ? "Retry" : "Dismiss";
  const runAction = () => {
    if (view.action === "later") postponeUpdateRestart();
    else if (view.action === "retry") retryFailedUpdateRunServers(updateServer);
    else dismissSettledUpdateRunMachines();
  };

  return (
    <Popover>
      <div
        className={cn(
          "relative flex min-w-0 items-center bg-sidebar-control-surface text-sidebar-foreground",
          vertical
            ? "w-8 shrink-0 flex-col rounded-[var(--control-radius)] pb-1"
            : "h-8 flex-1 rounded-full",
          view.tone === "slow" && "ring-1 ring-warning/40 ring-inset",
          view.tone === "failed" && "ring-1 ring-destructive/40 ring-inset",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label={statusLabel}
                    className="absolute inset-0 cursor-pointer rounded-[inherit] outline-hidden ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset"
                  />
                }
              />
            }
          />
          <TooltipPopup side={vertical ? "right" : "top"}>{statusLabel}</TooltipPopup>
        </Tooltip>
        {vertical ? (
          <>
            {/* The update button's full slot, so the icon and its download
                ring stay put when a run starts and only the label grows below. */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none relative grid size-8 shrink-0 place-items-center",
                view.tone === "slow" && "text-warning",
                view.tone === "failed" && "text-destructive",
              )}
            >
              {view.tone === "default" ? icon : <TriangleAlertIcon className="size-4" />}
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none relative max-w-full truncate text-2xs leading-3 tabular-nums"
            >
              {view.compactLabel}
            </span>
          </>
        ) : (
          <>
            <span className="pointer-events-none relative min-w-0 flex-1 truncate pl-3 text-xs">
              <span className={cn(view.tone === "failed" && "text-destructive")}>{view.label}</span>
              {view.slow ? (
                <span className="text-warning tabular-nums"> {view.slow.elapsed}</span>
              ) : null}
            </span>
            {/* The footer leaves little room, so an action takes the icon's place. */}
            {view.action !== null ? (
              <button
                type="button"
                className="relative shrink-0 cursor-pointer pr-3 pl-1.5 text-xs underline decoration-muted-foreground/60 underline-offset-3 hover:decoration-current"
                onClick={runAction}
              >
                {actionLabel}
              </button>
            ) : (
              <span className="pointer-events-none relative grid size-8 shrink-0 place-items-center">
                {icon}
              </span>
            )}
          </>
        )}
      </div>
      <PopoverPopup side={vertical ? "right" : "top"} align="end" padding="compact" width="sm">
        <div className="flex flex-col gap-1 text-xs">
          {vertical ? <div className="mb-1 font-medium">{statusLabel}</div> : null}
          {run.localVersion !== null ? (
            <div className="flex items-center justify-between gap-3">
              <span>This app</span>
              <span className="text-muted-foreground tabular-nums">
                {localStatusLabel(run, local, now)}
              </span>
            </div>
          ) : onRestart ? (
            <div className="flex items-center justify-between gap-3">
              <span>This app</span>
              <Button size="xs" variant="outline" onClick={() => void onRestart()}>
                Restart to update
              </Button>
            </div>
          ) : null}
          {machines.map(({ machine, status }) => (
            <div key={machine.environmentId} className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{machine.label}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {RUN_STATUS_LABELS[status]}
                  {status !== "done" && status !== "failed" && status !== "waiting"
                    ? ` ${formatUpdateElapsed(now - machine.startedAt)}`
                    : ""}
                </span>
              </div>
              {machine.failure !== null ? (
                <span className="break-words text-muted-foreground">{machine.failure}</span>
              ) : null}
            </div>
          ))}
          {view.action !== null && (vertical || (settled && failed)) ? (
            <div className="mt-1 flex justify-end gap-1">
              {view.action !== "dismiss" ? (
                <Button size="xs" variant="outline" onClick={runAction}>
                  {actionLabel}
                </Button>
              ) : null}
              {view.action !== "later" ? (
                <Button size="xs" variant="ghost" onClick={dismissSettledUpdateRunMachines}>
                  Dismiss
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
