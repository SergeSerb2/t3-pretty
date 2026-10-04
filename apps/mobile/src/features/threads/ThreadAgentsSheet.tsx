import { useAtomValue } from "@effect/atom-react";
import type { ThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import {
  isOrchestrationV2WorkActive,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveSubagentElapsedMs, formatDuration } from "@t3tools/shared/orchestrationTiming";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as DateTime from "effect/DateTime";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { Screen, ScreenStack, ScreenStackHeaderConfig } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { SheetSurface } from "../../components/SheetSurface";
import { cn } from "../../lib/cn";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { environmentThreadDetails } from "../../state/threads";
import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { resolveSubagentRowPresentation } from "./threadAgentsPresentation";
import { GroupedCard } from "../scenery/GroupedCard";
import { useGlassChromeActive } from "../scenery/SceneryProvider";

import { SubagentStatusDot } from "./SubagentStatusDot";
import { GlassRowPressable } from "../scenery/GroupedCard";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export function useThreadTurnSubagents(target: AgentsTarget): ThreadTurnSubagents | null {
  return useAtomValue(environmentThreadDetails.turnSubagentsAtom(target));
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const target = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const theme = useUniwindTheme();
  const turn = useThreadTurnSubagents(target);
  const subagents = turn?.subagents ?? [];
  const hasLiveAgent = (turn?.liveCount ?? 0) > 0;
  const glass = useGlassChromeActive();

  const openChildThread = (childThreadId: ThreadId) => {
    void Haptics.selectionAsync();
    // Replace rather than push: the sheet is a leaf, and the child thread
    // belongs in the workspace stack where Home's back button expects it.
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: target.environmentId,
        threadId: childThreadId,
      }),
    );
  };

  const content = (
    <ScrollView
      className="flex-1"
      // The iOS header is translucent and floats over this view; UIKit has to
      // inset the content or the first row sits underneath the title.
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="px-5 pb-6"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {subagents.length === 0 ? (
        <Text className="pt-6 text-center text-sm text-foreground-muted">
          No agents in this turn.
        </Text>
      ) : glass ? (
        <GroupedCard>
          {subagents.map((subagent, index) => (
            <AgentRow
              key={subagent.id}
              glass
              isLast={index === subagents.length - 1}
              subagent={subagent}
              tickSeconds={hasLiveAgent}
              onOpen={openChildThread}
            />
          ))}
        </GroupedCard>
      ) : (
        subagents.map((subagent) => (
          <AgentRow
            key={subagent.id}
            subagent={subagent}
            tickSeconds={hasLiveAgent}
            onOpen={openChildThread}
          />
        ))
      )}
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    // A plain formSheet screen never renders a stack header, so it comes from
    // a nested native stack inside the sheet (same shape as the git sheet).
    return (
      <SheetSurface threadKey={`${target.environmentId}:${target.threadId}`}>
        <ScreenStack style={{ flex: 1 }}>
          <Screen
            activityState={2}
            enabled
            isNativeStack
            screenId="thread-agents-sheet-native"
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            style={{ backgroundColor: glass ? "transparent" : theme["--color-sheet"], flex: 1 }}
          >
            {content}
            <ScreenStackHeaderConfig
              backgroundColor="rgba(0,0,0,0)"
              color={theme["--color-foreground"]}
              hideBackButton
              hideShadow={false}
              title="Agents"
              titleColor={theme["--color-foreground"]}
              titleFontSize={18}
              titleFontWeight="800"
              translucent
            />
          </Screen>
        </ScreenStack>
      </SheetSurface>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AndroidSheetHeader title="Agents" onBack={() => navigation.goBack()} />
      {content}
    </View>
  );
}

function AgentRow(props: {
  readonly glass?: boolean;
  readonly isLast?: boolean;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
  readonly onOpen: (childThreadId: ThreadId) => void;
}) {
  const { subagent } = props;
  const presentation = resolveSubagentRowPresentation(subagent);
  const childThreadId = subagent.childThreadId;
  const elapsed = useSubagentElapsed(subagent, props.tickSeconds);

  const row = (
    <View
      className={
        props.glass
          ? cn(
              "min-h-14 flex-row items-center gap-3 px-4 py-3",
              !props.isLast && "border-b border-border-subtle",
            )
          : "min-h-14 flex-row items-center gap-3 border-b border-border py-3"
      }
    >
      <SubagentStatusDot tone={presentation.tone} placement="sheet" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-t3-medium text-sm text-foreground" numberOfLines={1}>
          {presentation.title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {presentation.detail ?? presentation.statusLabel}
        </Text>
      </View>
      {elapsed === null ? null : (
        <Text className="shrink-0 text-2xs tabular-nums text-foreground-muted">{elapsed}</Text>
      )}
      {presentation.canOpenThread ? (
        <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-subtle" />
      ) : null}
    </View>
  );

  if (childThreadId === null) {
    return (
      <View
        accessible
        accessibilityLabel={`${presentation.title}, ${presentation.statusLabel}`}
        accessibilityHint="Provider-managed agent. Its work appears in the transcript."
      >
        {row}
      </View>
    );
  }

  return (
    <GlassRowPressable
      accessibilityRole="link"
      accessibilityLabel={`${presentation.title}, ${presentation.statusLabel}`}
      accessibilityHint="Opens this agent's thread"
      onPress={() => props.onOpen(childThreadId)}
      fallbackClassName="active:opacity-70"
    >
      {row}
    </GlassRowPressable>
  );
}

/**
 * Elapsed time for one agent. Only a roster with live work subscribes to the
 * shared second tick, so a settled sheet never repaints.
 */
function useSubagentElapsed(
  subagent: Pick<OrchestrationV2Subagent, "status" | "startedAt" | "completedAt">,
  tickSeconds: boolean,
): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const running = isOrchestrationV2WorkActive(subagent.status);
  useEffect(() => {
    if (!tickSeconds || !running) return;
    const intervalId = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(intervalId);
  }, [running, tickSeconds]);
  const elapsedMs = deriveSubagentElapsedMs(
    {
      status: subagent.status,
      startedAt: subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt),
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
    },
    nowMs,
  );
  return elapsedMs === null || elapsedMs === 0 ? null : formatDuration(elapsedMs);
}
