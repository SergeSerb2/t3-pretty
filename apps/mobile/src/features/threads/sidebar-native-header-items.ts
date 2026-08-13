import type { NativeStackHeaderItem } from "@react-navigation/native-stack";

import type { HomeListFilterMenu } from "../home/home-list-filter-menu";
import { presentHomeListFilterMenu } from "../home/present-home-list-filter-menu";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";

type NativeHeaderIcon = NonNullable<Extract<NativeStackHeaderItem, { type: "button" }>["icon"]>;

function sfSymbolIcon(name: string): NativeHeaderIcon {
  return { type: "sfSymbol", name: name as never };
}

/**
 * Right-side UINavigationBar items for the sidebar column: the thread list
 * filter/sort menu plus the settings button, sharing one glass capsule —
 * the Messages-style grouped header buttons.
 */
export function createSidebarHeaderItems(input: {
  readonly filterIcon: string;
  readonly filterMenu: HomeListFilterMenu;
  readonly onOpenSettings: () => void;
}): NativeStackHeaderItem[] {
  return [
    withNativeGlassHeaderItem({
      type: "button",
      label: "",
      accessibilityLabel: "Filter and sort threads",
      icon: sfSymbolIcon(input.filterIcon),
      onPress: () => presentHomeListFilterMenu(input.filterMenu, "top-start"),
    }),
    withNativeGlassHeaderItem({
      type: "button",
      label: "",
      accessibilityLabel: "Open settings",
      icon: sfSymbolIcon("gearshape"),
      onPress: input.onOpenSettings,
    }),
  ];
}
