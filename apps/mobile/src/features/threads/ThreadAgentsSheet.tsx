import { useAtomValue } from "@effect/atom-react";
import type { ThreadTurnSubagents } from "@t3tools/client-runtime/state/thread-subagents";
import {
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { Platform, ScrollView, View } from "react-native";
import { Screen, ScreenStack, ScreenStackHeaderConfig } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SheetSurface } from "../../components/SheetSurface";
import { cn } from "../../lib/cn";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { environmentThreadDetails } from "../../state/threads";
import { NativeStackScreenOptions, nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { GroupedCard } from "../scenery/GroupedCard";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { SubagentRow } from "./SubagentRow";
import { GlassRowPressable } from "../scenery/GroupedCard";
import { MaterialScreenContent } from "../../components/MaterialScreenContent";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useSubagentElapsed } from "./use-subagent-elapsed";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

type AgentsTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

const EMPTY_TURN_SUBAGENTS_ATOM = Atom.make<ThreadTurnSubagents | null>(null).pipe(
  Atom.withLabel("mobile-thread-turn-subagents:empty"),
);

export function useThreadTurnSubagents(target: AgentsTarget | null): ThreadTurnSubagents | null {
  return useAtomValue(
    target === null
      ? EMPTY_TURN_SUBAGENTS_ATOM
      : environmentThreadDetails.turnSubagentsAtom(target),
  );
}

export function ThreadAgentsSheet({ route }: StaticScreenProps<AgentsTarget>) {
  const { layout } = useAdaptiveWorkspaceLayout();
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
      nestedScrollEnabled
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
              environmentId={target.environmentId}
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
            environmentId={target.environmentId}
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
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AndroidSheetHeader title="Agents" onBack={() => navigation.goBack()} />
      <MaterialScreenContent insetHorizontal={layout.usesSplitView}>
        {content}
      </MaterialScreenContent>
    </View>
  );
}

function AgentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly glass?: boolean;
  readonly isLast?: boolean;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
  readonly onOpen: (childThreadId: ThreadId) => void;
}) {
  const { subagent } = props;
  const childThreadId = subagent.childThreadId;

  const row = (
    <View
      className={
        props.glass
          ? cn("min-h-14 px-4 py-3", !props.isLast && "border-b border-border-subtle")
          : "border-b border-border py-3.5"
      }
    >
      <SubagentRow
        environmentId={props.environmentId}
        subagent={subagent}
        elapsed={
          <AgentElapsed compact={props.glass} subagent={subagent} tickSeconds={props.tickSeconds} />
        }
      />
    </View>
  );

  if (childThreadId === null) {
    return (
      <View
        accessible
        accessibilityHint="Provider-managed agent. Its work appears in the transcript."
      >
        {row}
      </View>
    );
  }

  return (
    <GlassRowPressable
      accessibilityRole="link"
      accessibilityHint="Opens this agent's thread"
      onPress={() => props.onOpen(childThreadId)}
      fallbackClassName="active:opacity-70"
    >
      {row}
    </GlassRowPressable>
  );
}

function AgentElapsed(props: {
  readonly compact?: boolean;
  readonly subagent: OrchestrationV2Subagent;
  readonly tickSeconds: boolean;
}) {
  const elapsed = useSubagentElapsed(props.subagent, props.tickSeconds);
  return elapsed === null ? null : (
    <Text
      className={cn(
        "shrink-0 tabular-nums text-foreground-muted",
        props.compact ? "text-2xs" : "text-xs",
      )}
    >
      {elapsed}
    </Text>
  );
}
