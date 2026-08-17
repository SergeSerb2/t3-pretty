import type { PullRequestListEntry } from "@t3tools/contracts";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  checksStateTextClass,
  describeChecksState,
  describeReviewDecision,
  formatDiffStat,
  pullRequestLabelColor,
  resolvePullRequestState,
  reviewDecisionTextClass,
} from "./pullRequestPresentation";
import { PullRequestStateBadge } from "./PullRequestStateBadge";

export function PullRequestRow(props: {
  readonly entry: PullRequestListEntry;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly matchedElsewhere?: boolean;
  readonly showHost?: boolean;
  readonly onPress: (entry: PullRequestListEntry) => void;
}) {
  const separatorColor = useThemeColor("--color-separator");
  const presentation = resolvePullRequestState(props.entry);
  const diff = formatDiffStat(props.entry.additions, props.entry.deletions);
  const reviewDecision = describeReviewDecision(props.entry.reviewDecision);
  const checks = describeChecksState(props.entry.checksState);
  const meta = [
    `#${props.entry.number}`,
    props.entry.repository,
    ...(props.showHost ? [props.entry.host] : []),
    props.entry.author?.login ?? "ghost",
  ].join(" · ");
  const labels = props.entry.labels.slice(0, 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${presentation.label} pull request ${props.entry.title}`}
      onPress={() => props.onPress(props.entry)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.72 : 1,
        borderTopLeftRadius: props.isFirst ? 16 : 0,
        borderTopRightRadius: props.isFirst ? 16 : 0,
        borderBottomLeftRadius: props.isLast ? 16 : 0,
        borderBottomRightRadius: props.isLast ? 16 : 0,
        borderBottomColor: separatorColor,
        borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth,
      })}
      className="bg-card px-4 py-3.5"
    >
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5">
          <PullRequestStateBadge
            compact
            isDraft={props.entry.isDraft}
            mergeability={props.entry.mergeability}
            state={props.entry.state}
            baseBranch={props.entry.baseBranch}
          />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-start gap-3">
            <Text
              className="min-w-0 flex-1 text-base font-t3-bold leading-snug text-foreground"
              numberOfLines={2}
            >
              {props.entry.title}
            </Text>
            <Text className="shrink-0 pt-0.5 text-2xs tabular-nums text-foreground-tertiary">
              {relativeTime(props.entry.updatedAt)}
            </Text>
          </View>
          <Text className="mt-1 text-xs leading-4 text-foreground-muted" numberOfLines={1}>
            {meta}
          </Text>
          <View className="mt-1.5 flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {diff ? (
              <Text className="font-mono text-2xs tabular-nums text-foreground-tertiary">
                {diff}
              </Text>
            ) : null}
            {reviewDecision && props.entry.reviewDecision ? (
              <Text
                className={cn(
                  "text-2xs font-t3-medium",
                  reviewDecisionTextClass(props.entry.reviewDecision),
                )}
              >
                {reviewDecision}
              </Text>
            ) : null}
            {checks && props.entry.checksState ? (
              <Text
                className={cn(
                  "text-2xs font-t3-medium",
                  checksStateTextClass(props.entry.checksState),
                )}
              >
                {checks}
              </Text>
            ) : null}
            {presentation.kind === "conflicting" ? (
              <Text className={cn("text-2xs font-t3-medium", presentation.textClassName)}>
                {presentation.label}
              </Text>
            ) : null}
            {props.entry.viewerReviewRequested ? (
              <Text className="text-2xs font-t3-medium text-amber-600 dark:text-amber-400">
                Review requested
              </Text>
            ) : null}
            {labels.map((label) => {
              const color = pullRequestLabelColor(label.color);
              return (
                <View
                  key={label.name}
                  className="rounded-full bg-subtle px-1.5 py-0.5"
                  style={color ? { backgroundColor: `${color}22` } : undefined}
                >
                  <Text
                    className="text-2xs text-foreground-muted"
                    numberOfLines={1}
                    style={color ? { color } : undefined}
                  >
                    {label.name}
                  </Text>
                </View>
              );
            })}
            {props.matchedElsewhere ? (
              <Text className="rounded-full border border-border px-1.5 py-0.5 text-2xs text-foreground-muted">
                matched in the description
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
