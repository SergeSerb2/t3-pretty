import type { ComponentProps } from "react";
import { Switch, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export function SettingsSwitchRow(props: {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  const icon = useThemeColor("--color-primary");
  const activeTrack = String(useThemeColor("--color-switch-active"));
  const track = String(useThemeColor("--color-secondary-border"));

  return (
    <View
      className={
        props.disabled
          ? "min-h-[60px] flex-row items-center gap-3 px-3.5 py-2.5 opacity-[0.45]"
          : "min-h-[60px] flex-row items-center gap-3 px-3.5 py-2.5"
      }
    >
      <View className="size-10 shrink-0 items-center justify-center rounded-[12px] border border-border-subtle bg-subtle">
        <SymbolView
          name={props.icon}
          size={19}
          tintColor={icon}
          type="monochrome"
          weight="medium"
        />
      </View>
      <Text className="min-w-0 flex-1 text-base font-t3-medium text-foreground">{props.label}</Text>
      <View className="min-h-11 min-w-[56px] shrink-0 items-end justify-center">
        <Switch
          accessibilityLabel={props.label}
          accessibilityState={{ checked: props.value, disabled: props.disabled === true }}
          disabled={props.disabled}
          hitSlop={8}
          ios_backgroundColor={track}
          onValueChange={props.onValueChange}
          trackColor={{ false: track, true: activeTrack }}
          value={props.value}
        />
      </View>
    </View>
  );
}
