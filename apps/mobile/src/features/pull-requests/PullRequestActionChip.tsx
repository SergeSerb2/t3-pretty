import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";

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
  const iconColor = useThemeColor("--color-icon");
  const primaryFg = useThemeColor("--color-primary-foreground");
  const muted = useThemeColor("--color-icon-subtle");
  const spinnerColor =
    variant === "primary" ? primaryFg : variant === "resolve" ? "#059669" : iconColor;
  const iconTint =
    variant === "primary"
      ? String(primaryFg)
      : variant === "resolve"
        ? "#059669"
        : disabled
          ? String(muted)
          : String(iconColor);

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        <ActivityIndicator color={String(spinnerColor)} size="small" />
      ) : props.icon !== undefined ? (
        <SymbolView name={props.icon} size={13} tintColor={iconTint} type="monochrome" />
      ) : null}
      <Text
        className={cn(
          "text-xs font-t3-bold",
          variant === "primary"
            ? "text-primary-foreground"
            : variant === "resolve"
              ? "text-emerald-700 dark:text-emerald-400"
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
  const primaryFg = useThemeColor("--color-primary-foreground");
  const dangerFg = useThemeColor("--color-danger-foreground");
  const spinner = tone === "danger" ? dangerFg : primaryFg;

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
      {loading ? <ActivityIndicator color={String(spinner)} size="small" /> : null}
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
