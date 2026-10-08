import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  ZoomIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { MintGlassButton } from "../../components/MintGlassButton";
import { PulseRing } from "../../components/PulseRing";
import { cn } from "../../lib/cn";
import { MOTION_SETTLE_SPRING } from "../../lib/motion";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED } from "../layout/native-mail-search-toolbar";
import { GLASS_CARD_CLASS_NAME } from "../scenery/glassStyles";
import { CAUGHT_UP_TONE, TONE_BY_BADGE } from "./HomeGlance";
import type { HomeGlanceSummary } from "./home-glance";
import { useDelayedConnectionStatus } from "./WorkspaceConnectionTitle";

export const HOME_TOP_BAR_HEIGHT = 44;
const ACTION_SIZE = 44;
const ACTION_GAP = 8;
const ORB_SIZE = 32;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const ACCESSIBLE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

// Entrances that land with a little bounce; Reduce Motion turns them into cuts.
const glanceEnter = FadeInDown.springify()
  .damping(15)
  .stiffness(220)
  .reduceMotion(ReduceMotion.System);
const glanceExit = FadeOut.duration(90).reduceMotion(ReduceMotion.System);
const orbEnter = ZoomIn.springify().damping(9).stiffness(260).reduceMotion(ReduceMotion.System);

/**
 * iPhone Home replaces the native title bar, search row and glance card with
 * one floating row. iPad columns and the iOS Mail-style search toolbar keep
 * their native headers.
 */
export function useHomeTopBarActive(): boolean {
  const primaryColumn = use(NativePrimaryColumnContext);
  return (
    Platform.OS === "ios" &&
    !(Platform.isPad && primaryColumn !== null) &&
    !NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
  );
}

/** Space the list reserves above its first row for the floating top bar. */
export function useHomeTopBarInset(): number {
  return useSafeAreaInsets().top + HOME_TOP_BAR_HEIGHT + 12;
}

/**
 * One row at the top of iPhone Home: a pill that reads as the day's status
 * ("All caught up", "2 threads need you", "Reconnecting…") and becomes the
 * search field when tapped, with pull requests, automations and settings
 * beside it. The side buttons slide away while searching.
 */
export function HomeTopBar(props: {
  readonly summary: HomeGlanceSummary;
  readonly date: Date;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onOpenPullRequests: () => void;
  readonly onOpenAutomations: (() => void) | null;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironments: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { themeAppearance } = useAppearancePreferences();
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const searching = focused || props.searchQuery.length > 0;
  const status = useDelayedConnectionStatus();

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    return inputRef.current !== null;
  }, []);
  useHardwareKeyboardCommand("focusSearch", focusSearch);

  const actionCount = props.onOpenAutomations === null ? 2 : 3;
  const actionsWidth = actionCount * ACTION_SIZE + (actionCount - 1) * ACTION_GAP;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withSpring(searching ? 1 : 0, MOTION_SETTLE_SPRING));
  }, [progress, searching]);
  // The pill grows into the room the buttons give up; the buttons keep
  // their size and slide off the trailing edge as they fade.
  const actionsStyle = useAnimatedStyle(() => ({
    marginLeft: Math.max(0, 1 - progress.value) * ACTION_GAP,
    width: Math.max(0, 1 - progress.value) * actionsWidth,
    opacity: Math.max(0, 1 - progress.value * 1.6),
    transform: [{ translateX: progress.value * 28 }],
  }));
  const glanceStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - progress.value * 2) }));

  const tone = props.summary.tone === null ? CAUGHT_UP_TONE : TONE_BY_BADGE[props.summary.tone];
  const headline = status?.shortLabel ?? props.summary.headline;
  const detail = status === null ? props.summary.detail : null;
  const orbKey = searching
    ? "search"
    : status !== null
      ? "status"
      : (props.summary.tone ?? "caught-up");
  // Same wash hue as the scenery layer, so the fade reads as part of the backdrop.
  const fadeColor = themeAppearance === "dark" ? "#000000" : "#FFFFFF";

  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top + 2 }]}>
      {/* Rows scrolling up fade into the screen instead of sliding under a hard edge. */}
      <Svg
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { height: insets.top + HOME_TOP_BAR_HEIGHT + 28 }]}
      >
        <Defs>
          <LinearGradient id="home-top-bar-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={fadeColor} stopOpacity={0.92} />
            <Stop offset="0.62" stopColor={fadeColor} stopOpacity={0.6} />
            <Stop offset="1" stopColor={fadeColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#home-top-bar-fade)" />
      </Svg>

      <View className="flex-row items-center px-3" style={{ height: HOME_TOP_BAR_HEIGHT }}>
        <View
          className={cn("min-w-0 flex-1 flex-row items-center", GLASS_CARD_CLASS_NAME)}
          style={styles.pill}
        >
          <BlurView
            pointerEvents="none"
            intensity={28}
            tint="systemUltraThinMaterial"
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            accessibilityLabel={status !== null ? status.label : "Search threads"}
            accessibilityHint={status !== null ? "Opens environment settings" : undefined}
            accessibilityRole="button"
            hitSlop={6}
            onPress={status !== null && !searching ? props.onOpenEnvironments : focusSearch}
            style={styles.orbSlot}
          >
            <View
              className={cn(
                "items-center justify-center rounded-full",
                searching
                  ? "bg-foreground/5"
                  : status !== null
                    ? "bg-adaptive-amber-500-a12-a16"
                    : tone.orbClassName,
              )}
              style={styles.orb}
            >
              {!searching && status === null && props.summary.tone === "working" ? (
                <PulseRing color={tone.dot} radius={ORB_SIZE / 2} />
              ) : null}
              <Animated.View key={orbKey} entering={orbEnter}>
                {!searching && status?.showsProgress ? (
                  <ActivityIndicator size="small" colorClassName="accent-adaptive-amber-700-300" />
                ) : (
                  <SymbolView
                    name={
                      searching ? "magnifyingglass" : status !== null ? "wifi.slash" : tone.symbol
                    }
                    size={14}
                    tintColorClassName={
                      searching
                        ? "accent-foreground-muted"
                        : status !== null
                          ? "accent-adaptive-amber-700-300"
                          : tone.tintClassName
                    }
                    type="monochrome"
                    weight="semibold"
                  />
                )}
              </Animated.View>
            </View>
          </Pressable>

          <View className="min-w-0 flex-1 justify-center self-stretch">
            <TextInput
              ref={inputRef}
              accessibilityLabel="Search threads"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 pr-2 font-sans text-base text-foreground"
              cursorColorClassName="accent-focus"
              onBlur={() => setFocused(false)}
              onChangeText={props.onSearchQueryChange}
              onFocus={() => {
                setFocused(true);
                void Haptics.selectionAsync().catch(() => undefined);
              }}
              placeholder={searching ? "Search threads" : ""}
              placeholderTextColorClassName="accent-placeholder"
              returnKeyType="search"
              selectionColorClassName="accent-focus/32"
              value={props.searchQuery}
            />
            {searching ? null : (
              <Animated.View
                accessible
                accessibilityLabel={[ACCESSIBLE_DATE_FORMATTER.format(props.date), headline, detail]
                  .filter(Boolean)
                  .join(". ")}
                accessibilityRole="header"
                pointerEvents="none"
                className="absolute inset-0 flex-row items-center gap-2 pr-3"
                style={glanceStyle}
              >
                <Animated.View
                  key={headline}
                  entering={glanceEnter}
                  exiting={glanceExit}
                  className="min-w-0 shrink flex-row items-baseline gap-1.5"
                >
                  <Text
                    className="shrink-0 text-[15px] font-t3-bold tracking-tight text-foreground"
                    numberOfLines={1}
                  >
                    {headline}
                  </Text>
                  {detail !== null ? (
                    <Text className="shrink text-xs text-foreground-secondary" numberOfLines={1}>
                      {detail}
                    </Text>
                  ) : null}
                </Animated.View>
                <Text className="ml-auto shrink-0 text-2xs font-t3-medium uppercase tracking-[0.5px] text-foreground-tertiary">
                  {DATE_FORMATTER.format(props.date)}
                </Text>
              </Animated.View>
            )}
          </View>

          {searching ? (
            <Animated.View entering={orbEnter}>
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  props.onSearchQueryChange("");
                  inputRef.current?.blur();
                }}
                className="pr-3"
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={17}
                  tintColorClassName="accent-foreground-muted"
                  type="monochrome"
                />
              </Pressable>
            </Animated.View>
          ) : null}
        </View>

        <Animated.View
          pointerEvents={searching ? "none" : "auto"}
          style={[styles.actions, actionsStyle]}
        >
          <MintGlassButton
            accessibilityLabel="Open pull requests"
            icon="arrow.triangle.pull"
            onPress={props.onOpenPullRequests}
            size={ACTION_SIZE}
          />
          {props.onOpenAutomations !== null ? (
            <MintGlassButton
              accessibilityLabel="Open automations"
              icon="bolt"
              onPress={props.onOpenAutomations}
              size={ACTION_SIZE}
            />
          ) : null}
          <MintGlassButton
            accessibilityLabel="Open settings"
            icon="ellipsis"
            onPress={props.onOpenSettings}
            size={ACTION_SIZE}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { left: 0, position: "absolute", right: 0, top: 0, zIndex: 20 },
  pill: {
    borderCurve: "continuous",
    borderRadius: HOME_TOP_BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    height: HOME_TOP_BAR_HEIGHT,
    overflow: "hidden",
  },
  orbSlot: { paddingLeft: 6, paddingRight: 8 },
  orb: { height: ORB_SIZE, width: ORB_SIZE },
  actions: {
    flexDirection: "row",
    gap: ACTION_GAP,
    overflow: "visible",
  },
});
