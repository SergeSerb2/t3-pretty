import type { RuntimeMode } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { GlassSurface } from "../../components/GlassSurface";
import { OverlayPortal } from "../../components/OverlayPortal";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ModelOption } from "../../lib/modelOptions";
import type { ThreadSettingsPickerModel } from "./thread-settings-picker";

/**
 * Everyday composer picker: current model plus one-tap effort/tier/runtime.
 * Long catalogs (Cursor) leave the list in the searchable sheet.
 */
const POPOVER_MAX_WIDTH = 360;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 8;
const POPOVER_ENTERING = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

type AnchorSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function ChoiceChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      className={cn(
        "h-8 justify-center rounded-full px-3",
        props.selected ? "bg-primary" : "bg-subtle",
      )}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          props.selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function ChoiceChipRow(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2 px-3.5 py-2.5">
      <Text className="text-xs font-t3-medium text-foreground-muted">{props.label}</Text>
      <View className="flex-row flex-wrap gap-1.5">{props.children}</View>
    </View>
  );
}

export function ThreadSettingsPickerPopover(props: {
  readonly accessibilityLabel?: string;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly model: ThreadSettingsPickerModel;
  readonly onBrowseModels: () => void;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly onSelectOption: (id: string, value: string | boolean) => void;
  readonly onSelectRuntime: (mode: RuntimeMode) => void;
}) {
  const [anchor, setAnchor] = useState<AnchorSnapshot | null>(null);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const iconSubtle = useThemeColor("--color-icon-subtle");
  const glassTint = useThemeColor("--color-glass-surface");

  const close = useCallback(() => setAnchor(null), []);

  if (props.disabled) {
    return props.children;
  }

  const popoverWidth = Math.min(POPOVER_MAX_WIDTH, windowWidth - SCREEN_MARGIN * 2);
  const maxHeight =
    anchor === null ? 0 : Math.max(0, anchor.y - insets.top - ANCHOR_GAP - SCREEN_MARGIN);
  const left =
    anchor === null
      ? SCREEN_MARGIN
      : Math.min(
          Math.max(anchor.x + anchor.width / 2 - popoverWidth / 2, SCREEN_MARGIN),
          windowWidth - popoverWidth - SCREEN_MARGIN,
        );
  const bottom = anchor === null ? 0 : windowHeight - anchor.y + ANCHOR_GAP;

  const pickOption = (id: string, value: string | boolean) => {
    void Haptics.selectionAsync();
    props.onSelectOption(id, value);
  };
  const pickRuntime = (mode: RuntimeMode) => {
    void Haptics.selectionAsync();
    props.onSelectRuntime(mode);
  };
  const pickModel = (option: ModelOption) => {
    void Haptics.selectionAsync();
    props.onSelectModel(option);
  };
  const browseModels = () => {
    close();
    props.onBrowseModels();
  };

  const frameStyle: ViewStyle = {
    borderCurve: "continuous",
    borderRadius: 16,
    bottom,
    left,
    maxHeight,
    overflow: "hidden",
    position: "absolute",
    width: popoverWidth,
  };

  return (
    <>
      <Pressable
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        collapsable={false}
        onPress={(event) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          event.currentTarget.measureInWindow((x, y, width, height) => {
            setAnchor({ x, y, width, height });
          });
        }}
      >
        <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
          {props.children}
        </View>
      </Pressable>
      {anchor === null ? null : (
        <OverlayPortal>
          <View className="absolute inset-0" pointerEvents="box-none">
            <Pressable
              accessibilityLabel="Dismiss model settings"
              accessibilityRole="button"
              accessible={false}
              className="absolute inset-0"
              onPress={close}
            />
            <Animated.View entering={POPOVER_ENTERING} style={frameStyle}>
              <GlassSurface
                chrome="default"
                glassEffectStyle="regular"
                style={{ borderRadius: 16, maxHeight, overflow: "hidden" }}
                tintColor={glassTint}
              >
                <ScrollView
                  bounces={false}
                  keyboardShouldPersistTaps="always"
                  showsVerticalScrollIndicator={false}
                >
                  {props.model.inlineModels ? (
                    <ChoiceChipRow label="Model">
                      {props.model.inlineModels.map((entry) => (
                        <ChoiceChip
                          key={entry.option.key}
                          label={entry.option.label}
                          selected={entry.selected}
                          onPress={() => pickModel(entry.option)}
                        />
                      ))}
                    </ChoiceChipRow>
                  ) : (
                    <Pressable
                      accessibilityHint="Opens the model catalog"
                      accessibilityLabel={`Change model, ${props.model.modelLabel}`}
                      accessibilityRole="button"
                      className="min-h-12 flex-row items-center gap-2.5 px-3.5 py-2.5 active:opacity-70"
                      onPress={browseModels}
                    >
                      <ProviderIcon provider={props.model.providerDriver} size={16} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
                          {props.model.modelLabel}
                        </Text>
                        {props.model.providerLabel ? (
                          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                            {props.model.providerLabel}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-xs font-t3-medium text-foreground-muted">Change</Text>
                      <SymbolView
                        name="chevron.right"
                        size={12}
                        tintColor={iconSubtle}
                        type="monochrome"
                      />
                    </Pressable>
                  )}

                  <View className="mx-3.5 h-px bg-border-subtle" />

                  {props.model.selectSections.map((section) => (
                    <ChoiceChipRow key={section.id} label={section.label}>
                      {section.choices.map((choice) => (
                        <ChoiceChip
                          key={choice.id}
                          label={choice.label}
                          selected={choice.selected}
                          onPress={() => pickOption(section.id, choice.id)}
                        />
                      ))}
                    </ChoiceChipRow>
                  ))}

                  {props.model.booleanSections.map((section) => (
                    <View
                      key={section.id}
                      className="min-h-11 flex-row items-center justify-between px-3.5 py-2"
                    >
                      <Text className="text-sm font-t3-medium text-foreground">
                        {section.label}
                      </Text>
                      <ThemedSwitch
                        accessibilityLabel={section.label}
                        value={section.value}
                        onValueChange={(value) => pickOption(section.id, value)}
                      />
                    </View>
                  ))}

                  <ChoiceChipRow label="Runtime">
                    {props.model.runtimeChoices.map((choice) => (
                      <ChoiceChip
                        key={choice.mode}
                        label={choice.shortLabel}
                        selected={choice.selected}
                        onPress={() => pickRuntime(choice.mode)}
                      />
                    ))}
                  </ChoiceChipRow>
                </ScrollView>
              </GlassSurface>
            </Animated.View>
          </View>
        </OverlayPortal>
      )}
    </>
  );
}
