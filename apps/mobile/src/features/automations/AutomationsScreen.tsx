import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import { automationStatus } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { LegendList } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, type ReactElement } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";

import { AndroidHeaderIconButton, AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { StatusPill } from "../../components/StatusPill";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { automationNextRunLabel, automationStatusTone } from "./automations.logic";

export interface AutomationListEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly supported: boolean;
}

export interface AutomationListProject {
  readonly id: ProjectId;
  readonly title: string;
}

export interface AutomationListEntry {
  readonly automation: EnvironmentAutomation;
  readonly projectTitle: string;
  /** Set when the client holds the shell of the active run's thread. */
  readonly activeRunThread: {
    readonly hasPendingApprovals: boolean;
    readonly hasPendingUserInput: boolean;
  } | null;
}

function AutomationsHeader(props: {
  readonly environments: ReadonlyArray<AutomationListEnvironment>;
  readonly projects: ReadonlyArray<AutomationListProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectId: ProjectId | undefined;
  readonly hasCustomFilter: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
  readonly onProjectChange: (projectId: ProjectId | undefined) => void;
  readonly onClearFilters: () => void;
}) {
  const navigation = useNavigation();
  const filterIcon = props.hasCustomFilter
    ? "line.3.horizontal.decrease.circle.fill"
    : "line.3.horizontal.decrease.circle";

  const androidActions = useMemo<MenuAction[]>(
    () => [
      ...(props.hasCustomFilter ? [{ id: "clear", title: "Clear filters" }] : []),
      {
        id: "environment",
        title: "Environment",
        subactions: props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.supported ? environment.label : `${environment.label} (unavailable)`,
          state:
            props.selectedEnvironmentId === environment.environmentId ? ("on" as const) : undefined,
        })),
      },
      {
        id: "project",
        title: "Project",
        subactions: [
          {
            id: "project:all",
            title: "All projects",
            state: props.selectedProjectId === undefined ? ("on" as const) : undefined,
          },
          ...props.projects.map((project) => ({
            id: `project:${project.id}`,
            title: project.title,
            state: props.selectedProjectId === project.id ? ("on" as const) : undefined,
          })),
        ],
      },
    ],
    [
      props.environments,
      props.hasCustomFilter,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectId,
    ],
  );

  const handleAndroidAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const action = event.nativeEvent.event;
      if (action === "clear") props.onClearFilters();
      else if (action === "project:all") props.onProjectChange(undefined);
      else if (action.startsWith("project:")) {
        props.onProjectChange(action.slice("project:".length) as ProjectId);
      } else if (action.startsWith("environment:")) {
        props.onEnvironmentChange(action.slice("environment:".length) as EnvironmentId);
      }
    },
    [props],
  );

  if (Platform.OS === "android") {
    return (
      <>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader
          title="Automations"
          onBack={() => navigation.goBack()}
          trailing={
            <ControlPillMenu
              actions={androidActions}
              isAnchoredToRight
              onPressAction={handleAndroidAction}
            >
              <AndroidHeaderIconButton accessibilityLabel="Filter automations" icon={filterIcon} />
            </ControlPillMenu>
          }
        />
      </>
    );
  }

  return (
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Menu
        accessibilityLabel="Filter automations"
        icon={filterIcon}
        separateBackground
        title="Automation options"
      >
        {props.hasCustomFilter ? (
          <NativeHeaderToolbar.MenuAction onPress={props.onClearFilters}>
            <NativeHeaderToolbar.Label>Clear filters</NativeHeaderToolbar.Label>
          </NativeHeaderToolbar.MenuAction>
        ) : null}
        <NativeHeaderToolbar.Menu title="Environment">
          {props.environments.map((environment) => (
            <NativeHeaderToolbar.MenuAction
              key={environment.environmentId}
              isOn={props.selectedEnvironmentId === environment.environmentId}
              onPress={() => props.onEnvironmentChange(environment.environmentId)}
            >
              <NativeHeaderToolbar.Label>
                {environment.supported ? environment.label : `${environment.label} (unavailable)`}
              </NativeHeaderToolbar.Label>
            </NativeHeaderToolbar.MenuAction>
          ))}
        </NativeHeaderToolbar.Menu>
        <NativeHeaderToolbar.Menu title="Project">
          <NativeHeaderToolbar.MenuAction
            isOn={props.selectedProjectId === undefined}
            onPress={() => props.onProjectChange(undefined)}
          >
            <NativeHeaderToolbar.Label>All projects</NativeHeaderToolbar.Label>
          </NativeHeaderToolbar.MenuAction>
          {props.projects.map((project) => (
            <NativeHeaderToolbar.MenuAction
              key={project.id}
              isOn={props.selectedProjectId === project.id}
              onPress={() => props.onProjectChange(project.id)}
            >
              <NativeHeaderToolbar.Label>{project.title}</NativeHeaderToolbar.Label>
            </NativeHeaderToolbar.MenuAction>
          ))}
        </NativeHeaderToolbar.Menu>
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar>
  );
}

function AutomationRow(props: {
  readonly entry: AutomationListEntry;
  readonly nowMs: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onPress: (entry: AutomationListEntry) => void;
}) {
  const { automation } = props.entry;
  const tone = automationStatusTone(automationStatus(automation, props.entry.activeRunThread));
  const nextRun = automationNextRunLabel(automation, props.nowMs);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Automation ${automation.name}`}
      onPress={() => props.onPress(props.entry)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.72 : 1,
        borderTopLeftRadius: props.isFirst ? 16 : 0,
        borderTopRightRadius: props.isFirst ? 16 : 0,
        borderBottomLeftRadius: props.isLast ? 16 : 0,
        borderBottomRightRadius: props.isLast ? 16 : 0,
        borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth,
      })}
      className="border-b-separator bg-card px-4 py-3.5"
    >
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-bold leading-snug text-foreground" numberOfLines={1}>
            {automation.name}
          </Text>
          <Text className="mt-1 text-xs leading-4 text-foreground-muted" numberOfLines={1}>
            {props.entry.projectTitle}
          </Text>
        </View>
        <View className="shrink-0 items-end gap-1">
          {tone ? <StatusPill {...tone} size="compact" /> : null}
          {nextRun ? (
            <Text className="text-2xs tabular-nums text-foreground-tertiary">{nextRun}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function AutomationsScreen(props: {
  readonly environments: ReadonlyArray<AutomationListEnvironment>;
  readonly projects: ReadonlyArray<AutomationListProject>;
  readonly entries: ReadonlyArray<AutomationListEntry>;
  readonly nowMs: number;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectId: ProjectId | undefined;
  readonly hasCustomFilter: boolean;
  readonly capabilityKnown: boolean;
  readonly supported: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
  readonly onProjectChange: (projectId: ProjectId | undefined) => void;
  readonly onClearFilters: () => void;
  readonly onSelect: (entry: AutomationListEntry) => void;
}) {
  const listEmpty = useMemo((): ReactElement => {
    if (!props.capabilityKnown) {
      return (
        <View className="items-center py-16">
          <ActivityIndicator colorClassName="accent-icon" />
          <Text className="mt-3 text-sm text-foreground-muted">Checking this environment…</Text>
        </View>
      );
    }
    if (props.environments.length === 0) {
      return (
        <EmptyState
          title="No environments"
          detail="Connect an environment, then the automations of its projects appear here."
        />
      );
    }
    if (!props.supported) {
      return (
        <EmptyState
          title="Automations need a newer environment"
          detail="This environment predates automations. Update T3 Code on that machine, then reconnect."
        />
      );
    }
    return (
      <EmptyState
        title="No automations"
        detail={
          props.hasCustomFilter
            ? "Nothing matches these filters. Try another environment or project."
            : "Create one from the web or desktop app and it shows up here, with every run it made."
        }
      />
    );
  }, [props.capabilityKnown, props.environments.length, props.hasCustomFilter, props.supported]);

  const renderItem = useCallback(
    ({ item, index }: { item: AutomationListEntry; index: number }) => (
      <AutomationRow
        entry={item}
        nowMs={props.nowMs}
        isFirst={index === 0}
        isLast={index === props.entries.length - 1}
        onPress={props.onSelect}
      />
    ),
    [props.entries.length, props.nowMs, props.onSelect],
  );

  return (
    <View className="flex-1 bg-sheet">
      <AutomationsHeader
        environments={props.environments}
        hasCustomFilter={props.hasCustomFilter}
        onClearFilters={props.onClearFilters}
        onEnvironmentChange={props.onEnvironmentChange}
        onProjectChange={props.onProjectChange}
        projects={props.projects}
        selectedEnvironmentId={props.selectedEnvironmentId}
        selectedProjectId={props.selectedProjectId}
      />
      <LegendList
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16, paddingTop: 4 }}
        contentInsetAdjustmentBehavior="automatic"
        data={props.entries}
        estimatedItemSize={72}
        extraData={props.nowMs}
        keyExtractor={(item) => `${item.automation.environmentId}:${item.automation.id}`}
        ListEmptyComponent={() => listEmpty}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
