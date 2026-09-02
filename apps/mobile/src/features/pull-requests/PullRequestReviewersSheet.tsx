import type { PullRequestReviewerCandidate } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react-native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, TextInput, View } from "react-native";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { cn } from "../../lib/cn";
import { limitMobileSearchQuery, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH } from "../../lib/searchQuery";
import { useThemeColor } from "../../lib/useThemeColor";
import { PullRequestActorAvatar } from "./PullRequestActorAvatar";
import { useEnvironmentQuery } from "../../state/query";
import { pullRequestEnvironment } from "../../state/pullRequests";
import { useAtomCommand } from "../../state/use-atom-command";
import { readableFailure } from "./pullRequestDetail.logic";
import {
  resolvePullRequestRouteEnvironmentId,
  type PullRequestDetailRouteParams,
} from "./pullRequestNavigation";
import { useResolvedPullRequestReference } from "./useResolvedPullRequestReference";

type PullRequestReviewersSheetProps = StaticScreenProps<PullRequestDetailRouteParams>;

export function PullRequestReviewersSheet(props: PullRequestReviewersSheetProps) {
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon");
  const environmentId = resolvePullRequestRouteEnvironmentId(props.route.params.environmentId);
  const reference = useResolvedPullRequestReference(props.route.params);
  const [query, setQueryState] = useState("");
  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(limitMobileSearchQuery(nextQuery, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH));
  }, []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const candidatesQuery = useEnvironmentQuery(
    reference === null
      ? null
      : pullRequestEnvironment.reviewerCandidates({
          environmentId,
          input: reference,
        }),
  );
  const requestReviewers = useAtomCommand(pullRequestEnvironment.requestReviewers, {
    reportFailure: false,
  });
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();
  const candidates = useMemo(
    () =>
      (candidatesQuery.data?.candidates ?? []).filter(
        (candidate) =>
          needle.length === 0 ||
          candidate.login.toLowerCase().includes(needle) ||
          (candidate.name ?? "").toLowerCase().includes(needle),
      ),
    [candidatesQuery.data, needle],
  );
  const toggleReviewer = useCallback(
    async (candidate: PullRequestReviewerCandidate) => {
      if (reference === null || pendingRef.current) return;
      pendingRef.current = true;
      setPendingId(candidate.id);
      try {
        const result = await requestReviewers({
          environmentId,
          input: {
            ...reference,
            reviewers: [{ id: candidate.id, kind: candidate.kind }],
            requested: !candidate.isRequested,
          },
        });
        if (AsyncResult.isFailure(result)) {
          if (mountedRef.current && navigation.isFocused()) {
            Alert.alert(
              "Could not update reviewers",
              readableFailure(
                squashAtomCommandFailure(result),
                "The host refused this reviewer change.",
              ),
            );
          }
          return;
        }
        await invalidate({ environmentId, input: { reference } });
        if (mountedRef.current && navigation.isFocused()) {
          candidatesQuery.refresh();
        }
      } finally {
        pendingRef.current = false;
        if (mountedRef.current) {
          setPendingId(null);
        }
      }
    },
    [candidatesQuery, environmentId, invalidate, navigation, reference, requestReviewers],
  );
  const renderCandidate = useCallback(
    ({ item: candidate, index }: { item: PullRequestReviewerCandidate; index: number }) => (
      <Pressable
        accessibilityLabel={`${candidate.name ?? candidate.login}, ${
          candidate.isRequested ? "review requested" : "request review"
        }`}
        accessibilityRole="button"
        accessibilityState={{
          busy: pendingId === candidate.id,
          disabled: pendingId !== null || reference === null,
        }}
        disabled={pendingId !== null || reference === null}
        onPress={() => void toggleReviewer(candidate)}
        className={cn(
          "flex-row items-center gap-3 bg-card px-4 py-3",
          index === 0 && "rounded-t-2xl",
          index === candidates.length - 1 && "rounded-b-2xl",
          index > 0 && "border-t border-border-subtle",
        )}
        style={({ pressed }) => ({
          opacity: pendingId !== null && pendingId !== candidate.id ? 0.45 : pressed ? 0.72 : 1,
        })}
      >
        <PullRequestActorAvatar actor={candidate} size={32} />
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
            {candidate.name ?? candidate.login}
          </Text>
          {candidate.name ? (
            <Text className="text-xs text-foreground-muted">{candidate.login}</Text>
          ) : null}
        </View>
        {pendingId === candidate.id ? (
          <ActivityIndicator color={String(iconColor)} size="small" />
        ) : (
          <Text
            className={cn(
              "text-xs font-t3-bold",
              candidate.isRequested ? "text-primary" : "text-foreground-muted",
            )}
          >
            {candidate.isRequested ? "Requested" : "Ask"}
          </Text>
        )}
      </Pressable>
    ),
    [candidates.length, iconColor, pendingId, reference, toggleReviewer],
  );
  const rowState = useMemo(
    () => ({ iconColor, pendingId, referenceAvailable: reference !== null }),
    [iconColor, pendingId, reference],
  );

  return (
    <View className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title="Reviewers" onBack={() => navigation.goBack()} />
      ) : (
        <NativeStackScreenOptions options={{ title: "Reviewers" }} />
      )}
      <View className="px-4 pb-2 pt-3">
        <TextInput
          accessibilityLabel="Search reviewers"
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search people"
          placeholderTextColorClassName="accent-placeholder"
          className="min-h-11 rounded-2xl bg-input px-3.5 py-2 text-base font-sans text-foreground"
          value={query}
        />
      </View>
      {candidatesQuery.isPending && candidatesQuery.data === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={iconColor} />
        </View>
      ) : candidatesQuery.error && candidatesQuery.data === null ? (
        <View className="flex-1 justify-center px-6">
          <EmptyState title="Could not load reviewers" detail={candidatesQuery.error} />
        </View>
      ) : (
        <LegendList
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          contentInsetAdjustmentBehavior="automatic"
          data={candidates}
          estimatedItemSize={56}
          extraData={rowState}
          keyExtractor={(candidate) => candidate.id}
          ListEmptyComponent={
            <EmptyState
              variant="plain"
              title="No matching people"
              detail="The host did not return anyone for this search."
            />
          }
          ListFooterComponent={
            candidatesQuery.data?.truncated === true ? (
              <Text className="mt-3 text-xs text-foreground-muted">
                The host has more people with access than this list shows.
              </Text>
            ) : null
          }
          recycleItems
          renderItem={renderCandidate}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
