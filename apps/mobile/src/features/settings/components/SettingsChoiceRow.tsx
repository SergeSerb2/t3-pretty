import { Platform, Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { SymbolView } from "../../../components/AppSymbol";
import { RowPressable } from "../../../components/RowPressable";
import { useGlassChromeActive } from "../../scenery/SceneryProvider";

export function SettingsChoiceRow(props: {
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const glass = useGlassChromeActive();
  const content = (
    <>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-lg text-foreground android:text-base">{props.label}</Text>
        <Text className="text-sm leading-normal text-foreground-muted">{props.description}</Text>
      </View>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={18}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </>
  );
  if (Platform.OS === "ios") {
    return (
      <RowPressable
        accessibilityRole="radio"
        accessibilityState={{ checked: props.selected, disabled: props.disabled }}
        className={
          props.separated
            ? "flex-row items-center gap-4 border-t border-border-subtle p-4"
            : "flex-row items-center gap-4 p-4"
        }
        disabled={props.disabled}
        interactionClassName={glass ? "bg-foreground/[0.06]" : "bg-subtle"}
        onPress={props.onPress}
      >
        {content}
      </RowPressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={
        props.separated
          ? "flex-row items-center gap-4 border-t border-border-subtle p-4 active:opacity-70"
          : "flex-row items-center gap-4 p-4 active:opacity-70"
      }
      disabled={props.disabled}
      onPress={props.onPress}
    >
      {content}
    </Pressable>
  );
}
