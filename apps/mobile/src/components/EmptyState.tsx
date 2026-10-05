import { Platform, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import Animated from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import { RowPressable } from "./RowPressable";
import { cn } from "../lib/cn";
import { GLASS_CARD_RADIUS } from "../lib/layoutMetrics";
import { enterFade } from "../lib/motion";
import { useGlassChromeActive } from "../features/scenery/SceneryProvider";

// The action sinks slightly while held on iOS; Android keeps its opacity dim.
const BUTTON_PRESS_SCALE = Platform.OS === "ios" ? 0.97 : undefined;

export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly action?: ReactNode;
  readonly variant?: "card" | "plain";
}) {
  const glass = useGlassChromeActive();
  if (props.variant === "plain") {
    return (
      <Animated.View entering={enterFade} className="items-center px-8 py-8">
        <Text className="text-center text-xl font-t3-bold text-foreground">{props.title}</Text>
        <Text className="mt-2 text-center font-sans text-base leading-normal text-foreground-muted">
          {props.detail}
        </Text>
        {props.action ? (
          <View className="mt-5">{props.action}</View>
        ) : props.actionLabel && props.onAction ? (
          <RowPressable
            accessibilityRole="button"
            className="mt-5 rounded-full bg-primary px-5 py-3 active:opacity-70"
            interactionOpacity={0}
            pressScale={BUTTON_PRESS_SCALE}
            onPress={props.onAction}
          >
            <Text className="text-sm font-t3-bold text-primary-foreground">
              {props.actionLabel}
            </Text>
          </RowPressable>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={enterFade}
      className={cn(
        "rounded-[22px] p-5",
        glass ? "border-chrome-glass-border bg-chrome-glass" : "border border-border bg-card",
      )}
      style={
        glass
          ? {
              borderCurve: "continuous",
              borderRadius: GLASS_CARD_RADIUS,
              borderWidth: StyleSheet.hairlineWidth,
            }
          : undefined
      }
    >
      <Text className="font-t3-bold text-lg text-foreground">{props.title}</Text>
      <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
        {props.detail}
      </Text>
      {props.action ? (
        <View className="mt-4 self-start">{props.action}</View>
      ) : props.actionLabel && props.onAction ? (
        <View className="mt-4 self-start">
          <RowPressable
            accessibilityRole="button"
            className="rounded-full bg-primary px-4 py-2.5 active:opacity-70"
            interactionOpacity={0}
            pressScale={BUTTON_PRESS_SCALE}
            onPress={props.onAction}
          >
            <Text className="text-sm font-t3-bold text-primary-foreground">
              {props.actionLabel}
            </Text>
          </RowPressable>
        </View>
      ) : null}
    </Animated.View>
  );
}
