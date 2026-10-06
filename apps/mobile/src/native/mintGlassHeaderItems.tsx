import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";

import { ControlPillMenu } from "../components/ControlPillMenu";
import { MintGlassButton } from "../components/MintGlassButton";
import type { AppSymbolName } from "../components/AppSymbol";
import { headerMenuActions } from "./mintGlassHeaderMenu.logic";

function toMintGlassItem(item: NativeStackHeaderItem): NativeStackHeaderItem | null {
  if (item.type === "spacing") {
    // A native spacer would be appended after every custom view, so it
    // becomes an empty custom view at its own position instead.
    return {
      type: "custom",
      hidesSharedBackground: true,
      element: <View style={{ width: item.spacing }} />,
    };
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
      hidesSharedBackground: true,
      identifier: item.identifier,
      element: button(item.type === "button" ? item.onPress : undefined),
    };
  }

  const menu = headerMenuActions(item.menu.items);
  return {
    type: "custom",
    hidesSharedBackground: true,
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
 * views, without the system's shared glass capsule. Android keeps its
 * Material header items.
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

/**
 * Screen options that swap the UIKit back button for a mint glass one. Use as
 * a navigator's `screenOptions` function: header `canGoBack` also counts a
 * parent stack, which would put a back button on the root of a sheet, so this
 * checks the screen's own stack instead. Screens that set their own left
 * items replace it. Items rather than `headerLeft`, which cannot hide the
 * system glass capsule.
 */
export function mintGlassBackOptions(props: {
  readonly navigation: {
    getState(): { readonly routes: ReadonlyArray<{ readonly key: string }> };
    goBack(): void;
  };
  readonly route: { readonly key: string };
}) {
  if (Platform.OS !== "ios") return {};
  const hasPrevious =
    props.navigation.getState().routes.findIndex((route) => route.key === props.route.key) > 0;
  return {
    headerBackVisible: false,
    unstable_headerLeftItems: hasPrevious
      ? () => [mintGlassBackItem(() => props.navigation.goBack())]
      : undefined,
  };
}

/** A custom header view that draws its own chrome, without the system capsule. */
export function mintGlassCustomItem(element: ReactElement): NativeStackHeaderItem {
  return { type: "custom", hidesSharedBackground: true, element };
}

/** The mint glass back button as a custom header item. */
export function mintGlassBackItem(onPress: () => void): NativeStackHeaderItem {
  return mintGlassCustomItem(
    <MintGlassButton accessibilityLabel="Back" icon="chevron.left" onPress={onPress} />,
  );
}
