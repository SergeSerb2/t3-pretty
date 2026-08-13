import type { MenuComponentProps } from "@react-native-menu/menu";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPill";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ThreadSettingsMenu } from "./thread-settings-menu";
import type { ThreadModelIdentity } from "./threadModelIdentity";

/**
 * Collapsed-composer caption: the full model / effort / tier / context
 * identity, tappable so settings can change without focusing the input.
 */
export function ThreadModelIdentityCaption(props: {
  readonly identity: ThreadModelIdentity;
  readonly menu: ThreadSettingsMenu | null;
  readonly onMenuAction: (eventId: string) => void;
  readonly onPressFallback: () => void;
}) {
  const iconMuted = useThemeColor("--color-icon-muted");
  const handleMenuAction: MenuComponentProps["onPressAction"] = ({ nativeEvent }) => {
    props.onMenuAction(nativeEvent.event);
  };

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

  if (props.menu) {
    return (
      <ControlPillMenu actions={props.menu.actions} onPressAction={handleMenuAction}>
        <View
          accessibilityHint="Opens model and reasoning settings"
          accessibilityLabel={props.identity.accessibilityLabel}
          accessibilityRole="button"
          className="items-center py-1 active:opacity-70"
        >
          {body}
        </View>
      </ControlPillMenu>
    );
  }

  return (
    <Pressable
      accessibilityHint="Opens model and reasoning settings"
      accessibilityLabel={props.identity.accessibilityLabel}
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 4, left: 12, right: 12 }}
      onPress={props.onPressFallback}
      className="items-center py-1 active:opacity-70"
    >
      {body}
    </Pressable>
  );
}
