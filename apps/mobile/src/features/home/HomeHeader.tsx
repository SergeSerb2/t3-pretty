import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo, useRef } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

import { ControlPillMenu } from "../../components/ControlPill";
import { SymbolView } from "../../components/AppSymbol";
import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import { WorkspaceConnectionTitle } from "./WorkspaceConnectionTitle";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";
import { presentHomeListFilterMenu } from "./present-home-list-filter-menu";
import type { HomeHeaderProps as UpstreamHomeHeaderProps } from "./HomeHeader.types";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

type HomeHeaderProps = UpstreamHomeHeaderProps & {
  /** Null while no connected environment advertises the automations capability. */
  readonly onOpenAutomations: (() => void) | null;
};

export function HomeHeader(props: HomeHeaderProps) {
  if (Platform.OS === "android") {
    return <AndroidHomeHeader {...props} />;
  }

  return <IosHomeHeader {...props} />;
}

function AndroidHomeHeader(props: HomeHeaderProps) {
  const { materialYouStyleLayoutActive } = useAppearancePreferences();
  const insets = useSafeAreaInsets();
  const headerControlClassName =
    Platform.OS === "android"
      ? "size-12 items-center justify-center rounded-full bg-subtle"
      : "size-11 items-center justify-center rounded-full bg-subtle";
  const clearSearchClassName =
    Platform.OS === "android"
      ? "-mr-3 size-12 items-center justify-center"
      : "size-11 items-center justify-center";
  // The list uses a fixed creation order, so the filter menu only carries
  // environment/project filters and the "customized" icon keys off those.
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null || props.selectedProjectKey !== null;
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
    ],
    [props.environments, props.projects, props.selectedEnvironmentId, props.selectedProjectKey],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <View
        className={
          materialYouStyleLayoutActive
            ? "bg-header pb-3"
            : "border-b border-header-border bg-header pb-3"
        }
        style={{
          paddingHorizontal: HOME_HORIZONTAL_INSET,
          paddingTop: Math.max(insets.top, 12),
        }}
      >
        <View className="w-full max-w-[720px] self-center gap-3">
          <View className="flex-row items-center gap-2.5">
            {/* Brand slot doubles as the connection status surface: while an
                environment reconnects, the lockup fades to a status label in
                place (no layout shift in the list below). */}
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironments}
              brand={<CompactBrandTitle />}
            />

            <ControlPillMenu
              actions={menuActions}
              isAnchoredToRight
              onPressAction={handleMenuAction}
            >
              <Pressable
                accessibilityLabel="Filter and sort threads"
                accessibilityRole="button"
                className={headerControlClassName}
              >
                <SymbolView
                  name={
                    hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle"
                  }
                  size={16}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                />
              </Pressable>
            </ControlPillMenu>
            {/* Built identically to the filter button so the two circles
                match exactly (ControlPill sizes via Tailwind classes and
                resolves to a different box). */}
            <Pressable
              accessibilityLabel="Open pull requests"
              accessibilityRole="button"
              onPress={props.onOpenPullRequests}
              className={headerControlClassName}
            >
              <SymbolView
                name="arrow.triangle.pull"
                size={18}
                tintColorClassName={"accent-icon"}
                type="monochrome"
              />
            </Pressable>
            {props.onOpenAutomations === null ? null : (
              <Pressable
                accessibilityLabel="Open automations"
                accessibilityRole="button"
                onPress={props.onOpenAutomations}
                className={headerControlClassName}
              >
                <SymbolView
                  name="bolt"
                  size={18}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                />
              </Pressable>
            )}
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              onPress={props.onOpenSettings}
              className={headerControlClassName}
            >
              <SymbolView
                name="gearshape"
                size={18}
                tintColorClassName={"accent-icon"}
                type="monochrome"
              />
            </Pressable>
          </View>

          <View
            className={
              materialYouStyleLayoutActive
                ? "min-h-12 flex-row items-center gap-2.5 rounded-full border border-input-border bg-input px-3.5"
                : "min-h-12 flex-row items-center gap-2.5 rounded-2xl border border-input-border bg-input px-3.5"
            }
          >
            <SymbolView
              name="magnifyingglass"
              size={17}
              tintColorClassName={"accent-foreground-muted"}
              type="monochrome"
            />
            <TextInput
              accessibilityLabel="Search threads"
              autoCapitalize="none"
              onChangeText={props.onSearchQueryChange}
              placeholder="Search threads"
              placeholderTextColorClassName="accent-placeholder"
              className="flex-1 py-2.5 text-base font-sans text-foreground"
              value={props.searchQuery}
            />
            {props.searchQuery.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                className={clearSearchClassName}
                onPress={() => props.onSearchQueryChange("")}
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={17}
                  tintColorClassName={"accent-foreground-muted"}
                  type="monochrome"
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </>
  );
}

function IosHomeHeader(props: HomeHeaderProps) {
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
          unstable_headerRightItems: () => [
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
          ...(NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
            ? {
                unstable_headerToolbarItems: () => [
                  createNativeMailSearchToolbarItem({
                    composeButtonId: "home-new-task",
                    composeSystemImageName: "square.and.pencil",
                    filterButtonId: "home-filter",
                    filterSystemImageName: hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease",
                    onComposePress: props.onStartNewTask,
                    onFilterPress: () => presentHomeListFilterMenu(filterMenu, "bottom-start"),
                    onSearchTextChange: props.onSearchQueryChange,
                    placeholder: "Search",
                    searchTextChangeId: "home-search-text",
                    showsSearchDismissButton: true,
                  }),
                ],
              }
            : {
                // Pre-Liquid-Glass iOS: standard pull-down search in the nav
                // bar; create + sort live in the plain bottom toolbar below.
                headerSearchBarOptions: {
                  ref: searchBarRef,
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

      {NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED ? null : (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel="Filter threads"
            icon={
              hasCustomListOptions
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            title="Thread list options"
            separateBackground
          >
            <NativeHeaderToolbar.Menu title="Environment">
              <NativeHeaderToolbar.Label>Environment</NativeHeaderToolbar.Label>
              <NativeHeaderToolbar.MenuAction
                isOn={props.selectedEnvironmentId === null}
                onPress={() => props.onEnvironmentChange(null)}
                subtitle="Show threads from every environment"
              >
                <NativeHeaderToolbar.Label>All environments</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
              {props.environments.map((environment) => (
                <NativeHeaderToolbar.MenuAction
                  key={environment.environmentId}
                  isOn={props.selectedEnvironmentId === environment.environmentId}
                  onPress={() => props.onEnvironmentChange(environment.environmentId)}
                >
                  <NativeHeaderToolbar.Label>{environment.label}</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
              ))}
            </NativeHeaderToolbar.Menu>

            {props.projects.length > 0 ? (
              <NativeHeaderToolbar.Menu title="Project">
                <NativeHeaderToolbar.Label>Project</NativeHeaderToolbar.Label>
                <NativeHeaderToolbar.MenuAction
                  isOn={props.selectedProjectKey === null}
                  onPress={() => props.onProjectChange(null)}
                  subtitle="Show threads from every project"
                >
                  <NativeHeaderToolbar.Label>All projects</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
                {props.projects.map((project) => (
                  <NativeHeaderToolbar.MenuAction
                    key={project.key}
                    isOn={props.selectedProjectKey === project.key}
                    onPress={() => props.onProjectChange(project.key)}
                  >
                    <NativeHeaderToolbar.Label>{project.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            ) : null}
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Spacer flexible />
          <NativeHeaderToolbar.Button
            accessibilityLabel="New task"
            icon="square.and.pencil"
            onPress={props.onStartNewTask}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}
    </>
  );
}
