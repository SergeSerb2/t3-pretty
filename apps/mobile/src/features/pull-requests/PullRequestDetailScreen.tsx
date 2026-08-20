import type { PullRequestAction, PullRequestMergeMethod } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { PULL_REQUEST_WATCHING_REFRESH_INTERVAL_MS } from "@t3tools/client-runtime/state/pull-requests";
import {
  countGrokReviewSummaries,
  visiblePullRequestConversationComments,
} from "@t3tools/shared/sourceControl";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { HeaderHeightContext } from "@react-navigation/elements";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { MenuAction } from "@react-native-menu/menu";

import { AndroidHeaderIconButton, AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { cn } from "../../lib/cn";
import { nativeGlassHeaderOverlapInset } from "../../lib/layoutMetrics";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { useEnvironmentQuery } from "../../state/query";
import { pullRequestEnvironment } from "../../state/pullRequests";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  ACTION_FAILURE_HINTS,
  ACTION_FAILURE_LABELS,
  ACTION_SUCCESS_LABELS,
  OPEN_ON_HOST_LABELS,
  allowedPullRequestReviewVerdicts,
  buildExplainPullRequestPrompt,
  buildFixFindingPrompt,
  buildFixFindingsPrompt,
  buildPullRequestTimeline,
  buildResolveConflictsPrompt,
  canRequestPullRequestReviewers,
  composePullRequestDetailView,
  countUnresolvedReviewThreads,
  groupPullRequestConversation,
  pullRequestUrlHost,
  readableFailure,
} from "./pullRequestDetail.logic";
import type { ParsedDiffFile } from "./pullRequestDiffParse";
import {
  formatDiffStat,
  pullRequestCheckStatusLabel,
  pullRequestCheckStatusTextClass,
  pullRequestCheckStatusTint,
  pullRequestCheckSymbol,
  pullRequestLabelColor,
  resolvePullRequestState,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";
import { parseRoutePositiveInt, type PullRequestDetailRouteParams } from "./pullRequestNavigation";
import { PullRequestActionChip, PullRequestPrimaryButton } from "./PullRequestActionChip";
import { PullRequestActorAvatar } from "./PullRequestActorAvatar";
import { PullRequestConversation } from "./PullRequestConversation";
import { hasVisiblePullRequestBody } from "./pullRequestMarkdown.logic";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestStateBadge } from "./PullRequestStateBadge";
import { usePullRequestDiffSlices } from "./usePullRequestDiffSlices";
import { usePullRequestHandoff } from "./usePullRequestHandoff";
import { useResolvedPullRequestReference } from "./useResolvedPullRequestReference";

type DetailTab = "overview" | "conversation" | "files";

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "conversation", label: "Conversation" },
  { value: "files", label: "Files" },
];

const MERGE_METHOD_LABELS: Record<PullRequestMergeMethod, string> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

type PullRequestDetailScreenProps = StaticScreenProps<PullRequestDetailRouteParams>;

export function PullRequestDetailScreen(props: PullRequestDetailScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const navigationHeaderHeight = useContext(HeaderHeightContext);
  const glassHeaderInset = nativeGlassHeaderOverlapInset({
    glassSupported: NATIVE_LIQUID_GLASS_SUPPORTED,
    headerHeight: navigationHeaderHeight,
    safeAreaTop: insets.top,
  });
  const iconColor = useThemeColor("--color-icon");
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const number = parseRoutePositiveInt(props.route.params.number);
  const reference = useResolvedPullRequestReference(props.route.params);
  const repository = reference?.repository ?? props.route.params.repository ?? "";
  const [tab, setTab] = useState<DetailTab>("overview");
  const [actionPending, setActionPending] = useState(false);
  const { startHandoff } = usePullRequestHandoff();
  const skipFocusRefresh = useRef(true);

  const detailQuery = useEnvironmentQuery(
    reference === null ? null : pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const activityQuery = useEnvironmentQuery(
    reference === null
      ? null
      : pullRequestEnvironment.activity({ environmentId, input: reference }),
  );
  const diffSlices = usePullRequestDiffSlices({
    environmentId,
    reference,
    enabled: reference !== null && tab === "files" && detailQuery.data?.capabilities.diff === true,
  });
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const setThreadResolution = useAtomCommand(pullRequestEnvironment.setThreadResolution, {
    reportFailure: false,
  });

  const detail =
    detailQuery.data === null
      ? null
      : composePullRequestDetailView(detailQuery.data, activityQuery.data);
  const presentation = detail === null ? null : resolvePullRequestState(detail);
  const visibleTabs = useMemo(
    () =>
      TABS.filter((item) => item.value !== "files" || detail === null || detail.capabilities.diff),
    [detail],
  );
  const reviewVerdicts = useMemo(
    () =>
      detail === null
        ? []
        : allowedPullRequestReviewVerdicts(
            detail.capabilities.review.verdicts,
            detail.viewerPermissions.verdicts,
          ),
    [detail],
  );

  useEffect(() => {
    if (!visibleTabs.some((item) => item.value === tab)) setTab("overview");
  }, [tab, visibleTabs]);

  const refetch = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
    diffSlices.refresh();
  }, [activityQuery, detailQuery, diffSlices]);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const refresh = useCallback(
    async (scope: "one" | "all" = "one") => {
      if (reference === null) return;
      await invalidate({
        environmentId,
        input: scope === "all" ? {} : { reference },
      });
      refetchRef.current();
    },
    [environmentId, invalidate, reference],
  );
  const refreshLive = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
  }, [activityQuery, detailQuery]);
  const refreshLiveRef = useRef(refreshLive);
  refreshLiveRef.current = refreshLive;

  useFocusEffect(
    useCallback(() => {
      if (skipFocusRefresh.current) {
        skipFocusRefresh.current = false;
      } else {
        refetchRef.current();
      }
      const timer = setInterval(() => {
        refreshLiveRef.current();
      }, PULL_REQUEST_WATCHING_REFRESH_INTERVAL_MS);
      return () => clearInterval(timer);
    }, []),
  );

  const can = useCallback(
    (action: PullRequestAction) =>
      detail !== null &&
      detail.capabilities.actions.includes(action) &&
      detail.viewerPermissions.actions.includes(action),
    [detail],
  );

  const perform = useCallback(
    async (action: PullRequestAction, mergeMethod?: PullRequestMergeMethod) => {
      if (reference === null || actionPending) return;
      setActionPending(true);
      try {
        const result = await runAction({
          environmentId,
          input: { ...reference, action, ...(mergeMethod ? { mergeMethod } : {}) },
        });
        if (AsyncResult.isFailure(result)) {
          Alert.alert(
            ACTION_FAILURE_LABELS[action],
            readableFailure(squashAtomCommandFailure(result), ACTION_FAILURE_HINTS[action]),
          );
          return;
        }
        Alert.alert(ACTION_SUCCESS_LABELS[action]);
        await refresh("all");
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, environmentId, reference, refresh, runAction],
  );

  const mergeMethods = useMemo(() => {
    if (detail === null) return [];
    return (["merge", "squash", "rebase"] as const).filter(
      (method) =>
        detail.mergeCapabilities[method] && detail.capabilities.mergeMethods.includes(method),
    );
  }, [detail]);

  const confirmMerge = useCallback(() => {
    if (mergeMethods.length === 0) return;
    if (mergeMethods.length === 1) {
      void perform("merge", mergeMethods[0]);
      return;
    }
    Alert.alert("Merge pull request", "Choose how to merge this pull request.", [
      { text: "Cancel", style: "cancel" },
      ...mergeMethods.map((method) => ({
        text: MERGE_METHOD_LABELS[method],
        onPress: () => void perform("merge", method),
      })),
    ]);
  }, [mergeMethods, perform]);

  const androidMergeActions = useMemo<MenuAction[]>(
    () =>
      mergeMethods.map((method) => ({
        id: method,
        title: MERGE_METHOD_LABELS[method],
      })),
    [mergeMethods],
  );

  const handoff = useCallback(
    (prompt: string) => {
      if (detail === null) return;
      void startHandoff({
        environmentId,
        projectId: detail.projectId,
        url: detail.url,
        prompt,
      });
    },
    [detail, environmentId, startHandoff],
  );

  const startFixFindings = useCallback(() => {
    if (detail === null) return;
    handoff(
      buildFixFindingsPrompt({
        provider: detail.provider,
        host: pullRequestUrlHost(detail.url) ?? detail.repository,
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: detail.reviewThreads,
        comments: detail.comments,
        checks: detail.checks,
        commentsTruncated: detail.commentsTruncated,
        canResolve: detail.viewerPermissions.resolve && detail.capabilities.review.resolve,
      }),
    );
  }, [detail, handoff]);

  const openOnHost = useCallback(() => {
    if (detail === null) return;
    void tryOpenExternalUrl(detail.url, "pull-request");
  }, [detail]);

  const openReview = useCallback(() => {
    navigation.navigate("PullRequestComment", {
      environmentId: String(environmentId),
      projectId: props.route.params.projectId,
      repository,
      number: String(number),
      mode: "review",
      verdicts: reviewVerdicts,
    });
  }, [environmentId, navigation, number, props.route.params.projectId, repository, reviewVerdicts]);

  const moreItems = useMemo(() => {
    if (detail === null) return [];
    const items: Array<{
      type: "action";
      title: string;
      onPress: () => void;
      destructive?: boolean;
    }> = [
      { type: "action", title: "Refresh", onPress: () => void refresh() },
      {
        type: "action",
        title: OPEN_ON_HOST_LABELS[detail.provider] ?? "Open on host",
        onPress: openOnHost,
      },
      {
        type: "action",
        title: "Explain this PR",
        onPress: () =>
          handoff(
            buildExplainPullRequestPrompt({
              number: detail.number,
              title: detail.title,
              url: detail.url,
              headBranch: detail.headBranch,
              baseBranch: detail.baseBranch,
            }),
          ),
      },
    ];
    if (activityQuery.data !== null) {
      items.push({
        type: "action",
        title: "Fix all findings",
        onPress: startFixFindings,
      });
    } else if (activityQuery.error !== null) {
      items.push({
        type: "action",
        title: "Fix all findings",
        onPress: () =>
          Alert.alert(
            "Could not load the conversation",
            activityQuery.error ??
              "The review comments have not loaded yet. Try again after they appear.",
          ),
      });
    }
    if (detail.state === "open" && detail.isDraft && can("ready")) {
      items.push({
        type: "action",
        title: "Mark ready for review",
        onPress: () => void perform("ready"),
      });
    }
    if (detail.state === "open" && !detail.isDraft && can("draft")) {
      items.push({
        type: "action",
        title: "Convert to draft",
        onPress: () => void perform("draft"),
      });
    }
    if (canRequestPullRequestReviewers(detail)) {
      items.push({
        type: "action",
        title: "Request reviewers",
        onPress: () =>
          navigation.navigate("PullRequestReviewers", {
            environmentId: String(environmentId),
            projectId: props.route.params.projectId,
            repository,
            number: String(number),
          }),
      });
    }
    if (detail.state === "open" && can("close")) {
      items.push({
        type: "action",
        title: "Close pull request",
        destructive: true,
        onPress: () =>
          Alert.alert("Close pull request", "Close this pull request on the host?", [
            { text: "Cancel", style: "cancel" },
            { text: "Close", style: "destructive", onPress: () => void perform("close") },
          ]),
      });
    }
    if (detail.state === "closed" && can("reopen")) {
      items.push({
        type: "action",
        title: "Reopen pull request",
        onPress: () => void perform("reopen"),
      });
    }
    return items;
  }, [
    activityQuery.data,
    activityQuery.error,
    can,
    detail,
    environmentId,
    handoff,
    startFixFindings,
    navigation,
    number,
    openOnHost,
    perform,
    props.route.params.projectId,
    refresh,
    repository,
  ]);

  const androidMoreActions = useMemo<MenuAction[]>(
    () =>
      moreItems.map((item, index) => ({
        id: String(index),
        title: item.title,
        attributes: item.destructive ? { destructive: true } : undefined,
      })),
    [moreItems],
  );

  const [showGrokReviewSummaries, setShowGrokReviewSummaries] = useState(false);
  useEffect(() => {
    setShowGrokReviewSummaries(false);
  }, [detail?.url]);
  const grokReviewSummaryCount = detail === null ? 0 : countGrokReviewSummaries(detail.comments);
  const conversation = useMemo(() => {
    if (detail === null) return [];
    return groupPullRequestConversation(
      visiblePullRequestConversationComments(detail.comments, showGrokReviewSummaries),
      detail.reviewThreads,
      "oldest",
    );
  }, [detail, showGrokReviewSummaries]);
  const timeline = useMemo(() => {
    if (detail === null) return [];
    return buildPullRequestTimeline({
      ...detail,
      comments: visiblePullRequestConversationComments(detail.comments, showGrokReviewSummaries),
    });
  }, [detail, showGrokReviewSummaries]);

  const conflicting = detail?.mergeability === "conflicting";
  const canMerge =
    detail !== null &&
    detail.state === "open" &&
    !detail.isDraft &&
    can("merge") &&
    mergeMethods.length > 0;
  const busy = actionPending;

  if (number === null || reference === null) {
    return (
      <View
        className="flex-1 items-center justify-center bg-sheet px-8"
        style={glassHeaderInset > 0 ? { paddingTop: glassHeaderInset } : undefined}
      >
        <EmptyState
          title="Pull request not found"
          detail={
            number === null
              ? "This link does not name a pull request."
              : "This link does not name a repository. Open the pull request from the list, or from a project that has a repository identity."
          }
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title={detail ? `#${detail.number}` : "Pull request"}
            subtitle={repository}
            onBack={() => navigation.goBack()}
            trailing={
              moreItems.length === 0 ? null : (
                <ControlPillMenu
                  title="Pull request"
                  actions={androidMoreActions}
                  isAnchoredToRight
                  onPressAction={({ nativeEvent }) => {
                    moreItems[Number(nativeEvent.event)]?.onPress();
                  }}
                >
                  <AndroidHeaderIconButton accessibilityLabel="More actions" icon="ellipsis" />
                </ControlPillMenu>
              )
            }
          />
        </>
      ) : (
        <NativeStackScreenOptions
          optionsVersion={moreItems.map((item) => item.title)}
          options={{
            title: detail ? `#${detail.number}` : "Pull request",
            headerTintColor: iconColor,
            unstable_headerRightItems: () => [
              withNativeGlassHeaderItem({
                type: "menu",
                label: "",
                accessibilityLabel: "More actions",
                icon: { name: "ellipsis", type: "sfSymbol" },
                menu: {
                  title: "Pull request",
                  items: moreItems.map((item) => ({
                    type: "action" as const,
                    label: item.title,
                    onPress: item.onPress,
                    destructive: item.destructive === true,
                  })),
                },
              }),
            ],
          }}
        />
      )}

      {/* Glass headers overlay the screen. This chrome is not in a primary
          ScrollView, so automatic content inset never runs — pad it ourselves. */}
      <View
        className="flex-1"
        style={glassHeaderInset > 0 ? { paddingTop: glassHeaderInset } : undefined}
      >
        {detailQuery.isPending && detail === null ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={iconColor} />
          </View>
        ) : detailQuery.error && detail === null ? (
          <View className="flex-1 justify-center px-6">
            <EmptyState
              title="Could not load this pull request"
              detail={detailQuery.error}
              actionLabel="Retry"
              onAction={() => void refresh()}
            />
          </View>
        ) : detail === null || presentation === null ? null : (
          <>
            <View className="px-4 pb-3 pt-2">
              <View className="flex-row items-center gap-2">
                <PullRequestStateBadge
                  isDraft={detail.isDraft}
                  mergeability={detail.mergeability}
                  state={detail.state}
                  baseBranch={detail.baseBranch}
                />
                <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
                  #{detail.number} · {detail.repository}
                </Text>
              </View>
              <Text
                className="mt-2.5 text-xl font-t3-bold leading-tight text-foreground"
                numberOfLines={4}
              >
                {detail.title}
              </Text>
              <View className="mt-3 flex-row items-center gap-2">
                <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                  <View className="min-w-0 max-w-[46%] rounded-full bg-subtle px-2.5 py-1">
                    <Text className="font-mono text-2xs text-foreground" numberOfLines={1}>
                      {detail.headBranch}
                    </Text>
                  </View>
                  <Text className="text-2xs text-foreground-tertiary">→</Text>
                  <View className="min-w-0 max-w-[46%] rounded-full bg-subtle px-2.5 py-1">
                    <Text className="font-mono text-2xs text-foreground" numberOfLines={1}>
                      {detail.baseBranch}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="mt-3.5 flex-row rounded-full bg-subtle p-1">
                {visibleTabs.map((item) => {
                  const selected = tab === item.value;
                  const count =
                    item.value === "conversation"
                      ? detail.commentCount
                      : item.value === "files"
                        ? detail.changedFiles
                        : null;
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setTab(item.value)}
                      style={({ pressed }) => ({ opacity: pressed && !selected ? 0.7 : 1 })}
                      className={cn(
                        "min-h-9 flex-1 flex-row items-center justify-center gap-1 rounded-full",
                        selected ? "bg-card" : undefined,
                      )}
                    >
                      <Text
                        className={cn(
                          "text-sm font-t3-bold",
                          selected ? "text-foreground" : "text-foreground-muted",
                        )}
                      >
                        {item.label}
                      </Text>
                      {count !== null && count > 0 ? (
                        <Text
                          className={cn(
                            "text-2xs tabular-nums",
                            selected ? "text-foreground-muted" : "text-foreground-tertiary",
                          )}
                        >
                          {count}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
              contentInsetAdjustmentBehavior="automatic"
              refreshControl={
                <RefreshControl
                  refreshing={detailQuery.isPending && detail !== null}
                  onRefresh={() => void refresh()}
                  tintColor={String(iconColor)}
                />
              }
            >
              {tab === "overview" ? (
                <OverviewTab
                  detail={detail}
                  onRequestReviewers={() =>
                    navigation.navigate("PullRequestReviewers", {
                      environmentId: String(environmentId),
                      projectId: props.route.params.projectId,
                      repository,
                      number: String(number),
                    })
                  }
                />
              ) : null}
              {tab === "conversation" ? (
                activityQuery.isPending && activityQuery.data === null ? (
                  <View className="items-center py-16">
                    <ActivityIndicator color={iconColor} />
                  </View>
                ) : activityQuery.error && activityQuery.data === null ? (
                  <EmptyState
                    title="Could not load the conversation"
                    detail={activityQuery.error}
                    actionLabel="Retry"
                    onAction={() => activityQuery.refresh()}
                  />
                ) : (
                  <PullRequestConversation
                    busy={busy}
                    canReview={reviewVerdicts.length > 0}
                    conversation={conversation}
                    detail={detail}
                    hiddenGrokReviewSummaryCount={grokReviewSummaryCount}
                    showGrokReviewSummaries={showGrokReviewSummaries}
                    timeline={timeline}
                    onToggleGrokReviewSummaries={() =>
                      setShowGrokReviewSummaries((current) => !current)
                    }
                    onComment={() =>
                      navigation.navigate("PullRequestComment", {
                        environmentId: String(environmentId),
                        projectId: props.route.params.projectId,
                        repository,
                        number: String(number),
                        mode: "comment",
                      })
                    }
                    onFixAll={
                      countUnresolvedReviewThreads(detail.reviewThreads) > 0 ||
                      detail.checks.some(
                        (check) => check.status === "failure" || check.status === "cancelled",
                      )
                        ? startFixFindings
                        : undefined
                    }
                    onFixThread={(thread) =>
                      handoff(
                        buildFixFindingPrompt({
                          provider: detail.provider,
                          host: pullRequestUrlHost(detail.url) ?? detail.repository,
                          number: detail.number,
                          title: detail.title,
                          url: detail.url,
                          headBranch: detail.headBranch,
                          baseBranch: detail.baseBranch,
                          finding: { kind: "thread", thread },
                          canResolve:
                            detail.viewerPermissions.resolve && detail.capabilities.review.resolve,
                        }),
                      )
                    }
                    onReply={(threadId) =>
                      navigation.navigate("PullRequestComment", {
                        environmentId: String(environmentId),
                        projectId: props.route.params.projectId,
                        repository,
                        number: String(number),
                        mode: "reply",
                        threadId,
                      })
                    }
                    onReview={openReview}
                    onToggleResolved={async (thread, resolved) => {
                      const result = await setThreadResolution({
                        environmentId,
                        input: { ...reference, threadId: thread.id, resolved },
                      });
                      if (AsyncResult.isFailure(result)) {
                        Alert.alert(
                          resolved ? "Could not resolve" : "Could not unresolve",
                          readableFailure(
                            squashAtomCommandFailure(result),
                            "The host refused to change this conversation.",
                          ),
                        );
                        return false;
                      }
                      await invalidate({ environmentId, input: { reference } });
                      activityQuery.refresh();
                      return true;
                    }}
                  />
                )
              ) : null}
              {tab === "files" ? (
                <FilesTab
                  error={diffSlices.error}
                  files={diffSlices.files}
                  loading={diffSlices.loading}
                  loadingMore={diffSlices.loadingMore}
                  nextCursor={diffSlices.nextCursor}
                  truncated={diffSlices.truncated}
                  onLoadMore={diffSlices.loadMore}
                  onOpenFile={(path) =>
                    navigation.navigate("PullRequestDiff", {
                      environmentId: String(environmentId),
                      projectId: props.route.params.projectId,
                      repository,
                      number: String(number),
                      path,
                    })
                  }
                />
              ) : null}
            </ScrollView>

            {detail.state === "open" ? (
              <View
                className="absolute inset-x-0 bottom-0 border-t border-border bg-sheet px-4 pt-3"
                style={{ paddingBottom: Math.max(insets.bottom, 12) }}
              >
                {conflicting ? (
                  <PullRequestPrimaryButton
                    disabled={busy}
                    label="Resolve conflicts in a thread"
                    onPress={() =>
                      handoff(
                        buildResolveConflictsPrompt({
                          number: detail.number,
                          url: detail.url,
                          headBranch: detail.headBranch,
                          baseBranch: detail.baseBranch,
                        }),
                      )
                    }
                    tone="danger"
                  />
                ) : canMerge ? (
                  Platform.OS === "android" && androidMergeActions.length > 1 ? (
                    <ControlPillMenu
                      title="Merge pull request"
                      actions={androidMergeActions}
                      onPressAction={({ nativeEvent }) => {
                        void perform("merge", nativeEvent.event as PullRequestMergeMethod);
                      }}
                    >
                      <PullRequestPrimaryButton
                        disabled={busy}
                        label={actionPending ? "Merging…" : "Merge pull request"}
                        loading={actionPending}
                      />
                    </ControlPillMenu>
                  ) : (
                    <PullRequestPrimaryButton
                      disabled={busy}
                      label={actionPending ? "Merging…" : "Merge pull request"}
                      loading={actionPending}
                      onPress={confirmMerge}
                    />
                  )
                ) : reviewVerdicts.length > 0 ? (
                  <PullRequestPrimaryButton label="Submit a review" onPress={openReview} />
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function OverviewTab(props: {
  readonly detail: NonNullable<ReturnType<typeof composePullRequestDetailView>>;
  readonly onRequestReviewers: () => void;
}) {
  const { detail } = props;
  const muted = String(useThemeColor("--color-icon-subtle"));
  const diff = formatDiffStat(detail.additions, detail.deletions);
  return (
    <View className="gap-3.5 pt-1">
      <View className="rounded-2xl bg-card px-4 py-3.5">
        <View className="flex-row items-center gap-2.5">
          <PullRequestActorAvatar actor={detail.author} size={28} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-t3-bold text-foreground" numberOfLines={1}>
              {detail.author?.login ?? "ghost"}
            </Text>
            <Text className="text-xs text-foreground-muted">
              opened {relativeTime(detail.createdAt)}
            </Text>
          </View>
        </View>
        {diff ? (
          <MetaLine icon="doc.text" tint={muted} label={`${diff} · ${detail.changedFiles} files`} />
        ) : null}
        <MetaLine
          icon="checkmark.circle"
          tint={muted}
          label={summarizePullRequestChecks(detail.checks)}
        />
        {detail.labels.length > 0 ? (
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {detail.labels.map((label) => {
              const color = pullRequestLabelColor(label.color);
              return (
                <View
                  key={label.name}
                  className="rounded-full bg-subtle px-2 py-0.5"
                  style={color ? { backgroundColor: `${color}22` } : undefined}
                >
                  <Text
                    className="text-2xs text-foreground-muted"
                    style={color ? { color } : undefined}
                  >
                    {label.name}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {detail.reviewers.length > 0 || canRequestPullRequestReviewers(detail) ? (
        <View className="rounded-2xl bg-card px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-t3-bold text-foreground">Reviewers</Text>
            {canRequestPullRequestReviewers(detail) ? (
              <PullRequestActionChip
                label="Edit"
                onPress={props.onRequestReviewers}
                variant="quiet"
              />
            ) : null}
          </View>
          {detail.reviewers.length === 0 ? (
            <Text className="mt-2 text-sm text-foreground-muted">No reviewers requested</Text>
          ) : (
            detail.reviewers.map((reviewer) => (
              <View key={reviewer.login} className="mt-2.5 flex-row items-center gap-2.5">
                <PullRequestActorAvatar actor={reviewer} size={24} />
                <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                  {reviewer.name ?? reviewer.login}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {detail.checks.length > 0 ? (
        <View className="rounded-2xl bg-card px-4 py-3.5">
          <Text className="text-sm font-t3-bold text-foreground">Checks</Text>
          {detail.checks.map((check) => (
            <View
              key={`${check.name}:${check.url ?? ""}`}
              className="mt-2.5 flex-row items-center gap-2"
            >
              <SymbolView
                name={pullRequestCheckSymbol(check.status)}
                size={14}
                tintColor={pullRequestCheckStatusTint(check.status)}
                type="monochrome"
              />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {check.name}
              </Text>
              <Text className={cn("text-xs", pullRequestCheckStatusTextClass(check.status))}>
                {pullRequestCheckStatusLabel(check.status)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {hasVisiblePullRequestBody(detail.body) ? (
        <View className="rounded-2xl bg-card px-4 py-3.5">
          <Text className="mb-2.5 text-sm font-t3-bold text-foreground">Description</Text>
          <PullRequestMarkdown markdown={detail.body} />
        </View>
      ) : null}
    </View>
  );
}

function MetaLine(props: {
  readonly icon: Parameters<typeof SymbolView>[0]["name"];
  readonly tint: string;
  readonly label: string;
}) {
  return (
    <View className="flex-row items-center gap-2 py-1.5">
      <SymbolView name={props.icon} size={14} tintColor={props.tint} type="monochrome" />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>
        {props.label}
      </Text>
    </View>
  );
}

function FilesTab(props: {
  readonly files: ReadonlyArray<ParsedDiffFile>;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly onLoadMore: () => void;
  readonly onOpenFile: (path: string) => void;
}) {
  const muted = String(useThemeColor("--color-icon-subtle"));
  if (props.loading) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator color={muted} />
      </View>
    );
  }
  if (props.error && props.files.length === 0) {
    return <EmptyState title="Could not load the diff" detail={props.error} />;
  }
  if (props.files.length === 0) {
    return (
      <EmptyState
        variant="plain"
        title="No files in this diff"
        detail="The host did not return a patch for this pull request."
      />
    );
  }
  return (
    <View className="gap-2.5 pt-1">
      {props.truncated ? (
        <Text className="text-xs text-foreground-muted">
          This slice of the diff is truncated. Open a file to read it.
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-2xl bg-card">
        {props.files.map((file, index) => {
          const diff = formatDiffStat(file.additions, file.deletions);
          return (
            <Pressable
              key={file.key}
              onPress={() => props.onOpenFile(file.displayPath)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.72 : 1,
                borderBottomWidth: index === props.files.length - 1 ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: "rgba(127,127,127,0.18)",
              })}
              className="flex-row items-center gap-3 px-4 py-3.5"
            >
              <SymbolView name="doc.text" size={15} tintColor={muted} type="monochrome" />
              <Text className="flex-1 font-mono text-sm text-foreground" numberOfLines={1}>
                {file.displayPath}
              </Text>
              {diff ? (
                <Text className="font-mono text-2xs tabular-nums text-foreground-tertiary">
                  {diff}
                </Text>
              ) : file.withheld ? (
                <Text className="text-2xs text-foreground-tertiary">Truncated</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {props.nextCursor !== null ? (
        <PullRequestActionChip
          disabled={props.loadingMore}
          label="Load more files"
          loading={props.loadingMore}
          loadingLabel="Loading more files…"
          onPress={props.onLoadMore}
        />
      ) : null}
      {props.error ? <Text className="text-xs text-foreground-muted">{props.error}</Text> : null}
    </View>
  );
}
