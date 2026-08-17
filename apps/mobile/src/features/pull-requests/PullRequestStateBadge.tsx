import { View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { resolvePullRequestState, type PullRequestStateKind } from "./pullRequestPresentation";

const SYMBOL_COLOR: Record<PullRequestStateKind, string> = {
  merged: "#7c3aed",
  closed: "#dc2626",
  draft: "#71717a",
  conflicting: "#e11d48",
  open: "#059669",
};

export function PullRequestStateBadge(props: {
  readonly state: Parameters<typeof resolvePullRequestState>[0]["state"];
  readonly isDraft: boolean;
  readonly mergeability?: Parameters<typeof resolvePullRequestState>[0]["mergeability"];
  readonly baseBranch?: string;
  readonly compact?: boolean;
}) {
  const presentation = resolvePullRequestState(props);
  const fallbackIcon = useThemeColor("--color-icon");
  const tint = SYMBOL_COLOR[presentation.kind] ?? String(fallbackIcon);
  if (props.compact) {
    return <SymbolView name={presentation.symbol} size={16} tintColor={tint} type="monochrome" />;
  }
  return (
    <View
      className={cn(
        "flex-row items-center gap-1.5 rounded-full px-2.5 py-1",
        presentation.badgeClassName,
      )}
    >
      <SymbolView name={presentation.symbol} size={13} tintColor={tint} type="monochrome" />
      <Text className={cn("text-2xs font-t3-bold", presentation.textClassName)} numberOfLines={1}>
        {presentation.label}
      </Text>
    </View>
  );
}
