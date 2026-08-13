import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

export function SettingsSection(props: {
  readonly title: string;
  readonly children: ReactNode;
  /** Force the grouped card background; Android otherwise lists options flat. */
  readonly card?: boolean;
}) {
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-2 px-1">
        <View className="h-1.5 w-1.5 rounded-[2px] bg-primary" />
        <Text className="shrink text-xs font-t3-medium tracking-[0.3px] text-foreground-muted">
          {props.title}
        </Text>
        <View className="h-px flex-1 bg-border-subtle" />
      </View>
      <View
        className={
          props.card
            ? "overflow-hidden rounded-[16px] border border-border-subtle border-continuous bg-card"
            : "overflow-hidden rounded-[16px] border border-border-subtle border-continuous bg-card android:rounded-none android:border-0 android:bg-transparent"
        }
      >
        {props.children}
      </View>
    </View>
  );
}
