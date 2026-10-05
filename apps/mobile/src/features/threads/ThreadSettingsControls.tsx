import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";
import * as Haptics from "expo-haptics";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, View, type AccessibilityActionEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  LayoutAnimationConfig,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import type { ModelOption } from "../../lib/modelOptions";
import {
  enterFade,
  exitFade,
  layoutSettle,
  MOTION_EASING,
  MOTION_ENTER_MS,
  MOTION_SETTLE_SPRING,
  MOTION_TIMING,
} from "../../lib/motion";
import { GlassRowPressable, GroupedCard } from "../scenery/GroupedCard";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import {
  buildThreadSettingsControlLayout,
  fitsSegmentedControl,
  type ReasoningControl,
  type ReasoningLevel,
  type SpeedControl,
} from "./thread-settings-controls";
import { selectableChoices, type RuntimeModeChoice } from "./thread-settings-options";

/** Cards rise into place one after another when the picker opens. */
const CARD_STAGGER_MS = 45;
const CARD_ENTERING = Array.from({ length: 6 }, (_, index) =>
  FadeInDown.duration(MOTION_ENTER_MS)
    .delay(index * CARD_STAGGER_MS)
    .easing(MOTION_EASING)
    .withInitialValues({ transform: [{ translateY: 14 }] })
    .reduceMotion(ReduceMotion.System),
);
const POP_DIP_TIMING = { duration: 90, reduceMotion: ReduceMotion.System } as const;
const TRACK_INSET = 3;
const PLATE_SHADOW = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.12,
  shadowRadius: 4,
} as const;
const METER_BAR_MIN = 6;
const METER_BAR_MAX = 26;
/** The lowest level's bar fills paler than the highest, so the meter reads as intensity. */
const METER_FILL_FLOOR = 0.5;

const ACCESS_TILES: Readonly<
  Record<
    RuntimeMode,
    { readonly label: string; readonly icon: AppSymbolName; readonly caution?: true }
  >
> = {
  "approval-required": { label: "Supervised", icon: "lock" },
  "auto-accept-edits": { label: "Edits", icon: "pencil" },
  auto: { label: "Auto", icon: "sparkles" },
  "full-access": { label: "Full", icon: "lock.open", caution: true },
  yolo: { label: "Full", icon: "lock.open", caution: true },
};

function cardEntering(order: number) {
  return CARD_ENTERING[Math.min(order, CARD_ENTERING.length - 1)];
}

/** Springs a view up from slightly small whenever `active` turns on, never on mount. */
function usePopWhenActivated(active: boolean) {
  const scale = useSharedValue(1);
  const previous = useRef(active);
  useEffect(() => {
    if (active && !previous.current) {
      scale.set(
        withSequence(withTiming(0.72, POP_DIP_TIMING), withSpring(1, MOTION_SETTLE_SPRING)),
      );
    }
    previous.current = active;
  }, [active, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

function IconBadge(props: { readonly icon: AppSymbolName; readonly lit: boolean }) {
  const popStyle = usePopWhenActivated(props.lit);
  return (
    <Animated.View
      className={cn(
        "size-7 items-center justify-center rounded-lg border-continuous",
        props.lit ? "bg-primary" : "bg-subtle-strong",
      )}
      style={popStyle}
    >
      <SymbolView
        name={props.icon}
        size={14}
        tintColorClassName={props.lit ? "accent-primary-foreground" : "accent-icon-muted"}
        type="monochrome"
        weight="semibold"
      />
    </Animated.View>
  );
}

/** Text that fades in whenever it changes; the first value appears without motion. */
function FadeSwapText(props: { readonly text: string; readonly className: string }) {
  return (
    <Animated.View key={props.text} entering={enterFade} className="min-w-0 shrink">
      <Text className={props.className} numberOfLines={1}>
        {props.text}
      </Text>
    </Animated.View>
  );
}

/**
 * One setting as a card: icon, title, and current value on top, its control
 * in the middle, and what the choice means underneath.
 */
function ControlCard(props: {
  readonly order: number;
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly value?: string | null;
  /** Fills the icon badge while the setting is boosted (fast mode on). */
  readonly lit?: boolean;
  /** Warms the value text for a risky choice such as full access. */
  readonly caution?: boolean;
  readonly caption?: string | null;
  readonly children: ReactNode;
}) {
  return (
    <Animated.View
      entering={cardEntering(props.order)}
      exiting={exitFade}
      layout={layoutSettle}
      className="mx-4"
    >
      <GroupedCard>
        <LayoutAnimationConfig skipEntering>
          <View className="min-h-12 flex-row items-center gap-2.5 px-4 pt-3">
            <IconBadge icon={props.icon} lit={props.lit === true} />
            <Text className="text-base font-t3-medium text-foreground">{props.title}</Text>
            <View className="min-w-2 flex-1" />
            {props.value ? (
              <FadeSwapText
                text={props.value}
                className={cn(
                  "text-sm",
                  props.caution ? "text-warning-foreground" : "text-foreground-muted",
                )}
              />
            ) : null}
          </View>
          <View className="px-3 pb-3 pt-2.5">{props.children}</View>
          {props.caption ? (
            <Animated.View key={props.caption} entering={enterFade}>
              <Text className="-mt-0.5 px-4 pb-3.5 text-xs leading-4 text-foreground-muted">
                {props.caption}
              </Text>
            </Animated.View>
          ) : null}
        </LayoutAnimationConfig>
      </GroupedCard>
    </Animated.View>
  );
}

export type GlideSegment = {
  readonly key: string;
  readonly label: string;
  /** Full name when `label` is a short tile label. */
  readonly accessibilityLabel?: string;
  readonly icon?: AppSymbolName;
  readonly caution?: boolean;
};

function GlideSegmentButton(props: {
  readonly segment: GlideSegment;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const popStyle = usePopWhenActivated(props.selected);
  const caution = props.selected && props.segment.caution === true;
  return (
    <Pressable
      accessibilityLabel={props.segment.accessibilityLabel ?? props.segment.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      className={cn(
        "flex-1 items-center justify-center px-1",
        props.segment.icon ? "min-h-14 gap-1 py-2" : "min-h-9 py-2 android:min-h-11",
      )}
      onPress={props.onPress}
      style={({ pressed }) => ({ opacity: pressed && !props.selected ? 0.6 : 1 })}
    >
      {props.segment.icon ? (
        <Animated.View style={popStyle}>
          <SymbolView
            name={props.segment.icon}
            size={17}
            tintColorClassName={
              caution
                ? "accent-warning-foreground"
                : props.selected
                  ? "accent-icon"
                  : "accent-icon-subtle"
            }
            type="monochrome"
            weight={props.selected ? "semibold" : "regular"}
          />
        </Animated.View>
      ) : null}
      <Text
        className={cn(
          props.segment.icon ? "text-2xs" : "text-sm",
          props.selected
            ? cn("font-t3-medium", caution ? "text-warning-foreground" : "text-foreground")
            : "text-foreground-muted",
        )}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        numberOfLines={1}
      >
        {props.segment.label}
      </Text>
    </Pressable>
  );
}

/**
 * Segmented control whose selection plate glides between choices on a
 * spring. A `caution` choice warms the plate while it is selected.
 */
export function GlideSegmentedControl(props: {
  readonly accessibilityLabel: string;
  readonly segments: ReadonlyArray<GlideSegment>;
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
}) {
  const glass = useGlassChromeActive();
  const count = Math.max(1, props.segments.length);
  const hasSelection = props.selectedIndex >= 0;
  const cautionSelected = props.segments[props.selectedIndex]?.caution === true;
  const trackWidth = useSharedValue(0);
  const position = useSharedValue(Math.max(0, props.selectedIndex));
  const caution = useSharedValue(cautionSelected ? 1 : 0);

  useEffect(() => {
    if (props.selectedIndex >= 0) {
      position.set(withSpring(props.selectedIndex, MOTION_SETTLE_SPRING));
    }
  }, [position, props.selectedIndex]);
  useEffect(() => {
    caution.set(withTiming(cautionSelected ? 1 : 0, MOTION_TIMING));
  }, [caution, cautionSelected]);

  const plateStyle = useAnimatedStyle(() => {
    const segmentWidth = Math.max(0, trackWidth.get() - TRACK_INSET * 2) / count;
    return {
      opacity: hasSelection && segmentWidth > 0 ? 1 : 0,
      width: segmentWidth,
      transform: [{ translateX: position.get() * segmentWidth }],
    };
  });
  const cautionStyle = useAnimatedStyle(() => ({ opacity: caution.get() }));

  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="radiogroup"
      className={cn(
        "flex-row rounded-xl border-continuous p-[3px]",
        glass ? "bg-foreground/[0.06]" : "bg-subtle",
      )}
      onLayout={(event) => trackWidth.set(event.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        className="absolute bottom-[3px] left-[3px] top-[3px] rounded-[9px] border-continuous bg-secondary"
        style={[PLATE_SHADOW, plateStyle]}
      >
        <Animated.View
          className="absolute inset-0 rounded-[9px] border border-warning-border border-continuous bg-warning"
          style={cautionStyle}
        />
      </Animated.View>
      {props.segments.map((segment, index) => (
        <GlideSegmentButton
          key={segment.key}
          segment={segment}
          selected={index === props.selectedIndex}
          onPress={() => {
            if (index !== props.selectedIndex) props.onSelect(index);
          }}
        />
      ))}
    </View>
  );
}

function EffortColumn(props: {
  readonly index: number;
  readonly count: number;
  readonly level: SharedValue<number>;
  readonly label: string;
  readonly selected: boolean;
}) {
  const glass = useGlassChromeActive();
  const rank = props.count <= 1 ? 1 : props.index / (props.count - 1);
  const barHeight = METER_BAR_MIN + (METER_BAR_MAX - METER_BAR_MIN) * rank;
  const fillCeiling = METER_FILL_FLOOR + (1 - METER_FILL_FLOOR) * rank;
  const index = props.index;
  const level = props.level;
  // As the level sweeps past each column its bar lights up, so a jump from
  // Low to Max charges across the meter instead of snapping.
  const fillStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, level.get() - index + 1)) * fillCeiling,
  }));

  return (
    <View className="flex-1 items-center gap-1.5 px-1.5 pb-2 pt-2.5">
      <View className="w-full justify-end px-1" style={{ height: METER_BAR_MAX }}>
        <View
          className={cn(
            "w-full rounded-[5px] border-continuous",
            glass ? "bg-foreground/10" : "bg-subtle-strong",
          )}
          style={{ height: barHeight }}
        >
          <Animated.View
            className="absolute inset-0 rounded-[5px] border-continuous bg-primary"
            style={fillStyle}
          />
        </View>
      </View>
      <Text
        className={cn(
          "text-2xs",
          props.selected ? "font-t3-medium text-foreground" : "text-foreground-muted",
        )}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * Reasoning levels as a rising bar meter. Tap a level, or drag across the
 * meter to scrub with a haptic tick per level; the pick lands on release.
 */
function EffortMeter(props: {
  readonly accessibilityLabel: string;
  readonly accessibilityValue: string;
  readonly levels: ReadonlyArray<ReasoningLevel>;
  /** Level drawn as selected: the applied one, or the one under a scrub. */
  readonly shownIndex: number;
  readonly onPreview: (index: number | null) => void;
  readonly onSelect: (index: number) => void;
}) {
  const glass = useGlassChromeActive();
  const count = props.levels.length;
  const meterWidth = useSharedValue(0);
  const level = useSharedValue(props.shownIndex);
  const scrubIndex = useSharedValue(-1);
  const shownRef = useRef(props.shownIndex);
  const { onPreview, onSelect } = props;

  useEffect(() => {
    const distance = Math.abs(props.shownIndex - shownRef.current);
    shownRef.current = props.shownIndex;
    level.set(
      withTiming(props.shownIndex, {
        ...MOTION_TIMING,
        duration: Math.min(360, 140 + distance * 55),
      }),
    );
  }, [level, props.shownIndex]);

  const preview = useCallback(
    (index: number) => {
      void Haptics.selectionAsync().catch(() => undefined);
      onPreview(index);
    },
    [onPreview],
  );
  // A commit leaves its preview up; the card drops it once the applied level arrives.
  const finish = useCallback(
    (index: number) => {
      if (index >= 0) onSelect(index);
      else onPreview(null);
    },
    [onPreview, onSelect],
  );

  const gesture = useMemo(() => {
    const indexAt = (x: number) => {
      "worklet";
      const width = meterWidth.get();
      if (width <= 0 || count === 0) return -1;
      return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
    };
    const scrub = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      // Only a measured meter yields a level, so a scrub that lands before
      // layout never previews "no level" and leaves nothing to clear.
      .onStart((event) => {
        const index = indexAt(event.x);
        if (index < 0) return;
        scrubIndex.set(index);
        runOnJS(preview)(index);
      })
      .onUpdate((event) => {
        const index = indexAt(event.x);
        if (index < 0 || index === scrubIndex.get()) return;
        scrubIndex.set(index);
        runOnJS(preview)(index);
      })
      .onFinalize((_event, success) => {
        const index = scrubIndex.get();
        if (index < 0) return;
        scrubIndex.set(-1);
        runOnJS(finish)(success ? index : -1);
      });
    const tap = Gesture.Tap().onEnd((event, success) => {
      if (success) runOnJS(finish)(indexAt(event.x));
    });
    return Gesture.Race(scrub, tap);
  }, [count, finish, meterWidth, preview, scrubIndex]);

  const highlightStyle = useAnimatedStyle(() => {
    const columnWidth = meterWidth.get() / Math.max(1, count);
    return {
      opacity: Math.min(1, Math.max(0, level.get() + 1)),
      width: columnWidth,
      transform: [{ translateX: level.get() * columnWidth }],
    };
  });

  // Levels the meter hides (Ultracode, Ultrathink) sit above its top, so
  // "less" steps down to the top level and "more" has nowhere to go.
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const current = props.shownIndex < 0 ? count : props.shownIndex;
    if (event.nativeEvent.actionName === "increment" && current < count - 1) {
      onSelect(current + 1);
    } else if (event.nativeEvent.actionName === "decrement" && current > 0) {
      onSelect(current - 1);
    }
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityActions={[
          { name: "increment", label: `More ${props.accessibilityLabel}` },
          { name: "decrement", label: `Less ${props.accessibilityLabel}` },
        ]}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: props.accessibilityValue }}
        className="flex-row"
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={(event) => meterWidth.set(event.nativeEvent.layout.width)}
      >
        <Animated.View
          pointerEvents="none"
          className={cn(
            "absolute inset-y-0 left-0 rounded-xl border-continuous",
            glass ? "bg-foreground/[0.06]" : "bg-subtle",
          )}
          style={highlightStyle}
        />
        {props.levels.map((entry, index) => (
          <EffortColumn
            key={entry.id}
            count={count}
            index={index}
            label={entry.shortLabel}
            level={level}
            selected={index === props.shownIndex}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function ReasoningCard(props: {
  readonly order: number;
  readonly control: ReasoningControl;
  readonly onOptionChange: (id: string, value: string | boolean) => void;
}) {
  const { control, onOptionChange } = props;
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Existing threads receive the applied level a render after the commit, so
  // a scrubbed level stays up until the applied one (or the control) changes.
  const appliedKey = `${control.id}:${control.selectedIndex}`;
  const [previewFor, setPreviewFor] = useState(appliedKey);
  if (previewFor !== appliedKey) {
    setPreviewFor(appliedKey);
    setPreviewIndex(null);
  }
  const shownIndex = previewIndex ?? control.selectedIndex;
  const shown = control.levels[shownIndex];
  const value = shown?.label ?? control.valueLabel;
  const select = useCallback(
    (index: number) => {
      const next = control.levels[index];
      if (next && index !== control.selectedIndex) onOptionChange(control.id, next.id);
      else setPreviewIndex(null);
    },
    [control, onOptionChange],
  );

  return (
    <ControlCard
      order={props.order}
      icon="brain"
      title={control.label}
      value={value}
      caption={shown?.description}
    >
      <EffortMeter
        accessibilityLabel={control.label}
        accessibilityValue={value ?? "Not set"}
        levels={control.levels}
        shownIndex={shownIndex}
        onPreview={setPreviewIndex}
        onSelect={select}
      />
    </ControlCard>
  );
}

function SpeedCard(props: {
  readonly order: number;
  readonly control: SpeedControl;
  readonly onOptionChange: (id: string, value: string | boolean) => void;
}) {
  const selected = props.control.choices[props.control.selectedIndex];
  return (
    <ControlCard
      order={props.order}
      icon="bolt"
      title="Speed"
      value={selected?.label}
      lit={props.control.boosted}
      caption={selected?.description}
    >
      <GlideSegmentedControl
        accessibilityLabel="Speed"
        segments={props.control.choices.map((choice) => ({ key: choice.id, label: choice.label }))}
        selectedIndex={props.control.selectedIndex}
        onSelect={(index) => {
          const choice = props.control.choices[index];
          if (choice) props.onOptionChange(props.control.id, choice.value);
        }}
      />
    </ControlCard>
  );
}

function AccessCard(props: {
  readonly order: number;
  readonly choices: ReadonlyArray<RuntimeModeChoice>;
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const selectedIndex = props.choices.findIndex((choice) => choice.mode === props.runtimeMode);
  const selected = props.choices[selectedIndex];
  const caution = ACCESS_TILES[props.runtimeMode].caution === true;
  return (
    <ControlCard
      order={props.order}
      icon="checkmark.shield"
      title="Access"
      value={selected?.label}
      caution={caution}
      caption={selected?.description}
    >
      <GlideSegmentedControl
        accessibilityLabel="Access"
        segments={props.choices.map((choice) => ({
          key: choice.mode,
          accessibilityLabel: choice.label,
          ...ACCESS_TILES[choice.mode],
        }))}
        selectedIndex={selectedIndex}
        onSelect={(index) => {
          const choice = props.choices[index];
          if (!choice) return;
          void (
            ACCESS_TILES[choice.mode].caution
              ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
              : Haptics.selectionAsync()
          ).catch(() => undefined);
          props.onRuntimeModeChange(choice.mode);
        }}
      />
    </ControlCard>
  );
}

function OptionChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const glass = useGlassChromeActive();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      className={cn(
        "h-8 justify-center rounded-full px-3 android:h-9",
        props.selected
          ? "bg-primary"
          : glass
            ? "border border-chrome-glass-border bg-chrome-glass"
            : "bg-subtle",
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

/** A descriptor without a dedicated card: switch, segmented control, or chips. */
function ExtraOptionRow(props: {
  readonly descriptor: ProviderOptionDescriptor;
  readonly onOptionChange: (id: string, value: string | boolean) => void;
}) {
  const { descriptor } = props;
  if (descriptor.type === "boolean") {
    return (
      <View className="min-h-11 flex-row items-center justify-between gap-3 px-1">
        <Text className="text-sm text-foreground">{descriptor.label}</Text>
        <ThemedSwitch
          accessibilityLabel={descriptor.label}
          value={descriptor.currentValue ?? false}
          onValueChange={(value) => props.onOptionChange(descriptor.id, value)}
        />
      </View>
    );
  }
  const choices = selectableChoices(descriptor);
  const currentValue = getProviderOptionCurrentValue(descriptor);
  const selectedIndex = choices.findIndex((choice) => choice.id === currentValue);
  return (
    <View className="gap-2 py-1">
      <View className="flex-row items-center justify-between gap-3 px-1">
        <Text className="text-sm text-foreground">{descriptor.label}</Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {getProviderOptionCurrentLabel(descriptor) ?? ""}
        </Text>
      </View>
      {fitsSegmentedControl(choices) ? (
        <GlideSegmentedControl
          accessibilityLabel={descriptor.label}
          segments={choices.map((choice) => ({ key: choice.id, label: choice.label }))}
          selectedIndex={selectedIndex}
          onSelect={(index) => {
            const choice = choices[index];
            if (choice) props.onOptionChange(descriptor.id, choice.id);
          }}
        />
      ) : (
        <View
          accessibilityLabel={descriptor.label}
          accessibilityRole="radiogroup"
          className="flex-row flex-wrap gap-1.5"
        >
          {choices.map((choice) => (
            <OptionChip
              key={choice.id}
              label={choice.label}
              selected={choice.id === currentValue}
              onPress={() => {
                if (choice.id !== currentValue) props.onOptionChange(descriptor.id, choice.id);
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ExtrasCard(props: {
  readonly order: number;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onOptionChange: (id: string, value: string | boolean) => void;
}) {
  return (
    <ControlCard order={props.order} icon="slider.horizontal.3" title="More options">
      <View className="gap-2">
        {props.descriptors.map((descriptor, index) => (
          <Fragment key={descriptor.id}>
            {index > 0 ? <View className="mx-1 h-px bg-border-subtle" /> : null}
            <ExtraOptionRow descriptor={descriptor} onOptionChange={props.onOptionChange} />
          </Fragment>
        ))}
      </View>
    </ControlCard>
  );
}

/** The model the thread runs on; pressing it opens the catalog. */
function CurrentModelCard(props: {
  readonly model: ModelOption | null;
  readonly footer?: ReactNode;
  readonly onPress: () => void;
}) {
  const glass = useGlassChromeActive();
  const detail = props.model
    ? [props.model.providerLabel, props.model.subtitle].filter(Boolean).join(" · ")
    : "Browse available models";
  return (
    <Animated.View entering={cardEntering(0)} layout={layoutSettle} className="mx-4">
      <GroupedCard>
        <LayoutAnimationConfig skipEntering>
          <GlassRowPressable
            accessibilityHint="Shows the model list"
            accessibilityLabel={
              props.model ? `Model ${props.model.label}, ${detail}` : "Choose a model"
            }
            accessibilityRole="button"
            className="min-h-16 flex-row items-center gap-3 px-4 py-3"
            fallbackClassName="active:opacity-70"
            onPress={props.onPress}
          >
            <Animated.View
              key={props.model?.key ?? "none"}
              entering={enterFade}
              className={cn(
                "size-10 items-center justify-center rounded-xl border-continuous",
                glass ? "bg-foreground/[0.06]" : "bg-subtle",
              )}
            >
              {props.model ? (
                <ProviderIcon
                  iconUrl={props.model.providerIconUrl}
                  provider={props.model.providerDriver}
                  size={22}
                />
              ) : (
                <SymbolView name="magnifyingglass" size={22} tintColorClassName="accent-icon" />
              )}
            </Animated.View>
            <Animated.View
              key={`label:${props.model?.key ?? "none"}`}
              entering={enterFade}
              className="min-w-0 flex-1"
            >
              <Text className="text-base font-t3-bold text-foreground" numberOfLines={1}>
                {props.model?.label ?? "Choose a model"}
              </Text>
              {detail ? (
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {detail}
                </Text>
              ) : null}
            </Animated.View>
            <View className="flex-row items-center gap-1 rounded-full bg-subtle px-2.5 py-1.5">
              <Text className="text-xs font-t3-medium text-foreground">Change</Text>
              <SymbolView
                name="chevron.right"
                size={10}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
                weight="semibold"
              />
            </View>
          </GlassRowPressable>
        </LayoutAnimationConfig>
        {props.footer ? (
          <View className="border-t border-border-subtle">{props.footer}</View>
        ) : null}
      </GroupedCard>
    </Animated.View>
  );
}

/**
 * Everything about how the thread's agent runs, top of the picker: the
 * current model, then a card each for reasoning, speed, and access, then any
 * remaining provider options. Every change applies immediately.
 */
export function ThreadSettingsControlStack(props: {
  readonly model: ModelOption | null;
  readonly modelFooter?: ReactNode;
  readonly onPressModel: () => void;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onOptionChange: (id: string, value: string | boolean) => void;
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModeChoices: ReadonlyArray<RuntimeModeChoice>;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const layout = useMemo(
    () => buildThreadSettingsControlLayout(props.descriptors),
    [props.descriptors],
  );
  let order = 0;
  return (
    <View className="gap-3">
      <CurrentModelCard
        footer={props.modelFooter}
        model={props.model}
        onPress={props.onPressModel}
      />
      {layout.reasoning ? (
        <ReasoningCard
          control={layout.reasoning}
          order={++order}
          onOptionChange={props.onOptionChange}
        />
      ) : null}
      {layout.speed ? (
        <SpeedCard control={layout.speed} order={++order} onOptionChange={props.onOptionChange} />
      ) : null}
      <AccessCard
        choices={props.runtimeModeChoices}
        order={++order}
        runtimeMode={props.runtimeMode}
        onRuntimeModeChange={props.onRuntimeModeChange}
      />
      {layout.extras.length > 0 ? (
        <ExtrasCard
          descriptors={layout.extras}
          order={++order}
          onOptionChange={props.onOptionChange}
        />
      ) : null}
    </View>
  );
}
