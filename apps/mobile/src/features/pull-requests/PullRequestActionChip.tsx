import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

export type PullRequestActionChipVariant = "default" | "primary" | "resolve" | "quiet";

export function PullRequestActionChip(props: {
  readonly label: string;
  readonly loadingLabel?: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly variant?: PullRequestActionChipVariant;
  readonly accessibilityLabel?: string;
  readonly icon?: Parameters<typeof SymbolView>[0]["name"];
}) {
  const variant = props.variant ?? "default";
  const loading = props.loading === true;
  const disabled = props.disabled === true || loading;
  const spinnerClass =
    variant === "primary"
      ? "accent-primary-foreground"
      : variant === "resolve"
        ? "accent-adaptive-emerald-600-400"
        : "accent-icon";
  const iconClass =
    variant === "primary"
      ? "accent-primary-foreground"
      : variant === "resolve"
        ? "accent-adaptive-emerald-600-400"
        : disabled
          ? "accent-icon-subtle"
          : "accent-icon";

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        props.onPress();
      }}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
      })}
      className={cn(
        "min-h-9 flex-row items-center justify-center gap-1.5 rounded-full px-3",
        variant === "primary"
          ? "bg-primary"
          : variant === "resolve"
            ? "bg-emerald-500/15"
            : variant === "quiet"
              ? "bg-transparent"
              : "bg-subtle",
      )}
    >
      {loading ? (
        <ActivityIndicator colorClassName={spinnerClass} size="small" />
      ) : props.icon !== undefined ? (
        <SymbolView name={props.icon} size={13} tintColorClassName={iconClass} type="monochrome" />
      ) : null}
      <Text
        className={cn(
          "text-xs font-t3-bold",
          variant === "primary"
            ? "text-primary-foreground"
            : variant === "resolve"
              ? "text-adaptive-emerald-700-400"
              : "text-foreground",
        )}
      >
        {loading ? (props.loadingLabel ?? `${props.label}…`) : props.label}
      </Text>
    </Pressable>
  );
}

export function PullRequestPrimaryButton(props: {
  readonly label: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  readonly tone?: "primary" | "danger";
  readonly accessibilityLabel?: string;
}) {
  const loading = props.loading === true;
  const disabled = props.disabled === true || loading;
  const tone = props.tone ?? "primary";
  const spinnerClass = tone === "danger" ? "accent-danger-foreground" : "accent-primary-foreground";

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.55 : pressed ? 0.82 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      })}
      className={cn(
        "h-12 flex-row items-center justify-center gap-2 rounded-full",
        tone === "danger" ? "bg-danger" : "bg-primary",
      )}
    >
      {loading ? <ActivityIndicator colorClassName={spinnerClass} size="small" /> : null}
      <Text
        className={cn(
          "text-base font-t3-bold",
          tone === "danger" ? "text-danger-foreground" : "text-primary-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function PullRequestChipRow(props: { readonly children: ReactNode }) {
  return <View className="flex-row flex-wrap items-center gap-2">{props.children}</View>;
}
