import type { ComponentProps, ReactNode } from "react";
import { Platform, Pressable, View, type ViewProps } from "react-native";

import { RowPressable } from "../../components/RowPressable";
import { cn } from "../../lib/cn";
import { GLASS_CARD_CLASS_NAME, glassCardStyle } from "./glassStyles";
import { useGlassChromeActive } from "./SceneryProvider";

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
