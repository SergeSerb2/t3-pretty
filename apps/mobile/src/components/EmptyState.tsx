import { Pressable, View } from "react-native";

import { AppText as Text } from "./AppText";

function EmptyStateMarker() {
  return (
    <View
      accessible={false}
      className="size-11 shrink-0 items-center justify-center rounded-[13px] border border-border-subtle bg-subtle"
      pointerEvents="none"
    >
      <View className="absolute h-px w-5 bg-primary opacity-30" />
      <View className="absolute h-5 w-px bg-primary opacity-30" />
      <View className="size-2 rounded-[2px] bg-primary" />
    </View>
  );
}

function EmptyStateAction(props: {
  readonly centered: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      className={
        props.centered
          ? "mt-5 min-h-11 items-center justify-center self-center rounded-[12px] bg-primary px-5 active:opacity-75"
          : "mt-4 min-h-11 items-center justify-center self-start rounded-[12px] bg-primary px-4 active:opacity-75"
      }
      onPress={props.onPress}
    >
      <Text className="text-sm font-t3-bold text-primary-foreground">{props.label}</Text>
    </Pressable>
  );
}

export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly variant?: "card" | "plain";
}) {
  if (props.variant === "plain") {
    return (
      <View className="items-center px-8 py-10">
        <EmptyStateMarker />
        <Text className="mt-4 text-center text-xl font-t3-bold tracking-[-0.3px] text-foreground">
          {props.title}
        </Text>
        <Text className="mt-2 max-w-[320px] text-center font-sans text-base leading-normal text-foreground-muted">
          {props.detail}
        </Text>
        {props.actionLabel && props.onAction ? (
          <EmptyStateAction centered label={props.actionLabel} onPress={props.onAction} />
        ) : null}
      </View>
    );
  }

  return (
    <View className="rounded-[16px] border border-border-subtle bg-card px-4 py-4">
      <View className="flex-row items-start gap-3.5">
        <EmptyStateMarker />
        <View className="min-w-0 flex-1 pt-0.5">
          <Text className="font-t3-bold text-base text-foreground">{props.title}</Text>
          <Text className="mt-1.5 font-sans text-sm leading-relaxed text-foreground-muted">
            {props.detail}
          </Text>
          {props.actionLabel && props.onAction ? (
            <EmptyStateAction centered={false} label={props.actionLabel} onPress={props.onAction} />
          ) : null}
        </View>
      </View>
    </View>
  );
}
