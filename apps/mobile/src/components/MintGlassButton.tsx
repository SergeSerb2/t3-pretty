import { BlurView } from "expo-blur";
import { useId, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ColorValue } from "react-native";
import Animated, {
  makeMutable,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { AppText as Text } from "./AppText";

/**
 * Pastel mint glass, independent of the selected theme so the controls read
 * as one family everywhere. Ink stays dark enough on the tint for 4.5:1.
 */
const MINT = {
  light: {
    blur: "systemUltraThinMaterialLight",
    fill: "rgba(186, 240, 208, 0.62)",
    fillSelected: "rgba(140, 222, 178, 0.9)",
    rim: "rgba(255, 255, 255, 0.85)",
    ink: "#17603F",
    shadow: "0 4px 10px rgba(95, 191, 138, 0.3)",
    sheenOpacity: 1,
  },
  dark: {
    blur: "systemUltraThinMaterialDark",
    fill: "rgba(118, 214, 164, 0.24)",
    fillSelected: "rgba(118, 214, 164, 0.46)",
    rim: "rgba(196, 255, 222, 0.32)",
    ink: "#CBF7DD",
    shadow: "0 4px 10px rgba(0, 0, 0, 0.32)",
    sheenOpacity: 0.45,
  },
} as const;

export const MINT_GLASS_SIZE = 40;

// Device tilt in [-1, 1], shared by every button and written only by
// MintGlassMotion. Values stay 0 (a static sheen) until it mounts.
const tiltX = makeMutable(0);
const tiltY = makeMutable(0);

function MintGlassTiltDriver() {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  // Low-passed and dead-banded so a phone lying still does not repaint.
  useAnimatedReaction(
    () => gravity.sensor.value,
    (g) => {
      const targetX = Math.max(-1, Math.min(1, g.x / 9.81));
      // Pitch: an upright phone reads z≈0, flat on a table z≈-1.
      const targetY = Math.max(-1, Math.min(1, g.z / 9.81 + 0.5));
      const nextX = tiltX.value + (targetX - tiltX.value) * 0.3;
      const nextY = tiltY.value + (targetY - tiltY.value) * 0.3;
      if (Math.abs(nextX - tiltX.value) + Math.abs(nextY - tiltY.value) < 0.008) return;
      tiltX.set(nextX);
      tiltY.set(nextY);
    },
  );
  return null;
}

/**
 * Mount once at the app root: one gravity sensor and one UI-thread reaction
 * drive the shimmer of every mint glass button. Off with Reduce Motion.
 */
export function MintGlassMotion() {
  const reducedMotion = useReducedMotion();
  return Platform.OS === "ios" && !reducedMotion ? <MintGlassTiltDriver /> : null;
}

function MintSheen(props: {
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const span = Math.max(props.width, props.height);
  // The band rests just off-center and sweeps across the glass as the phone
  // rolls; the specular dot drifts the opposite way for a bit of depth.
  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (tiltX.value * 1.1 - 0.35) * span },
      { translateY: (tiltY.value * 0.5 - 0.2) * span },
    ],
  }));
  const specularStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tiltX.value * 3 }, { translateY: -tiltY.value * 2 }],
  }));

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: (props.width - span * 3) / 2,
            top: (props.height - span * 3) / 2,
            width: span * 3,
            height: span * 3,
            opacity: props.opacity,
          },
          bandStyle,
        ]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={`band${id}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0.36" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.45" stopColor="#F0FFF6" stopOpacity={0.7} />
              <Stop offset="0.5" stopColor="#D4F7FF" stopOpacity={0.5} />
              <Stop offset="0.55" stopColor="#FFF7D1" stopOpacity={0.42} />
              <Stop offset="0.64" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#band${id})`} />
        </Svg>
      </Animated.View>
      {/* Inset past the edges so the drift never uncovers an unlit strip. */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", inset: -4 }, specularStyle]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id={`spec${id}`} cx="0.32" cy="0.12" rx="0.55" ry="0.4">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.75 * props.opacity} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={`caus${id}`} cx="0.6" cy="1" rx="0.6" ry="0.45">
              <Stop offset="0" stopColor="#C8FFE0" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#C8FFE0" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#caus${id})`} />
          <Rect width="100%" height="100%" fill={`url(#spec${id})`} />
        </Svg>
      </Animated.View>
    </>
  );
}

/**
 * A round (icon) or capsule (label) pastel-mint glass control. Used for
 * header corners and floating circle controls on iOS.
 */
export function MintGlassButton(props: {
  readonly icon?: AppSymbolName;
  readonly iconNode?: ReactNode;
  readonly label?: string;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
  readonly onPressIn?: () => void;
  readonly onPressOut?: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly tintColor?: ColorValue;
  readonly size?: number;
  /** False when a wrapping menu is the accessible element. */
  readonly accessible?: boolean;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const palette = MINT[themeAppearance === "dark" ? "dark" : "light"];
  const [capsuleWidth, setCapsuleWidth] = useState<number>();
  const pressed = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressed.value }] }));

  const size = props.size ?? MINT_GLASS_SIZE;
  const isCapsule = !props.icon && !props.iconNode && Boolean(props.label);
  const width = isCapsule ? undefined : size;
  const radius = size / 2;
  const ink = props.tintColor ?? palette.ink;
  const sheenWidth = isCapsule ? (capsuleWidth ?? size * 2.5) : size;

  return (
    <Animated.View
      style={[
        {
          borderRadius: radius,
          // boxShadow follows the border radius; a layer shadow would be
          // re-rendered from the blurred, moving pixels on every frame.
          boxShadow: props.disabled ? undefined : palette.shadow,
          opacity: props.disabled ? 0.45 : 1,
        },
        pressStyle,
      ]}
    >
      <Pressable
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: props.disabled, selected: props.selected }}
        disabled={props.disabled}
        accessible={props.accessible}
        hitSlop={6}
        onLayout={
          isCapsule ? (event) => setCapsuleWidth(event.nativeEvent.layout.width) : undefined
        }
        onPress={props.onPress}
        onPressIn={() => {
          pressed.set(withSpring(0.9, { damping: 18, stiffness: 420 }));
          props.onPressIn?.();
        }}
        onPressOut={() => {
          pressed.set(withSpring(1, { damping: 14, stiffness: 260 }));
          props.onPressOut?.();
        }}
        style={{
          height: size,
          width,
          minWidth: size,
          paddingHorizontal: isCapsule ? 14 : 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.rim,
          overflow: "hidden",
        }}
      >
        <BlurView
          pointerEvents="none"
          intensity={60}
          tint={palette.blur}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: props.selected ? palette.fillSelected : palette.fill },
          ]}
        />
        <MintSheen width={sheenWidth} height={size} opacity={palette.sheenOpacity} />
        {props.iconNode ??
          (props.icon ? (
            <SymbolView
              name={props.icon}
              size={Math.round(size * 0.48)}
              tintColor={ink}
              type="monochrome"
              weight="semibold"
            />
          ) : (
            <Text
              numberOfLines={1}
              style={{ color: ink, fontSize: 15, fontWeight: "600", letterSpacing: -0.2 }}
            >
              {props.label}
            </Text>
          ))}
      </Pressable>
    </Animated.View>
  );
}
