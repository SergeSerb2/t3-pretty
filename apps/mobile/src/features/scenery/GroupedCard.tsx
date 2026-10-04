import type { ComponentProps, ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";

import { RowPressable } from "../../components/RowPressable";
import { cn } from "../../lib/cn";
import { GLASS_CARD_RADIUS } from "../../lib/layoutMetrics";
import { useGlassChromeActive } from "./SceneryProvider";

/** Fill and edge of a glass card; pair with `glassCardStyle`. */
export const GLASS_CARD_CLASS_NAME = "border-chrome-glass-border bg-chrome-glass";

/** Text field on glass: a tint of the card instead of an opaque input plate. */
export const GLASS_INPUT_CLASS_NAME =
  "rounded-[14px] border-[0.5px] border-chrome-glass-border bg-foreground/5";

/**
 * Shape of a glass card, or of one row when list cells assemble the card and
 * cannot share a GroupedCard parent: only the outer corners round and the
 * hairline edge continues across rows. Inline because cn() would drop
 * `border-continuous` beside a border color.
 */
export function glassCardStyle(isFirst = true, isLast = true): ViewStyle {
  const top = isFirst ? GLASS_CARD_RADIUS : 0;
  const bottom = isLast ? GLASS_CARD_RADIUS : 0;
  return {
    borderCurve: "continuous",
    borderTopLeftRadius: top,
    borderTopRightRadius: top,
    borderBottomLeftRadius: bottom,
    borderBottomRightRadius: bottom,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: isFirst ? StyleSheet.hairlineWidth : 0,
    borderBottomWidth: isLast ? StyleSheet.hairlineWidth : 0,
    overflow: "hidden",
  };
}

/**
 * Container for a group of rows. Over scenery on iOS it is a frosted glass
 * card (translucent fill + hairline edge, no live blur); elsewhere it is the
 * opaque grouped card. Rows inside paint no fill of their own.
 */
export function GroupedCard({ className, style, ...props }: ViewProps) {
  const glass = useGlassChromeActive();
  return (
    <View
      {...props}
      className={cn(
        Platform.OS === "android"
          ? "overflow-hidden rounded-[28px] bg-grouped-card"
          : glass
            ? GLASS_CARD_CLASS_NAME
            : "overflow-hidden rounded-[24px] border-continuous bg-grouped-card",
        className,
      )}
      style={[glass ? glassCardStyle() : undefined, style]}
    />
  );
}

/**
 * Row press target inside glass cards. Over glass it raises a UIKit-style
 * highlight that fades on release; elsewhere it stays a plain Pressable with
 * `fallbackClassName` as its press styling.
 */
export function GlassRowPressable({
  className,
  fallbackClassName,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children" | "className"> & {
  readonly children: ReactNode;
  readonly className?: string;
  readonly fallbackClassName?: string;
}) {
  const glass = useGlassChromeActive();
  return glass ? (
    <RowPressable {...props} className={className} interactionClassName="bg-foreground/[0.06]" />
  ) : (
    <Pressable {...props} className={cn(className, fallbackClassName)} />
  );
}
