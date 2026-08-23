import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type HostSkill,
  type InstalledSkill,
  type ProviderInstanceId,
  type SkillId,
} from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnchoredMenu } from "../../components/AndroidAnchoredMenu";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useFontFamily } from "../../lib/useFontFamily";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { skillsEnvironment } from "../../state/skills";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewTaskFlow } from "./new-task-flow-provider";

const LIBRARY_GROUP = "Library";

type SkillRow = {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string | undefined;
  /** Section header: "Library" for the T3 store, the origin for host skills. */
  readonly group: string;
  /** Checked and disabled — already enabled outside this thread. */
  readonly locked: boolean;
  /** Set for host rows, which carry the management menu. */
  readonly hostSkill: HostSkill | null;
};

type SkillSection = {
  readonly group: string;
  readonly rows: SkillRow[];
};

/** True when this host skill lives in the selected instance's own CLI home. */
function hostSkillBelongsToInstance(
  skill: HostSkill,
  selectedInstanceId: ProviderInstanceId | null,
): boolean {
  if (skill.driver === undefined || selectedInstanceId === null) {
    return false;
  }
  // Default home roots omit instanceId; treat them as the driver's default instance.
  const skillInstanceId = skill.instanceId ?? defaultInstanceIdForDriver(skill.driver);
  return skillInstanceId === selectedInstanceId;
}

/**
 * Same row semantics as the web composer picker: library skills lock on when
 * globally enabled; a host skill locks on when the selected instance's own CLI
 * already loads it from its home folder. Everything else is a per-thread pick.
 */
function buildSkillRows(input: {
  readonly installedSkills: ReadonlyArray<InstalledSkill>;
  readonly hostSkills: ReadonlyArray<HostSkill>;
  readonly globallyEnabledIds: ReadonlySet<SkillId>;
  readonly selectedInstanceId: ProviderInstanceId | null;
}): SkillRow[] {
  const library = input.installedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    group: LIBRARY_GROUP,
    locked: input.globallyEnabledIds.has(skill.id),
    hostSkill: null,
  }));
  const host = input.hostSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? skill.displayPath,
    group: skill.origin,
    locked: skill.enabled && hostSkillBelongsToInstance(skill, input.selectedInstanceId),
    hostSkill: skill,
  }));
  return [...library, ...host];
}

function groupSkillRows(rows: ReadonlyArray<SkillRow>): SkillSection[] {
  const sections: SkillSection[] = [];
  for (const row of rows) {
    const existing = sections[sections.length - 1];
    if (existing !== undefined && existing.group === row.group) {
      existing.rows.push(row);
    } else {
      sections.push({ group: row.group, rows: [row] });
    }
  }
  return sections;
}

function skillMatchesQuery(row: SkillRow, query: string): boolean {
  return (
    row.name.toLowerCase().includes(query) ||
    (row.description?.toLowerCase().includes(query) ?? false)
  );
}

function SkillPickerRow(props: {
  readonly checked: boolean;
  readonly environmentId: EnvironmentId;
  readonly isLast: boolean;
  readonly onToggle: (row: SkillRow) => void;
  readonly onUninstalled: (skillId: SkillId) => void;
  readonly row: SkillRow;
}) {
  const iconColor = useThemeColor("--color-icon-muted");
  const checkmarkColor = useThemeColor("--color-icon");
  const setHostSkillEnabled = useAtomCommand(skillsEnvironment.setHostSkillEnabled, {
    reportFailure: false,
  });
  const uninstallHostSkill = useAtomCommand(skillsEnvironment.uninstallHostSkill, {
    reportFailure: false,
  });

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      Alert.alert(
        title,
        error instanceof Error ? error.message : "The skill could not be updated.",
      );
    },
    [],
  );

  const managementActions = useMemo<ReadonlyArray<MenuAction> | null>(() => {
    if (props.row.hostSkill === null) {
      return null;
    }
    return [
      {
        id: "toggle-enabled",
        title: props.row.hostSkill.enabled ? "Disable for all threads" : "Enable for all threads",
      },
      { id: "uninstall", title: "Uninstall…", attributes: { destructive: true } },
    ];
  }, [props.row.hostSkill]);

  const onPressManagementAction = useCallback<NonNullable<MenuComponentProps["onPressAction"]>>(
    (event) => {
      const skill = props.row.hostSkill;
      if (skill === null) {
        return;
      }
      if (event.nativeEvent.event === "toggle-enabled") {
        void setHostSkillEnabled({
          environmentId: props.environmentId,
          input: { skillId: skill.id, enabled: !skill.enabled },
        }).then((result) => reportFailure("Could not update skill", result));
        return;
      }
      if (event.nativeEvent.event === "uninstall") {
        Alert.alert(
          `Uninstall ${skill.name}?`,
          `${skill.displayPath} will be deleted from this machine.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Uninstall",
              style: "destructive",
              onPress: () => {
                void uninstallHostSkill({
                  environmentId: props.environmentId,
                  input: { skillId: skill.id },
                }).then((result) => {
                  if (result._tag !== "Failure") {
                    props.onUninstalled(skill.id);
                  }
                  reportFailure("Could not uninstall skill", result);
                });
              },
            },
          ],
        );
      }
    },
    [
      props.environmentId,
      props.onUninstalled,
      props.row.hostSkill,
      reportFailure,
      setHostSkillEnabled,
      uninstallHostSkill,
    ],
  );

  const onPress = useCallback(() => props.onToggle(props.row), [props.onToggle, props.row]);
  const subtitle = [props.row.locked ? "Global" : null, props.row.description]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      className={cn(
        "min-h-14 flex-row items-center bg-card",
        !props.isLast && "border-b border-border-subtle",
      )}
      style={{ opacity: props.row.locked ? 0.65 : 1 }}
    >
      <Pressable
        accessibilityLabel={[props.row.name, subtitle].filter(Boolean).join(", ")}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.checked, disabled: props.row.locked }}
        className={cn(
          "min-h-14 min-w-0 flex-1 flex-row items-center gap-3 py-3 pl-4 active:bg-subtle",
          managementActions === null ? "pr-4" : "pr-3",
        )}
        disabled={props.row.locked}
        onPress={onPress}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {props.row.name}
          </Text>
          {subtitle.length > 0 ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {props.checked ? (
          <SymbolView
            name="checkmark"
            size={16}
            tintColor={checkmarkColor}
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </Pressable>
      {managementActions !== null ? (
        <AnchoredMenu actions={managementActions} onPressAction={onPressManagementAction}>
          <View
            accessibilityLabel={`Manage ${props.row.name}`}
            className="items-center justify-center py-3 pr-4 pl-1"
          >
            <SymbolView name="ellipsis" size={16} tintColor={iconColor} type="monochrome" />
          </View>
        </AnchoredMenu>
      ) : null}
    </View>
  );
}

export function NewTaskSkillsPickerRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const placeholderColor = useThemeColor("--color-placeholder");
  const foregroundColor = useThemeColor("--color-foreground");
  const fontFamily = useFontFamily("regular");
  const [query, setQuery] = useState("");

  const environmentId = flow.selectedProject?.environmentId ?? null;
  const skillsQuery = useEnvironmentQuery(
    environmentId !== null ? skillsEnvironment.skillsStateAtom(environmentId) : null,
  );
  const hostSkillsQuery = useEnvironmentQuery(
    environmentId !== null ? skillsEnvironment.hostSkillsStateAtom(environmentId) : null,
  );
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const globallyEnabledIds = useMemo<ReadonlySet<SkillId>>(
    () => new Set(serverConfig?.settings.skills.enabledSkillIds ?? []),
    [serverConfig],
  );

  const sections = useMemo(() => {
    const rows = buildSkillRows({
      installedSkills: skillsQuery.data?.installedSkills ?? [],
      hostSkills: hostSkillsQuery.data?.skills ?? [],
      globallyEnabledIds,
      selectedInstanceId: flow.selectedModel?.instanceId ?? null,
    });
    const trimmedQuery = query.trim().toLowerCase();
    return groupSkillRows(
      trimmedQuery.length === 0 ? rows : rows.filter((row) => skillMatchesQuery(row, trimmedQuery)),
    );
  }, [
    globallyEnabledIds,
    hostSkillsQuery.data,
    query,
    skillsQuery.data,
    flow.selectedModel?.instanceId,
  ]);

  const toggleRow = useCallback(
    (row: SkillRow) => {
      if (row.locked) {
        return;
      }
      void Haptics.selectionAsync();
      flow.toggleSkill(row.id);
    },
    [flow],
  );
  const dropSkillFromDraft = useCallback(
    (skillId: SkillId) => {
      if (flow.selectedSkillIds.includes(skillId)) {
        flow.toggleSkill(skillId);
      }
    },
    [flow],
  );

  const isPending = skillsQuery.isPending || hostSkillsQuery.isPending;
  const loadError = skillsQuery.error ?? hostSkillsQuery.error;
  const refresh = useCallback(() => {
    skillsQuery.refresh();
    hostSkillsQuery.refresh();
  }, [skillsQuery.refresh, hostSkillsQuery.refresh]);

  const content =
    sections.length === 0 ? (
      <ScrollView
        className="flex-1 bg-sheet"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 12 }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 items-center justify-center gap-3 px-4">
          {isPending ? <ActivityIndicator /> : null}
          <Text className="text-center text-sm text-foreground-muted">
            {isPending
              ? "Loading skills…"
              : loadError !== null
                ? loadError
                : query.trim().length > 0
                  ? "No matching skills"
                  : "No skills on this machine"}
          </Text>
          {!isPending && loadError !== null ? (
            <Pressable
              accessibilityRole="button"
              className="rounded-full bg-card px-4 py-2 active:opacity-70"
              onPress={refresh}
            >
              <Text className="text-sm font-t3-medium text-foreground">Try again</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    ) : (
      <ScrollView
        className="flex-1 bg-sheet"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 16) + 16,
          paddingHorizontal: 16,
          paddingTop: 12,
        }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {environmentId !== null
          ? sections.map((section) => (
              <View key={section.group} className="mb-4">
                <Text className="px-1 pb-1.5 text-3xs font-t3-bold uppercase tracking-[0.8px] text-foreground-muted">
                  {section.group}
                </Text>
                <View className="overflow-hidden rounded-2xl bg-card">
                  {section.rows.map((row, index) => (
                    <SkillPickerRow
                      key={row.id}
                      checked={row.locked || flow.selectedSkillIds.includes(row.id)}
                      environmentId={environmentId}
                      isLast={index === section.rows.length - 1}
                      onToggle={toggleRow}
                      onUninstalled={dropSkillFromDraft}
                      row={row}
                    />
                  ))}
                </View>
              </View>
            ))
          : null}
      </ScrollView>
    );

  if (Platform.OS === "android") {
    return (
      <View className="flex-1 bg-sheet" collapsable={false}>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader title="Skills" onBack={() => navigation.goBack()} />
        <View className="px-4 pb-2 pt-3">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 rounded-xl bg-card px-4 text-base text-foreground"
            onChangeText={setQuery}
            placeholder="Find a skill"
            placeholderTextColor={placeholderColor}
            style={{ color: foregroundColor, fontFamily }}
            value={query}
          />
        </View>
        {content}
      </View>
    );
  }

  return (
    <>
      <NativeStackScreenOptions
        options={{
          headerShown: true,
          title: "Skills",
          headerSearchBarOptions: {
            autoCapitalize: "none",
            hideNavigationBar: false,
            obscureBackground: false,
            placeholder: "Find a skill",
            onChangeText: (event) => {
              setQuery(event.nativeEvent.text);
            },
            onCancelButtonPress: () => {
              setQuery("");
            },
          },
        }}
      />
      {content}
    </>
  );
}
