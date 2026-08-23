import type { RuntimeMode } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ModelOption } from "../../lib/modelOptions";
import type { ThreadSettingsPickerModel } from "./thread-settings-picker";
import { ThreadSettingsPickerPopover } from "./ThreadSettingsPickerPopover";
import type { ThreadModelIdentity } from "./threadModelIdentity";

/**
 * Collapsed-composer caption below the chat pill: the full model / effort /
 * tier / context identity, tappable so settings can change without focusing
 * the input. Lives under the pill so it cannot cover the last feed messages.
 */
export function ThreadModelIdentityCaption(props: {
  readonly identity: ThreadModelIdentity;
  readonly picker: ThreadSettingsPickerModel | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly onSelectOption: (id: string, value: string | boolean) => void;
  readonly onSelectRuntime: (mode: RuntimeMode) => void;
  readonly onOpenAdvanced: () => void;
  readonly onPressFallback: () => void;
}) {
  const iconMuted = useThemeColor("--color-icon-muted");

  const body = (
    <View className="max-w-full flex-row items-center justify-center gap-1.5 px-1">
      <ProviderIcon provider={props.identity.providerDriver} size={12} />
      <Text className="shrink text-center text-xs leading-4" numberOfLines={1}>
        <Text className="font-t3-bold text-foreground">{props.identity.modelLabel}</Text>
        {props.identity.traitSummary.length > 0 ? (
          <Text className="font-t3-medium text-foreground-secondary">
            {` · ${props.identity.traitSummary}`}
          </Text>
        ) : null}
      </Text>
      <SymbolView name="chevron.down" size={9} tintColor={iconMuted} type="monochrome" />
    </View>
  );

  const trigger = (
    <View
      accessibilityHint="Opens model and reasoning settings"
      accessibilityLabel={props.identity.accessibilityLabel}
      accessibilityRole="button"
      className="items-center py-1 active:opacity-70"
    >
      {body}
    </View>
  );

  if (props.picker) {
    return (
      <ThreadSettingsPickerPopover
        accessibilityLabel={props.identity.accessibilityLabel}
        model={props.picker}
        onOpenAdvanced={props.onOpenAdvanced}
        onSelectModel={props.onSelectModel}
        onSelectOption={props.onSelectOption}
        onSelectRuntime={props.onSelectRuntime}
      >
        {trigger}
      </ThreadSettingsPickerPopover>
    );
  }

  return (
    <Pressable
      accessibilityHint="Opens model and reasoning settings"
      accessibilityLabel={props.identity.accessibilityLabel}
      accessibilityRole="button"
      hitSlop={{ top: 4, bottom: 8, left: 12, right: 12 }}
      onPress={props.onPressFallback}
      className="items-center py-1 active:opacity-70"
    >
      {body}
    </Pressable>
  );
}
