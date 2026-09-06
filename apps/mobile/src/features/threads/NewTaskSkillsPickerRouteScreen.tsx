import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Skill, SkillId } from "@t3tools/contracts";
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
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { skillsEnvironment } from "../../state/skills";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewTaskFlow } from "./new-task-flow-provider";

const MANAGEMENT_ACTIONS: ReadonlyArray<MenuAction> = [
  { id: "uninstall", title: "Uninstall…", attributes: { destructive: true } },
];

function skillMatchesQuery(skill: Skill, query: string): boolean {
  return (
    skill.name.toLowerCase().includes(query) ||
    skill.dirName.toLowerCase().includes(query) ||
    (skill.description?.toLowerCase().includes(query) ?? false)
  );
}

/** One per-thread pick: tapping attaches the skill's instructions to the first turn. */
function SkillPickerRow(props: {
  readonly checked: boolean;
  readonly environmentId: EnvironmentId;
  readonly isLast: boolean;
  readonly onToggle: (skill: Skill) => void;
  readonly onUninstalled: (skillId: SkillId) => void;
  readonly skill: Skill;
}) {
  const uninstallSkill = useAtomCommand(skillsEnvironment.uninstallSkill, {
    reportFailure: false,
  });

  const onPressManagementAction = useCallback<NonNullable<MenuComponentProps["onPressAction"]>>(
    (event) => {
      if (event.nativeEvent.event !== "uninstall") {
        return;
      }
      const skill = props.skill;
      Alert.alert(
        `Uninstall ${skill.name}?`,
        `${skill.displayPath} and its provider links will be deleted from this machine.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Uninstall",
            style: "destructive",
            onPress: () => {
              void uninstallSkill({
                environmentId: props.environmentId,
                input: { skillId: skill.id },
              }).then((result) => {
                if (result._tag !== "Failure") {
                  props.onUninstalled(skill.id);
                  return;
                }
                if (isAtomCommandInterrupted(result)) {
                  return;
                }
                const error = squashAtomCommandFailure(result);
                Alert.alert(
                  "Could not uninstall skill",
                  error instanceof Error ? error.message : "The skill could not be uninstalled.",
                );
              });
            },
          },
        ],
      );
    },
    [props.environmentId, props.onUninstalled, props.skill, uninstallSkill],
  );

  const onPress = useCallback(() => props.onToggle(props.skill), [props.onToggle, props.skill]);
  const subtitle = props.skill.description ?? props.skill.displayPath;

  return (
    <View
      className={cn(
        "min-h-14 flex-row items-center bg-card",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <Pressable
        accessibilityLabel={`${props.skill.name}, ${subtitle}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.checked }}
        className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 py-3 pr-3 pl-4 active:bg-subtle"
        onPress={onPress}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {props.skill.name}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {props.checked ? (
          <SymbolView
            name="checkmark"
            size={16}
            tintColorClassName="accent-icon"
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </Pressable>
      <AnchoredMenu actions={MANAGEMENT_ACTIONS} onPressAction={onPressManagementAction}>
        <View
          accessibilityLabel={`Manage ${props.skill.name}`}
          className="items-center justify-center py-3 pr-4 pl-1"
        >
          <SymbolView
            name="ellipsis"
            size={16}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </View>
      </AnchoredMenu>
    </View>
  );
}

export function NewTaskSkillsPickerRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const fontFamily = useFontFamily("regular");
  const [query, setQuery] = useState("");

  const environmentId = flow.selectedProject?.environmentId ?? null;
  const skillsQuery = useEnvironmentQuery(
    environmentId !== null ? skillsEnvironment.skillsStateAtom(environmentId) : null,
  );

  const skills = useMemo(() => {
    const all = skillsQuery.data?.skills ?? [];
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery.length === 0
      ? all
      : all.filter((skill) => skillMatchesQuery(skill, trimmedQuery));
  }, [query, skillsQuery.data]);

  const toggleRow = useCallback(
    (skill: Skill) => {
      void Haptics.selectionAsync();
      flow.toggleSkill(skill.id);
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

  const isPending = skillsQuery.isPending;
  const loadError = skillsQuery.error;
  const refresh = skillsQuery.refresh;

  const content =
    skills.length === 0 ? (
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
        {environmentId !== null ? (
          <View className="overflow-hidden rounded-2xl bg-card">
            {skills.map((skill, index) => (
              <SkillPickerRow
                key={skill.id}
                checked={flow.selectedSkillIds.includes(skill.id)}
                environmentId={environmentId}
                isLast={index === skills.length - 1}
                onToggle={toggleRow}
                onUninstalled={dropSkillFromDraft}
                skill={skill}
              />
            ))}
          </View>
        ) : null}
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
            placeholderTextColorClassName="accent-placeholder"
            style={{ fontFamily }}
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
