import { Pressable, View } from "react-native";
import { ScopedTheme } from "uniwind";

import { AppText as Text } from "../../../../components/AppText";
import {
  BORING_MOBILE_THEME_ID,
  DEFAULT_MOBILE_THEME_ID,
  isBoringMobileTheme,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../../../lib/mobileTheme";
import { getMobileUniwindThemeName } from "../../../../lib/mobileThemeRuntime";
import { cn } from "../../../../lib/cn";
import { useThemeColor } from "../../../../lib/useThemeColor";
import { PHOTO_SETS, type PhotoSetId } from "../../../scenery/photoSets";
import { useScenery } from "../../../scenery/SceneryProvider";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const APPEARANCE_MODES: ReadonlyArray<{
  readonly id: MobileThemeMode;
  readonly label: string;
}> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function PreviewPane(props: { readonly compact?: boolean }) {
  return (
    <View className="flex-1 overflow-hidden bg-screen">
      <View
        className={cn("bg-card", props.compact ? "h-[18px] gap-0.5 px-1" : "h-[18px] gap-1 px-1.5")}
      >
        <View className="mt-2 flex-row items-center gap-1">
          <View className="size-1.5 rounded-full bg-primary" />
          <View className="h-1 flex-1 rounded-full bg-foreground-muted" />
        </View>
      </View>
      <View
        className={
          props.compact ? "flex-1 justify-between px-1 py-2" : "flex-1 justify-between px-1.5 py-2"
        }
      >
        <View className="gap-1">
          <View className="h-1.5 w-[72%] rounded-full bg-subtle-strong" />
          <View className="h-1.5 w-[46%] rounded-full bg-subtle-strong" />
        </View>
        <View className="items-end gap-1 pb-2">
          <View className="h-3 w-[78%] rounded-full bg-user-bubble" />
          <View className="h-1 w-[38%] rounded-full bg-foreground-muted" />
        </View>
      </View>
    </View>
  );
}

function ModePreview(props: { readonly mode: MobileThemeMode; readonly themeIds: MobileThemeIds }) {
  if (props.mode === "system") {
    return (
      <View className="h-24 w-14 self-center rounded-[16px] border-[1.5px] border-border bg-drawer p-[3px]">
        <View className="flex-1 flex-row overflow-hidden rounded-[11px]">
          <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds.light, "light")}>
            <PreviewPane compact />
          </ScopedTheme>
          <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds.dark, "dark")}>
            <PreviewPane compact />
          </ScopedTheme>
        </View>
        <View className="absolute bottom-[6px] left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-foreground-muted" />
      </View>
    );
  }

  return (
    <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds[props.mode], props.mode)}>
      <View className="h-24 w-14 self-center rounded-[16px] border-[1.5px] border-border bg-drawer p-[3px]">
        <View className="flex-1 flex-row overflow-hidden rounded-[11px]">
          <PreviewPane />
        </View>
        <View className="absolute bottom-[6px] left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-foreground-muted" />
      </View>
    </ScopedTheme>
  );
}

function ModeCard(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly mode: MobileThemeMode;
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly themeIds: MobileThemeIds;
}) {
  return (
    <Pressable
      accessibilityLabel={`${props.label} appearance`}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={cn(
        "min-w-0 flex-1 gap-2 rounded-[24px] p-2 active:scale-[0.97]",
        props.selected ? "border-2 border-primary bg-subtle" : "border border-border bg-card",
      )}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <ModePreview mode={props.mode} themeIds={props.themeIds} />
      <Text
        className={
          props.selected
            ? "text-center text-base font-t3-bold text-foreground"
            : "text-center text-base text-foreground-muted"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { readonly children: string }) {
  return <Text className="px-2 text-sm font-t3-medium text-foreground-muted">{children}</Text>;
}

export function ThemeAppearanceSection() {
  const { isReady, setThemeIdForBothAppearances, setThemeMode, themeId, themeIds, themeMode } =
    useAppearancePreferences();
  const { photoSetId, setPhotoSetId } = useScenery();
  const boring = isBoringMobileTheme(themeId);

  const selectPhotoSet = (next: PhotoSetId) => {
    setPhotoSetId(next);
    setThemeIdForBothAppearances(DEFAULT_MOBILE_THEME_ID);
  };

  return (
    <View className="gap-6">
      <View className="gap-2">
        <SectionLabel>Personalization</SectionLabel>
        <Text className="px-2 text-sm text-foreground-muted">
          Photo themes put a different kind of place behind the glass. Boring restores the original
          T3 Chat colors and turns the photos off.
        </Text>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {PHOTO_SETS.map((product) => (
            <View className="w-[48%]" key={product.id}>
              <ModeCard
                disabled={!isReady}
                label={product.label}
                mode={themeMode}
                onPress={() => selectPhotoSet(product.id)}
                selected={!boring && photoSetId === product.id}
                themeIds={{ light: DEFAULT_MOBILE_THEME_ID, dark: DEFAULT_MOBILE_THEME_ID }}
              />
            </View>
          ))}
          <View className="w-[48%]">
            <ModeCard
              disabled={!isReady}
              label="Boring"
              mode={themeMode}
              onPress={() => setThemeIdForBothAppearances(BORING_MOBILE_THEME_ID)}
              selected={boring}
              themeIds={{ light: BORING_MOBILE_THEME_ID, dark: BORING_MOBILE_THEME_ID }}
            />
          </View>
        </View>
      </View>
      <View className="gap-2">
        <SectionLabel>Color scheme</SectionLabel>
        <View accessibilityRole="radiogroup" className="flex-row gap-2">
          {APPEARANCE_MODES.map((mode) => (
            <ModeCard
              disabled={!isReady}
              key={mode.id}
              label={mode.label}
              mode={mode.id}
              onPress={() => setThemeMode(mode.id)}
              selected={mode.id === themeMode}
              themeIds={themeIds}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
