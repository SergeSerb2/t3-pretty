/**
 * Full main-pane view of one automation: header controls, summary strip,
 * read-only config, and the condensed run history. Everything live comes from
 * the shell row; the run list is paged over `automations.listRuns` and
 * concatenated before grouping so day groups survive page boundaries.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  automationStatus,
  condenseAutomationRunGroup,
  formatUntilLabel,
  groupAutomationRunsByDay,
  type AutomationRunRow,
  type EnvironmentAutomation,
} from "@t3tools/client-runtime/state/automations";
import {
  AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
  ProviderDriverKind,
  type AutomationId,
  type AutomationRun,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { automationRunTriggerLabel } from "@t3tools/shared/automationSchedule";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import * as Option from "effect/Option";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { subscribeSecondTick } from "../../lib/secondTicker";
import { cn } from "../../lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { formatDuration } from "../../session-logic";
import { automationEnvironment } from "../../state/automations";
import { useAutomationShell, useProject, useThreadShell } from "../../state/entities";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveRuntimeModeOption } from "../chat/runtimeModeOptions";
import { settingsEscapeAction } from "../settings/settingsEscape";
import { STATUS_VISUALS, StatusDot } from "../ThreadStatusIndicators";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { AutomationDeleteDialog } from "./AutomationDeleteDialog";
import { AutomationEditorDialog } from "./AutomationEditorDialog";
import { AutomationTriggerIcon } from "./AutomationTriggerIcon";
import {
  WEBHOOK_LOOPBACK_NOTE,
  automationRunDurationMs,
  automationRunStatusVisual,
  automationStatusVisual,
  collapsedRunRowLabel,
  composeWebhookUrl,
  describeAutomationTrigger,
  isLoopbackUrl,
} from "./automations.logic";
import { useAutomationActions } from "./useAutomationActions";

type RunsPageResult =
  ReturnType<typeof automationEnvironment.listRuns> extends Atom.Atom<infer R> ? R : never;
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

export function AutomationPage({
  environmentId,
  automationId,
}: {
  environmentId: EnvironmentId;
  automationId: AutomationId;
}) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const automation = useAutomationShell({ environmentId, automationId });
  const environment = useEnvironment(environmentId);

  const navigateBack = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      const action = settingsEscapeAction(document.activeElement);
      if (action === "ignore") return;
      event.preventDefault();
      if (action === "blur" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
        return;
      }
      navigateBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBack]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Automation breadcrumb">
            <WorkspaceBreadcrumbItem>Automations</WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current>
              <span className="truncate">{automation?.name ?? "Unavailable automation"}</span>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        {automation === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>This automation is no longer available</EmptyTitle>
              <EmptyDescription>
                {environment === null
                  ? "Its environment is not connected."
                  : "It was deleted, or its environment has not sent it yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <AutomationDetail key={`${environmentId}:${automationId}`} automation={automation} />
        )}
      </div>
    </SidebarInset>
  );
}

function AutomationDetail({ automation }: { automation: EnvironmentAutomation }) {
  const ref = useMemo(
    () => ({ environmentId: automation.environmentId, automationId: automation.id }),
    [automation.environmentId, automation.id],
  );
  const actions = useAutomationActions();
  const navigate = useNavigate();
  const project = useProject(scopeProjectRef(automation.environmentId, automation.projectId));
  const environment = useEnvironment(automation.environmentId);
  const environmentPaused = useEnvironmentSettings(
    automation.environmentId,
    (settings) => settings.automations.enabled === false,
  );
  const activeRunThread = useThreadShell(
    automation.activeRun?.threadId
      ? scopeThreadRef(automation.environmentId, automation.activeRun.threadId)
      : null,
  );
  const status = automationStatus(automation, activeRunThread);
  const nowMinute = useNowMinute();
  const nowIso = `${nowMinute}:00.000Z`;
  const nowMs = Date.parse(nowIso);
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EnvironmentAutomation | null>(null);

  // Model chip: the automation's own selection, else the project default.
  const serverProviders =
    useAtomValue(serverEnvironment.providersValueAtom(automation.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const environmentSettings = useEnvironmentSettings(automation.environmentId);
  const instanceEntries = useMemo(
    () =>
      applyProviderInstanceSettings(
        deriveProviderInstanceEntries(serverProviders),
        environmentSettings,
      ),
    [environmentSettings, serverProviders],
  );
  const modelSelection = automation.modelSelection ?? project?.defaultModelSelection ?? null;
  const modelEntry = instanceEntries.find(
    (entry) => entry.instanceId === modelSelection?.instanceId,
  );
  const modelLabel =
    modelSelection === null
      ? "Default model"
      : `${modelEntry?.displayName ?? modelSelection.instanceId} · ${modelSelection.model}`;
  const runtimeModeLabel = resolveRuntimeModeOption(
    modelEntry?.driverKind ?? instanceEntries[0]?.driverKind ?? DEFAULT_DRIVER_KIND,
    automation.runtimeMode,
  ).label;

  const httpBaseUrl = useEnvironmentHttpBaseUrl(automation.environmentId);
  const webhookUrl = composeWebhookUrl(httpBaseUrl, automation.webhookPath);
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: "Webhook URL copied" }),
    onError: () => toastManager.add({ type: "error", title: "Could not copy the webhook URL" }),
  });

  const lastRunLabel =
    automation.lastRun === null
      ? "No runs yet"
      : `${STATUS_VISUALS[automationRunStatusVisual(automation.lastRun.status)].label} · ${formatRelativeTimeLabel(
          automation.lastRun.finishedAt ?? automation.lastRun.requestedAt,
        )}`;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="readable" className="gap-6">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot status={automationStatusVisual(status)} className="size-2" />
                <h1 className="truncate text-xl font-semibold tracking-tight">{automation.name}</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {project?.title ?? "Unknown project"}
                {environment ? ` · ${environment.label}` : ""}
                {` · ${STATUS_VISUALS[automationStatusVisual(status)].label}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {automation.enabled ? "Active" : "Paused"}
                <Switch
                  size="sm"
                  checked={automation.enabled}
                  aria-label={automation.enabled ? "Pause automation" : "Resume automation"}
                  onCheckedChange={(checked) => void actions.setEnabled(ref, checked)}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={automation.activeRun !== null}
                onClick={() => void actions.runNow(ref)}
              >
                <PlayIcon />
                Run now
              </Button>
              <Menu>
                <MenuTrigger
                  render={<Button size="icon-sm" variant="outline" aria-label="More actions" />}
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => setEditing(true)}>
                    <PencilIcon className="size-4" />
                    Edit
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void actions.startAgentSetup(
                        scopeProjectRef(automation.environmentId, automation.projectId),
                        automation,
                      )
                    }
                  >
                    <BotIcon className="size-4" />
                    Edit with agent
                  </MenuItem>
                  {webhookUrl !== null ? (
                    <>
                      <MenuSeparator />
                      <MenuItem onClick={() => copyToClipboard(webhookUrl, undefined)}>
                        <CopyIcon className="size-4" />
                        Copy webhook URL
                      </MenuItem>
                      <MenuItem onClick={() => void actions.rotateWebhookToken(ref)}>
                        <RefreshCwIcon className="size-4" />
                        Rotate token
                      </MenuItem>
                    </>
                  ) : null}
                  <MenuSeparator />
                  <MenuItem variant="destructive" onClick={() => setPendingDelete(automation)}>
                    <Trash2Icon className="size-4" />
                    Delete
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </div>
          </header>

          {environmentPaused ? (
            <Alert variant="warning">
              <AlertDescription>
                Paused on this environment — Run now still works. Resume schedules and triggers in
                Settings → General.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-4 sm:grid-cols-3">
            <Stat
              label="Next run"
              value={
                automation.activeRun !== null
                  ? "Running"
                  : !automation.enabled
                    ? "Paused"
                    : automation.nextRunAt === null
                      ? "No schedule"
                      : formatUntilLabel(automation.nextRunAt, nowMs)
              }
            />
            <Stat label="Last run" value={lastRunLabel} />
            <Stat
              label="Consecutive failures"
              value={String(automation.consecutiveFailures)}
              tone={automation.consecutiveFailures > 0 ? "destructive" : undefined}
            />
            <div className="flex flex-wrap gap-1.5 sm:col-span-3">
              <Badge variant="secondary">{modelLabel}</Badge>
              <Badge variant="secondary">{runtimeModeLabel}</Badge>
              <Badge variant="secondary">
                {automation.workspace === "worktree" ? "New worktree per run" : "Project checkout"}
              </Badge>
              {automation.createPullRequest ? (
                <Badge variant="secondary">Creates a PR</Badge>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border/60 bg-card/40">
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="text-sm font-semibold">Configuration</h2>
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
            </div>
            <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Prompt</dt>
              <dd>
                <ExpandableText text={automation.prompt} />
              </dd>
              <dt className="text-muted-foreground">Triggers</dt>
              <dd className="flex flex-col gap-1.5">
                {automation.triggers.length === 0 ? (
                  <span className="text-muted-foreground">Manual only</span>
                ) : (
                  automation.triggers.map((trigger, index) => (
                    <span key={index} className="flex items-center gap-2">
                      <AutomationTriggerIcon
                        type={trigger.type}
                        className="size-3.5 text-muted-foreground"
                      />
                      {describeAutomationTrigger(trigger)}
                    </span>
                  ))
                )}
              </dd>
              {automation.webhookPath !== null ? (
                <>
                  <dt className="text-muted-foreground">Webhook URL</dt>
                  <dd className="min-w-0">
                    {webhookUrl === null ? (
                      <span className="text-muted-foreground">
                        Connect to the environment to see its URL.
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-left font-mono text-xs hover:bg-accent/60"
                          onClick={() => copyToClipboard(webhookUrl, undefined)}
                        >
                          <span className="min-w-0 flex-1 truncate">{webhookUrl}</span>
                          <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        </button>
                        {isLoopbackUrl(webhookUrl) ? (
                          <p className="mt-1 text-xs text-warning-foreground">
                            {WEBHOOK_LOOPBACK_NOTE}
                          </p>
                        ) : null}
                      </>
                    )}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Timeout</dt>
              <dd>{automation.timeoutMinutes} minutes</dd>
              <dt className="text-muted-foreground">Options</dt>
              <dd className="text-muted-foreground">
                {[
                  automation.includeLastRunSummary ? "Includes last run summary" : null,
                  automation.catchUpMissedRuns ? "Catches up missed runs" : "Skips missed runs",
                  automation.triggers.some((trigger) => trigger.type !== "schedule")
                    ? `Minimum interval ${automation.minIntervalSeconds}s`
                    : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </dd>
            </dl>
          </section>

          <AutomationRuns automation={automation} nowIso={nowIso} nowMs={nowMs} />
        </WorkspacePageContainer>
      </div>
      {editing ? (
        <AutomationEditorDialog
          open
          environmentId={automation.environmentId}
          projectId={automation.projectId}
          automation={automation}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      ) : null}
      <AutomationDeleteDialog
        automation={pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={(target) => {
          void actions
            .remove({ environmentId: target.environmentId, automationId: target.id })
            .then((ok) => {
              if (ok) void navigate({ to: "/" });
            });
        }}
      />
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive" | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn("truncate text-sm font-medium", tone === "destructive" && "text-destructive")}
      >
        {value}
      </div>
    </div>
  );
}

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 4;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap", !expanded && long && "line-clamp-4")}>{text}</p>
      {long ? (
        <button
          type="button"
          className="mt-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

type RunsPageAtom = ReturnType<typeof automationEnvironment.listRuns>;
type RunsPage = { readonly result: RunsPageResult; readonly atom: RunsPageAtom };

/**
 * Cursor-chained run pages: page 0 has no cursor and refreshes with the
 * automation row; page k reads `beforeCursor` off page k-1's live result, so
 * when a new run pushes the first page down the older pages follow it with
 * no gap. A page whose predecessor has no value yet is simply not read.
 */
function useAutomationRunPages(automation: EnvironmentAutomation) {
  const [pageCount, setPageCount] = useState(1);
  const pagesAtom = useMemo(
    () =>
      Atom.make((get): ReadonlyArray<RunsPage> => {
        const pages: RunsPage[] = [];
        let beforeCursor: string | null | undefined;
        while (pages.length < pageCount && beforeCursor !== null) {
          const atom = automationEnvironment.listRuns({
            environmentId: automation.environmentId,
            input: {
              automationId: automation.id,
              limit: AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
              ...(beforeCursor === undefined ? {} : { beforeCursor }),
            },
          });
          const result = get(atom);
          pages.push({ result, atom });
          beforeCursor = Option.getOrNull(AsyncResult.value(result))?.nextCursor ?? null;
        }
        return pages;
      }),
    [automation.environmentId, automation.id, pageCount],
  );
  const pages = useAtomValue(pagesAtom);
  const runs = useMemo(() => {
    const seen = new Set<string>();
    const all: AutomationRun[] = [];
    for (const page of pages) {
      for (const run of Option.getOrNull(AsyncResult.value(page.result))?.runs ?? []) {
        if (!seen.has(run.id)) {
          seen.add(run.id);
          all.push(run);
        }
      }
    }
    return all;
  }, [pages]);
  const first = pages[0]!;
  const last = pages[pages.length - 1]!;
  const lastValue = Option.getOrNull(AsyncResult.value(last.result));
  const more: "hidden" | "idle" | "loading" | "failed" =
    pages.length === 1 && lastValue === null
      ? "hidden"
      : last.result._tag === "Initial" || (pages.length > 1 && last.result.waiting)
        ? "loading"
        : last.result._tag === "Failure" && pages.length > 1
          ? "failed"
          : lastValue?.nextCursor === null
            ? "hidden"
            : "idle";
  return {
    runs,
    isPending: first.result._tag === "Initial",
    // Only the first page can be fatal, and only while it has no value to show.
    error: first.result._tag === "Failure" && Option.isNone(first.result.previousSuccess),
    more,
    showMore: () => setPageCount(pages.length + 1),
    retryMore: () => appAtomRegistry.refresh(last.atom),
  };
}

function AutomationRuns({
  automation,
  nowIso,
  nowMs,
}: {
  automation: EnvironmentAutomation;
  nowIso: string;
  nowMs: number;
}) {
  const navigate = useNavigate();
  const { runs, isPending, error, more, showMore, retryMore } = useAutomationRunPages(automation);
  const timeZone = useMemo(() => new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const groups = useMemo(
    () =>
      groupAutomationRunsByDay(runs, nowIso, timeZone).map((group) => ({
        ...group,
        rows: condenseAutomationRunGroup(group.runs),
      })),
    [nowIso, runs, timeZone],
  );
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = useCallback((rowKey: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);
  const openThread = useCallback(
    (ref: ScopedThreadRef) => {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    },
    [navigate],
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Runs</h2>
      {error ? (
        <p className="text-sm text-destructive">Could not load runs.</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading runs…</p>
      ) : runs.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border/60 p-8">
          <EmptyHeader>
            <EmptyTitle>No runs yet</EmptyTitle>
            <EmptyDescription>
              Runs appear here as triggers fire. Press Run now to start one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
            <ul className="flex flex-col gap-px rounded-xl border border-border/60 bg-card/40 p-1">
              {group.rows.map((row) => {
                if (row.kind === "run") {
                  return (
                    <RunRow
                      key={row.run.id}
                      environmentId={automation.environmentId}
                      run={row.run}
                      nowMs={isLiveRun(row.run) ? nowMs : 0}
                      onOpen={openThread}
                    />
                  );
                }
                const rowKey = `${group.key}:${row.runs[0]?.id ?? ""}`;
                return (
                  <CollapsedRunRows
                    key={rowKey}
                    rowKey={rowKey}
                    environmentId={automation.environmentId}
                    row={row}
                    expanded={expandedRows.has(rowKey)}
                    nowMs={nowMs}
                    onToggle={toggleRow}
                    onOpen={openThread}
                  />
                );
              })}
            </ul>
          </div>
        ))
      )}
      {more !== "hidden" ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={more === "loading"}
            onClick={more === "failed" ? retryMore : showMore}
          >
            {more === "loading" ? "Loading…" : more === "failed" ? "Retry" : "Show more"}
          </Button>
          {more === "failed" ? (
            <span className="text-xs text-destructive">Could not load older runs.</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CollapsedRunRows({
  rowKey,
  environmentId,
  row,
  expanded,
  nowMs,
  onToggle,
  onOpen,
}: {
  rowKey: string;
  environmentId: EnvironmentId;
  row: Extract<AutomationRunRow, { kind: "collapsed" }>;
  expanded: boolean;
  nowMs: number;
  onToggle: (rowKey: string) => void;
  onOpen: (ref: ScopedThreadRef) => void;
}) {
  return (
    <>
      <li>
        <button
          type="button"
          aria-expanded={expanded}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={() => onToggle(rowKey)}
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")}
          />
          {collapsedRunRowLabel(row)}
        </button>
      </li>
      {expanded
        ? row.runs.map((run) => (
            <RunRow
              key={run.id}
              environmentId={environmentId}
              run={run}
              nowMs={isLiveRun(run) ? nowMs : 0}
              onOpen={onOpen}
            />
          ))
        : null}
    </>
  );
}

const runTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const isLiveRun = (run: AutomationRun) => run.status === "running" || run.status === "requested";

/** `nowMs` only matters for live runs; settled rows get 0 so the minute tick skips them. */
const RunRow = memo(function RunRow({
  environmentId,
  run,
  nowMs,
  onOpen,
}: {
  environmentId: EnvironmentId;
  run: AutomationRun;
  nowMs: number;
  onOpen: (ref: ScopedThreadRef) => void;
}) {
  // Point read off the unfiltered index: the row re-renders only when its own
  // thread changes, never when another thread streams.
  const threadRef = run.threadId === null ? null : scopeThreadRef(environmentId, run.threadId);
  const hasThread = useThreadShell(threadRef) !== null;
  const failed = run.status === "failed";
  const live = isLiveRun(run);
  const removed = threadRef !== null && !hasThread && !live;
  const startedAt = run.startedAt ?? run.requestedAt;
  const detail = run.error ?? run.summary;
  return (
    <li>
      <button
        type="button"
        disabled={!hasThread}
        className={cn(
          "grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 text-left text-sm",
          hasThread ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
          failed && "bg-destructive/5",
        )}
        onClick={() => {
          if (threadRef !== null && hasThread) onOpen(threadRef);
        }}
      >
        <StatusDot status={automationRunStatusVisual(run.status)} />
        <Tooltip>
          <TooltipTrigger
            render={<span className="inline-flex items-center text-muted-foreground" />}
          >
            <AutomationTriggerIcon type={run.trigger.type} className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{automationRunTriggerLabel(run.trigger)}</TooltipPopup>
        </Tooltip>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn("shrink-0 tabular-nums", failed && "text-destructive")}>
            {runTimeFormatter.format(Date.parse(startedAt))}
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-xs",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {STATUS_VISUALS[automationRunStatusVisual(run.status)].label}
            {detail ? ` · ${detail}` : ""}
            {removed ? " · Thread removed" : ""}
          </span>
        </span>
        <RunDuration run={run} live={live} nowMs={nowMs} />
      </button>
    </li>
  );
});

/** Live runs tick by DOM writes on the shared second timer; settled runs are static. */
function RunDuration({ run, live, nowMs }: { run: AutomationRun; live: boolean; nowMs: number }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const startedAt = run.startedAt;
  useEffect(() => {
    if (!live || startedAt === null) return;
    return subscribeSecondTick(() => {
      const duration = automationRunDurationMs({ startedAt, finishedAt: null }, Date.now());
      if (textRef.current && duration !== null) {
        textRef.current.textContent = formatDuration(duration);
      }
    });
  }, [live, startedAt]);
  const duration = automationRunDurationMs(run, nowMs);
  return (
    <span ref={textRef} className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {duration === null ? "" : formatDuration(duration)}
    </span>
  );
}
