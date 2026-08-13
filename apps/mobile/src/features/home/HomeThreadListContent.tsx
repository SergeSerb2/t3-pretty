import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import type { HomeStatusBriefing } from "./homeStatusBriefing";

const StatusMetric = memo(function StatusMetric(props: {
  readonly label: string;
  readonly value: number | string;
  readonly valueClassName: string;
}) {
  return (
    <View className="min-h-[52px] flex-1 justify-center px-2">
      <Text className={`text-xl font-t3-bold tabular-nums ${props.valueClassName}`}>
        {props.value}
      </Text>
      <Text className="mt-0.5 text-3xs font-t3-medium text-foreground-muted">{props.label}</Text>
    </View>
  );
});

/**
 * A compact, scrolling status briefing for Home. It summarizes attention
 * before inventory, then hands off to the existing virtualized row model.
 * The rail uses hairlines rather than three cards so scenery stays present
 * without adding more glass surfaces.
 */
export const HomeThreadListContent = memo(function HomeThreadListContent(props: {
  readonly briefing: HomeStatusBriefing;
  readonly scopeLabel: string;
}) {
  const borderColor = useThemeColor("--color-border");
  const liveWorkCount = props.briefing.isPending ? 0 : props.briefing.counts.live;
  const needsAttentionLabel =
    props.briefing.counts.needsAttention === 1
      ? "1 needs attention."
      : `${props.briefing.counts.needsAttention} need attention.`;
  const statusAccessibilityLabel = props.briefing.isPending
    ? "Search results are loading."
    : [
        "Current status.",
        needsAttentionLabel,
        `${props.briefing.counts.inMotion} in motion.`,
        `${props.briefing.counts.queued} queued.`,
      ].join(" ");
  const statusValue = (value: number) => (props.briefing.isPending ? "—" : value);

  return (
    <View className="w-full max-w-[720px] self-center px-5 pb-2 pt-5">
      <View>
        <Text className="text-xs font-t3-medium text-foreground-muted">Field briefing</Text>
        <Text
          aria-level={2}
          role="heading"
          className="mt-1 text-2xl font-t3-bold tracking-[-0.7px] text-foreground"
        >
          {props.briefing.title}
        </Text>
        <Text className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-foreground-secondary">
          {props.briefing.detail}
        </Text>
        <Text className="mt-2 text-xs font-t3-medium text-foreground-tertiary">
          {props.scopeLabel}
        </Text>
      </View>

      <View
        accessible
        accessibilityLabel={statusAccessibilityLabel}
        accessibilityRole="summary"
        className="mt-5 flex-row items-center"
        style={{
          borderBottomColor: borderColor,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderTopColor: borderColor,
          borderTopWidth: StyleSheet.hairlineWidth,
        }}
      >
        <StatusMetric
          label="Needs you"
          value={statusValue(props.briefing.counts.needsAttention)}
          valueClassName={
            !props.briefing.isPending && props.briefing.counts.needsAttention > 0
              ? "text-amber-700 dark:text-amber-300"
              : "text-foreground-tertiary"
          }
        />
        <View
          className="h-8"
          style={{ backgroundColor: borderColor, width: StyleSheet.hairlineWidth }}
        />
        <StatusMetric
          label="In motion"
          value={statusValue(props.briefing.counts.inMotion)}
          valueClassName={
            !props.briefing.isPending && props.briefing.counts.inMotion > 0
              ? "text-sky-600 dark:text-sky-400"
              : "text-foreground-tertiary"
          }
        />
        <View
          className="h-8"
          style={{ backgroundColor: borderColor, width: StyleSheet.hairlineWidth }}
        />
        <StatusMetric
          label="Queued"
          value={statusValue(props.briefing.counts.queued)}
          valueClassName={
            !props.briefing.isPending && props.briefing.counts.queued > 0
              ? "text-foreground-secondary"
              : "text-foreground-tertiary"
          }
        />
      </View>

      {liveWorkCount > 0 ? (
        <View className="mb-2 mt-5 flex-row items-baseline justify-between">
          <Text aria-level={2} role="heading" className="text-sm font-t3-bold text-foreground">
            {props.briefing.sectionLabel}
          </Text>
          <Text className="text-xs font-t3-medium tabular-nums text-foreground-tertiary">
            {liveWorkCount}
          </Text>
        </View>
      ) : (
        <View className="h-2" />
      )}
    </View>
  );
});
