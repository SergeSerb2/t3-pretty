import { NativeStackScreenOptions } from "../../native/StackHeader";
import { use, useCallback, useRef } from "react";
import { Platform, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import {
  NATIVE_LIQUID_GLASS_SUPPORTED,
  TRANSPARENT_NATIVE_HEADERS,
} from "../../native/native-glass";

import { ControlPillMenu } from "../../components/ControlPill";
import { homeListFilterItemsToActions } from "../../components/anchored-menu.logic";
import { MintGlassButton } from "../../components/MintGlassButton";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";
import { createSidebarHeaderItems } from "../threads/sidebar-native-header-items";
import type { HomeHeaderProps as UpstreamHomeHeaderProps } from "./HomeHeader.types";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

type HomeHeaderProps = UpstreamHomeHeaderProps & {
  /** Null while no connected environment advertises the automations capability. */
  readonly onOpenAutomations: (() => void) | null;
};

export function HomeHeader(props: HomeHeaderProps) {
  const primaryColumn = use(NativePrimaryColumnContext);
  const iPadSidebar = Platform.OS === "ios" && Platform.isPad && primaryColumn !== null;
  const searchBarRef = useRef<SearchBarCommands>(null);
  const iconColor = useUniwindTheme()["--color-icon"];
  // The list uses a fixed creation order and ignores sort/group options, so
  // the filter menu only carries the filters and the "customized" icon state
  // keys off those alone.
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null || props.selectedProjectKey !== null;
  const focusSearch = useCallback(() => {
    searchBarRef.current?.focus();
    return searchBarRef.current !== null;
  }, []);
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const filterMenu = buildHomeListFilterMenu(props);

  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={filterMenu.items}
        options={{
          // Static header config (glass, title, fonts) lives in Stack.tsx
          // (GLASS_HEADER_OPTIONS). Only dynamic values are set here.
          headerTintColor: iconColor,
          // The bar is transparent so the scenery runs under it, but UIKit's
          // scroll-edge effect stops at the navigation bar and never covers
          // the in-bar search field, so rows would scroll under the field.
          // A thin material frosts both; at rest it is a light glass bar.
          headerBlurEffect: TRANSPARENT_NATIVE_HEADERS ? "systemUltraThinMaterial" : undefined,
          unstable_headerRightItems: () =>
            iPadSidebar
              ? createSidebarHeaderItems({
                  filterIcon: hasCustomListOptions
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle",
                  filterMenu,
                  onOpenPullRequests: props.onOpenPullRequests,
                  onOpenAutomations: props.onOpenAutomations,
                  onOpenSettings: props.onOpenSettings,
                })
              : [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Open pull requests",
                    icon: { name: "arrow.triangle.pull", type: "sfSymbol" } as const,
                    identifier: "home-pull-requests",
                    label: "",
                    onPress: props.onOpenPullRequests,
                    type: "button",
                  }),
                  ...(props.onOpenAutomations === null
                    ? []
                    : [
                        withNativeGlassHeaderItem({
                          accessibilityLabel: "Open automations",
                          icon: { name: "bolt", type: "sfSymbol" } as const,
                          identifier: "home-automations",
                          label: "",
                          onPress: props.onOpenAutomations,
                          type: "button",
                        }),
                      ]),
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Open settings",
                    icon: { name: "ellipsis", type: "sfSymbol" } as const,
                    identifier: "home-settings",
                    label: "",
                    onPress: props.onOpenSettings,
                    type: "button",
                  }),
                ],
          // The keys below are set per-branch (not `undefined`) so a later
          // reapply cannot clobber options owned by NativeHeaderToolbar.
          ...(iPadSidebar
            ? {
                headerSearchBarOptions: {
                  ref: searchBarRef,
                  autoCapitalize: "none" as const,
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  placement: "stacked" as const,
                  allowToolbarIntegration: false,
                  placeholder: "Search",
                  onCancelButtonPress: () => props.onSearchQueryChange(""),
                  onChangeText: (event) => props.onSearchQueryChange(event.nativeEvent.text),
                },
                unstable_headerToolbarItems: () => [],
              }
            : NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
              ? {
                  headerSearchBarOptions: {
                    ref: searchBarRef,
                    autoCapitalize: "none" as const,
                    onCancelButtonPress: () => props.onSearchQueryChange(""),
                  },
                  unstable_headerToolbarItems: () => [
                    createNativeMailSearchToolbarItem({
                      composeButtonId: "home-new-task",
                      composeSystemImageName: "square.and.pencil",
                      filterMenu,
                      filterButtonId: "home-filter",
                      filterSystemImageName: hasCustomListOptions
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease",
                      onComposePress: props.onStartNewTask,
                      onSearchTextChange: props.onSearchQueryChange,
                      placeholder: "Search",
                      searchTextChangeId: "home-search-text",
                      showsSearchDismissButton: true,
                    }),
                  ],
                }
              : {
                  // Standard UIKit search; create + sort float in the bottom
                  // corners below. Liquid Glass collapses it to a glass button
                  // beside the header items instead of a stacked field that
                  // pushes the list down; otherwise the field stays stacked
                  // under the title, since iOS 26+ would move it to the bottom
                  // edge over the corner buttons.
                  headerSearchBarOptions: {
                    ref: searchBarRef,
                    ...(NATIVE_LIQUID_GLASS_SUPPORTED
                      ? { allowToolbarIntegration: false, placement: "integratedButton" as const }
                      : { placement: "stacked" as const }),
                    autoCapitalize: "none" as const,
                    hideNavigationBar: false,
                    placeholder: "Search",
                    onCancelButtonPress: () => {
                      props.onSearchQueryChange("");
                    },
                    onChangeText: (event) => {
                      props.onSearchQueryChange(event.nativeEvent.text);
                    },
                  },
                }),
        }}
      />

      {iPadSidebar || NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED ? null : (
        <HomeCornerButtons
          filterMenu={filterMenu}
          hasCustomListOptions={hasCustomListOptions}
          onStartNewTask={props.onStartNewTask}
        />
      )}
    </>
  );
}

/** Floating mint glass filter and compose buttons in the bottom corners. */
function HomeCornerButtons(props: {
  readonly filterMenu: ReturnType<typeof buildHomeListFilterMenu>;
  readonly hasCustomListOptions: boolean;
  readonly onStartNewTask: () => void;
}) {
  const insets = useSafeAreaInsets();
  const menu = homeListFilterItemsToActions(props.filterMenu.items);
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 z-10 flex-row justify-between px-6"
      style={{ bottom: Math.max(insets.bottom - 6, 16) }}
    >
      <ControlPillMenu
        accessible
        accessibilityRole="button"
        accessibilityLabel="Filter threads"
        title={props.filterMenu.title}
        actions={menu.actions}
        onPressAction={({ nativeEvent }) => menu.handlers.get(nativeEvent.event)?.()}
      >
        <MintGlassButton
          accessible={false}
          icon={
            props.hasCustomListOptions
              ? "line.3.horizontal.decrease.circle.fill"
              : "line.3.horizontal.decrease"
          }
          size={44}
        />
      </ControlPillMenu>
      <MintGlassButton
        accessibilityLabel="New task"
        icon="square.and.pencil"
        size={44}
        onPress={props.onStartNewTask}
      />
    </View>
  );
}
