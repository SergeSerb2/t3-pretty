import { useNavigation } from "@react-navigation/native";
import type { ComponentProps } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";

import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";
import type { SettingsLegalDocumentTarget, SettingsSheetTarget } from "./settings-sheet-targets";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

export function SettingsRow(props: {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly label: string;
  readonly value?: string;
  readonly target?: SettingsSheetTarget;
  readonly fullScreenTarget?: SettingsLegalDocumentTarget;
  readonly onPress?: () => void;
}) {
  const navigation = useNavigation();
  const icon = useThemeColor("--color-primary");
  const chevron = useThemeColor("--color-chevron");
  const pressedBackground = useThemeColor("--color-subtle");
  const { fontScale } = useWindowDimensions();
  const stacksValue = fontScale >= 1.6;
  const content = (
    <View
      className={
        props.disabled
          ? `min-h-[60px] flex-row gap-3 px-3.5 py-2.5 opacity-[0.45] ${stacksValue ? "items-start" : "items-center"}`
          : `min-h-[60px] flex-row gap-3 px-3.5 py-2.5 ${stacksValue ? "items-start" : "items-center"}`
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
      {stacksValue ? (
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
          {props.value ? (
            <Text className="mt-1 text-sm text-foreground-muted" ellipsizeMode="middle">
              {props.value}
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
            {props.label}
          </Text>
          <View className="min-w-0 flex-1 items-end">
            {props.value ? (
              <Text
                className="max-w-full text-right text-sm text-foreground-muted"
                ellipsizeMode="middle"
                numberOfLines={1}
              >
                {props.value}
              </Text>
            ) : null}
          </View>
        </>
      )}
      <View className="size-7 shrink-0 items-center justify-center">
        <SymbolView
          name="chevron.right"
          size={14}
          tintColor={chevron}
          type="monochrome"
          weight="semibold"
        />
      </View>
    </View>
  );

  const accessibilityLabel = props.value ? `${props.label}, ${props.value}` : props.label;
  const pressableProps = {
    accessibilityLabel,
    accessibilityRole: "button" as const,
    accessibilityState: { disabled: props.disabled === true },
    disabled: props.disabled,
    style: ({ pressed }: { readonly pressed: boolean }) => ({
      backgroundColor: pressed ? pressedBackground : "transparent",
    }),
  };

  const target = props.target;
  if (target) {
    return (
      <Pressable
        {...pressableProps}
        onPress={() =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: target },
          })
        }
      >
        {content}
      </Pressable>
    );
  }

  const fullScreenTarget = props.fullScreenTarget;
  if (fullScreenTarget) {
    return (
      <Pressable {...pressableProps} onPress={() => navigation.navigate(fullScreenTarget)}>
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable {...pressableProps} onPress={props.onPress}>
      {content}
    </Pressable>
  );
}
