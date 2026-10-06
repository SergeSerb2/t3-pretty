import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { ControlPillMenu } from "../components/ControlPillMenu";
import { MintGlassButton } from "../components/MintGlassButton";
import type { AppSymbolName } from "../components/AppSymbol";
import { headerMenuActions } from "./mintGlassHeaderMenu.logic";

function toMintGlassItem(item: NativeStackHeaderItem): NativeStackHeaderItem | null {
  if (item.type === "spacing") {
    // A native spacer would be appended after every custom view, so it
    // becomes an empty custom view at its own position instead.
    return { type: "custom", element: <View style={{ width: item.spacing }} /> };
  }
  if (item.type === "custom") return item;

  const icon = item.icon?.type === "sfSymbol" ? (item.icon.name as AppSymbolName) : undefined;
  const label = icon ? undefined : item.label;
  // Image icons have no glass rendering; leave them to UIKit.
  if (!icon && !label) return item;

  const accessibilityLabel = item.accessibilityLabel ?? item.label;
  const button = (onPress?: () => void, inMenu = false) => (
    <MintGlassButton
      icon={icon}
      label={label}
      accessible={inMenu ? false : undefined}
      accessibilityLabel={accessibilityLabel}
      disabled={item.disabled}
      selected={item.type === "button" ? item.selected : undefined}
      tintColor={item.tintColor}
      onPress={onPress}
    />
  );

  // The menu's UIButton opens on tap regardless of the inner disabled state.
  if (item.type === "button" || item.disabled) {
    return {
      type: "custom",
      identifier: item.identifier,
      element: button(item.type === "button" ? item.onPress : undefined),
    };
  }

  const menu = headerMenuActions(item.menu.items);
  return {
    type: "custom",
    identifier: item.identifier,
    element: (
      <ControlPillMenu
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        title={item.menu.title}
        actions={menu.actions}
        onPressAction={({ nativeEvent }) => menu.handlers.get(nativeEvent.event)?.()}
      >
        {button(undefined, true)}
      </ControlPillMenu>
    ),
  };
}

/**
 * Swaps UIKit bar buttons for mint glass controls rendered as custom header
 * views. Android keeps its Material header items.
 */
export function mintGlassHeaderItems<T>(items: T): T {
  if (Platform.OS !== "ios" || !Array.isArray(items)) return items;
  return (items as NativeStackHeaderItem[]).flatMap((item) => {
    const converted = toMintGlassItem(item);
    return converted ? [converted] : [];
  }) as T;
}

/** Wraps a header item factory so every item it returns is converted. */
export function withMintGlassHeaderItems<T>(factory: T): T {
  if (Platform.OS !== "ios" || typeof factory !== "function") return factory;
  return ((...args: unknown[]) => mintGlassHeaderItems(factory(...args))) as T;
}
