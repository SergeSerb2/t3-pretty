import {
  automationStatus,
  condenseAutomationRunGroup,
  groupAutomationRunsByDay,
  type AutomationRunRow,
} from "@t3tools/client-runtime/state/automations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
  AUTOMATION_LIST_RUNS_MAX_LIMIT,
  type AutomationRun,
  type ThreadId,
} from "@t3tools/contracts";
import { automationRunTriggerLabel } from "@t3tools/shared/automationSchedule";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { StatusPill } from "../../components/StatusPill";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { automationEnvironment } from "../../state/automations";
import { useAllThreadShells, useAutomationShell, useProject } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";
import {
  automationCommandErrorMessage,
  automationRunStatusTone,
  automationStatusTone,
  collapsedRunsLabel,
  formatRunDuration,
} from "./automations.logic";
import {
  parseAutomationDetailRoute,
  type AutomationDetailRouteParams,
} from "./automationNavigation";

type AutomationDetailScreenProps = StaticScreenProps<AutomationDetailRouteParams>;

// Day headings and local times follow the device zone; it cannot change while
// the screen is mounted, so resolve it once.
const VIEWER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function SummaryRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3 py-1.5">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="shrink text-right text-sm font-t3-medium text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

function RunRow(props: {
  readonly run: AutomationRun;
  readonly nowMs: number;
  readonly threadExists: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const tone = automationRunStatusTone(props.run.status);
  const duration = formatRunDuration(props.run.startedAt, props.run.finishedAt, props.nowMs);
  // A run that is still requested or running has no thread on this device until
  // the shell arrives; never label that "Thread removed".
  const live = props.run.status === "running" || props.run.status === "requested";
  const removed = props.run.threadId !== null && !props.threadExists && !live;
  const detail = [
    automationRunTriggerLabel(props.run.trigger),
    relativeTime(props.run.requestedAt),
    ...(duration === null ? [] : [duration]),
    ...(removed ? ["Thread removed"] : []),
  ].join(" · ");
  const body = (
    <View className="flex-row items-start gap-3 px-4 py-3">
      <View className="min-w-0 flex-1">
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {detail}
        </Text>
        {props.run.error ? (
          <Text className="mt-1 text-sm text-adaptive-rose-700-300" numberOfLines={2}>
            {props.run.error}
          </Text>
        ) : props.run.summary ? (
          <Text className="mt-1 text-sm text-foreground" numberOfLines={2}>
            {props.run.summary}
          </Text>
        ) : null}
      </View>
      <StatusPill {...tone} size="compact" />
    </View>
  );
  const threadId = props.run.threadId;
  if (threadId === null || !props.threadExists) {
    return (
      <View accessibilityLabel={`Run ${tone.label}`} className={cn(removed && "opacity-60")}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the thread of this ${tone.label.toLowerCase()} run`}
      onPress={() => props.onOpenThread(threadId)}
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export function AutomationDetailScreen(props: AutomationDetailScreenProps) {
  const navigation = useNavigation();
  const routeParams = props.route.params;
  const reference = useMemo(() => parseAutomationDetailRoute(routeParams), [routeParams]);
  const automation = useAutomationShell(reference);
  const project = useProject(
    automation === null
      ? null
      : { environmentId: automation.environmentId, projectId: automation.projectId },
  );
  const threads = useAllThreadShells();
  const [limit, setLimit] = useState(AUTOMATION_LIST_RUNS_DEFAULT_LIMIT);
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const runsQuery = useEnvironmentQuery(
    reference === null
      ? null
      : automationEnvironment.listRuns({
          environmentId: reference.environmentId,
          input: { automationId: reference.automationId, limit },
        }),
  );
  const update = useAtomCommand(automationEnvironment.update, { reportFailure: false });
  const runNow = useAtomCommand(automationEnvironment.runNow, { reportFailure: false });

  // One minute-resolution clock for day headings and run durations, bound to
  // focus so a covered screen stops ticking. No per-row timer.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
      const id = setInterval(() => setNowMs(Date.now()), 60_000);
      return () => clearInterval(id);
    }, []),
  );

  const runs = runsQuery.data?.runs ?? [];
  // At most one page (200 rows) is loaded, so grouping every render is cheaper
  // than keeping a memo in sync with a clock that only labels the day headings.
  const groups = groupAutomationRunsByDay(
    runs,
    new Date(nowMs).toISOString(),
    VIEWER_TIME_ZONE,
  ).map((group) => ({ ...group, rows: condenseAutomationRunGroup(group.runs) }));
  const knownThreadIds = useMemo(
    () =>
      new Set(
        threads
          .filter((thread) => thread.environmentId === reference?.environmentId)
          .map((thread) => String(thread.id)),
      ),
    [reference?.environmentId, threads],
  );
  const openThread = useCallback(
    (threadId: ThreadId) => {
      if (reference === null) return;
      navigation.navigate("Thread", { environmentId: reference.environmentId, threadId });
    },
    [navigation, reference],
  );

  const runNowDisabled = pending || automation === null || automation.activeRun !== null;
  const handleRunNow = useCallback(async () => {
    if (automation === null) return;
    setPending(true);
    setActionError(null);
    const result = await runNow({
      environmentId: automation.environmentId,
      input: { automationId: automation.id },
    });
    setPending(false);
    if (AsyncResult.isFailure(result) && !isAtomCommandInterrupted(result)) {
      setActionError(
        automationCommandErrorMessage(
          squashAtomCommandFailure(result),
          "The run could not be started.",
        ),
      );
    }
  }, [automation, runNow]);
  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (automation === null) return;
      setPending(true);
      setActionError(null);
      const result = await update({
        environmentId: automation.environmentId,
        input: { automationId: automation.id, patch: { enabled } },
      });
      setPending(false);
      if (AsyncResult.isFailure(result) && !isAtomCommandInterrupted(result)) {
        setActionError(
          automationCommandErrorMessage(
            squashAtomCommandFailure(result),
            enabled
              ? "The automation could not be resumed."
              : "The automation could not be paused.",
          ),
        );
      }
    },
    [automation, update],
  );

  const title = automation?.name ?? "Automation";
  const header =
    Platform.OS === "android" ? (
      <>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader
          title={title}
          subtitle={project?.title ?? null}
          onBack={() => navigation.goBack()}
        />
      </>
    ) : (
      <NativeStackScreenOptions options={{ title }} />
    );

  if (reference === null || (automation === null && !runsQuery.isPending)) {
    return (
      <View className="flex-1 bg-sheet">
        {header}
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState
            title="Automation not found"
            detail="It was deleted, or this link names an environment that is not connected."
          />
        </View>
      </View>
    );
  }

  if (automation === null) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet">
        {header}
        <ActivityIndicator colorClassName="accent-icon" />
      </View>
    );
  }

  const activeRunThread =
    automation.activeRun?.threadId == null
      ? null
      : (threads.find(
          (thread) =>
            thread.environmentId === automation.environmentId &&
            thread.id === automation.activeRun?.threadId,
        ) ?? null);
  const statusTone = automationStatusTone(automationStatus(automation, activeRunThread)) ?? {
    label: "Idle",
    pillClassName: "bg-adaptive-zinc-500-a12-a16",
    textClassName: "text-foreground-muted",
  };
  const permissionLabel =
    RUNTIME_MODE_CHOICES.find((choice) => choice.mode === automation.runtimeMode)?.label ??
    automation.runtimeMode;

  return (
    <View className="flex-1 bg-sheet">
      {header}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {actionError === null ? null : <ErrorBanner message={actionError} />}

        <View className="rounded-2xl bg-card px-4 py-3">
          <View className="flex-row items-center justify-between gap-3 py-1">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-t3-bold text-foreground">
                {automation.enabled ? "Running on its triggers" : "Paused"}
              </Text>
              <Text className="mt-0.5 text-xs text-foreground-muted">
                {automation.enabled
                  ? "Pause to stop every trigger. Run now still works."
                  : "Triggers are off. Run now still works."}
              </Text>
            </View>
            <ThemedSwitch
              accessibilityLabel={automation.enabled ? "Pause automation" : "Resume automation"}
              disabled={pending}
              value={automation.enabled}
              onValueChange={(value) => void handleToggleEnabled(value)}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: runNowDisabled }}
            disabled={runNowDisabled}
            onPress={() => void handleRunNow()}
            className={cn(
              "mt-2 min-h-11 items-center justify-center rounded-full bg-primary active:opacity-70",
              runNowDisabled && "opacity-50",
            )}
          >
            <Text className="text-sm font-t3-bold text-primary-foreground">
              {automation.activeRun === null ? "Run now" : "A run is in progress"}
            </Text>
          </Pressable>
        </View>

        <View className="rounded-2xl bg-card px-4 py-3">
          <View className="flex-row items-center justify-between gap-3 pb-1">
            <Text className="text-xs font-t3-medium tracking-[0.5px] uppercase text-foreground-muted">
              Summary
            </Text>
            <StatusPill {...statusTone} size="compact" />
          </View>
          <SummaryRow
            label="Next run"
            value={
              !automation.enabled
                ? "Paused"
                : automation.nextRunAt === null
                  ? "No schedule"
                  : new Date(automation.nextRunAt).toLocaleString()
            }
          />
          <SummaryRow
            label="Last run"
            value={
              automation.lastRun === null
                ? "Never"
                : `${automationRunStatusTone(automation.lastRun.status).label} · ${relativeTime(
                    automation.lastRun.finishedAt ?? automation.lastRun.requestedAt,
                  )}`
            }
          />
          <SummaryRow label="Consecutive failures" value={String(automation.consecutiveFailures)} />
          <SummaryRow label="Model" value={automation.modelSelection?.model ?? "Project default"} />
          <SummaryRow label="Permission" value={permissionLabel} />
          <SummaryRow
            label="Workspace"
            value={
              automation.workspace === "worktree"
                ? automation.createPullRequest
                  ? "New worktree per run · pull request"
                  : "New worktree per run"
                : "Project checkout"
            }
          />
        </View>

        {automation.lastRun?.summary ? (
          <View className="rounded-2xl bg-card px-4 py-3">
            <Text className="text-xs font-t3-medium tracking-[0.5px] uppercase text-foreground-muted">
              Last run summary
            </Text>
            <Text className="mt-2 text-sm leading-relaxed text-foreground">
              {automation.lastRun.summary}
            </Text>
          </View>
        ) : null}

        <View className="gap-2">
          <Text className="px-1 text-xs font-t3-medium tracking-[0.5px] uppercase text-foreground-muted">
            Runs
          </Text>
          {runsQuery.isPending && runs.length === 0 ? (
            <View className="items-center py-10">
              <ActivityIndicator colorClassName="accent-icon" />
            </View>
          ) : runsQuery.error !== null && runs.length === 0 ? (
            <EmptyState
              title="Could not load the runs"
              detail={runsQuery.error}
              actionLabel="Retry"
              onAction={() => runsQuery.refresh()}
            />
          ) : runs.length === 0 ? (
            <EmptyState title="No runs yet" detail="Runs appear here as the triggers fire." />
          ) : (
            groups.map((group) => (
              <View key={group.key} className="gap-1">
                <Text className="px-1 pt-2 text-xs text-foreground-tertiary">{group.label}</Text>
                <View className="overflow-hidden rounded-2xl bg-card">
                  {group.rows.map((row: AutomationRunRow, index: number) => {
                    const key = `${group.key}:${index}`;
                    if (row.kind === "run") {
                      return (
                        <RunRow
                          key={row.run.id}
                          nowMs={nowMs}
                          onOpenThread={openThread}
                          run={row.run}
                          threadExists={
                            row.run.threadId !== null &&
                            knownThreadIds.has(String(row.run.threadId))
                          }
                        />
                      );
                    }
                    const isExpanded = expanded.includes(key);
                    return (
                      <View key={key}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() =>
                            setExpanded((current) =>
                              current.includes(key)
                                ? current.filter((entry) => entry !== key)
                                : [...current, key],
                            )
                          }
                          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
                          className="px-4 py-3"
                        >
                          <Text className="text-xs text-foreground-muted">
                            {collapsedRunsLabel(row)}
                          </Text>
                        </Pressable>
                        {isExpanded
                          ? row.runs.map((run) => (
                              <RunRow
                                key={run.id}
                                nowMs={nowMs}
                                onOpenThread={openThread}
                                run={run}
                                threadExists={
                                  run.threadId !== null && knownThreadIds.has(String(run.threadId))
                                }
                              />
                            ))
                          : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))
          )}
          {/* "Show more" grows the single page's limit so the list stays one live
              atom and day grouping keeps working across the whole history.
              ponytail: cannot page past AUTOMATION_LIST_RUNS_MAX_LIMIT (200) runs;
              switch to nextCursor paging if anyone needs deeper history. */}
          {runsQuery.data?.nextCursor != null && limit < AUTOMATION_LIST_RUNS_MAX_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setLimit((current) =>
                  Math.min(
                    AUTOMATION_LIST_RUNS_MAX_LIMIT,
                    current + AUTOMATION_LIST_RUNS_DEFAULT_LIMIT,
                  ),
                )
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
              className="min-h-11 items-center justify-center rounded-full bg-subtle"
            >
              <Text className="text-sm font-t3-bold text-foreground">Show more</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
