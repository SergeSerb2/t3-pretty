/**
 * The World Scenery layer stack behind a screen, bottom to top (desktop
 * glass.ts parity):
 *  1. canvas — the screen's opaque background, painted by the caller
 *  2. photo group — duotone gradient fallback + CDN pre-blurred photo, faded
 *     as ONE layer: a single `opacity` on the parent view composites RN
 *     children offscreen, the same trick as the web's `isolation: isolate`
 *  3. legibility wash — flat black (dark) / white (light) overlay carrying
 *     text contrast
 *  4. edge tints — top-heavier gradient so header text clears bright skies
 *
 * The caller keeps its opaque `bg-screen` view and renders this as the first
 * (absolute-fill) child; content above it stays untouched.
 */
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  AppState,
  PixelRatio,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
  dailySeed,
  gradientPair,
  layerStack,
  rgbaColor,
  wallpaperPixelWidth,
  wallpaperURL,
  type SceneryPhoto,
} from "./sceneryLogic";
import { useScenery } from "./SceneryProvider";
import { useReduceMotion } from "./useReduceMotion";
import { useReduceTransparency } from "./useReduceTransparency";

function SceneryGradient(props: { readonly seed: string; readonly opacity?: number }) {
  const pair = gradientPair(props.seed);
  const gradientId = `scenery-${props.seed.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <Svg style={[StyleSheet.absoluteFill, { opacity: props.opacity ?? 1 }]} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={rgbaColor(pair.top)} />
          <Stop offset="1" stopColor={rgbaColor(pair.bottom)} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function SceneryParallaxImage(props: { readonly uri: string }) {
  const reduceMotion = useReduceMotion();
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);
  const live = !reduceMotion && appActive;
  const liveValue = useSharedValue(live);
  useEffect(() => {
    liveValue.value = live;
  }, [live, liveValue]);
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: live ? 32 : 1000 });
  const style = useAnimatedStyle(() => {
    if (!liveValue.value) {
      return { transform: [{ scale: 1 }] };
    }
    // Read pose from the sensor SharedValue inside the worklet. The JS
    // `isAvailable` flag is set after register and does not re-render, so
    // capturing it on the React side would freeze tilt at identity.
    const pitch = sensor.sensor.value.pitch;
    const roll = sensor.sensor.value.roll;
    const tiltY = Math.max(-8, Math.min(8, ((roll * 180) / Math.PI) * 0.32));
    const tiltX = Math.max(-6, Math.min(6, ((pitch * 180) / Math.PI) * 0.28));
    return {
      transform: [
        { perspective: 900 },
        { rotateX: `${-tiltX}deg` },
        { rotateY: `${tiltY}deg` },
        { scale: 1.14 },
      ],
    };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Image
        contentFit="cover"
        source={{ uri: props.uri }}
        style={StyleSheet.absoluteFill}
        transition={250}
      />
    </Animated.View>
  );
}

/** Top-heavier wash gradient (web `.scenery-layer__edges` parity). */
function EdgeTints(props: {
  readonly washColor: string;
  readonly topAlpha: number;
  readonly bottomAlpha: number;
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="scenery-edges" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={props.washColor} stopOpacity={props.topAlpha} />
          <Stop offset="0.3" stopColor={props.washColor} stopOpacity={0} />
          <Stop offset="0.72" stopColor={props.washColor} stopOpacity={0} />
          <Stop offset="1" stopColor={props.washColor} stopOpacity={props.bottomAlpha} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#scenery-edges)" />
    </Svg>
  );
}

export function SceneryBackdrop(props: {
  /** Thread key ("<environmentId>:<threadId>"), or null for the home screen's
   *  photo-of-the-day rotation. */
  readonly threadKey: string | null;
}) {
  const {
    enabled,
    blur,
    translucency,
    depthEffects,
    dailyPhoto,
    photoForThreadKey,
    ensureThreadAssignment,
  } = useScenery();
  const colorScheme = useColorScheme() === "light" ? "light" : "dark";
  const reduceTransparency = useReduceTransparency();
  const { width: windowWidth } = useWindowDimensions();

  const threadKey = props.threadKey;
  useEffect(() => {
    if (enabled && threadKey !== null) {
      ensureThreadAssignment(threadKey);
    }
  }, [enabled, ensureThreadAssignment, threadKey]);

  const photo: SceneryPhoto | null = threadKey !== null ? photoForThreadKey(threadKey) : dailyPhoto;
  const renderWidth = wallpaperPixelWidth(windowWidth * PixelRatio.get());
  const imageSource = useMemo(
    () => (photo === null ? null : wallpaperURL(photo, blur, renderWidth)),
    [photo, blur, renderWidth],
  );

  if (!enabled || reduceTransparency) {
    return null;
  }

  const stack = layerStack(translucency, colorScheme);
  const washColor = colorScheme === "dark" ? "#000000" : "#ffffff";
  // The gradient seeds off the photo id when one exists so the fallback wash
  // always matches the photo it stands in for.
  const gradientSeed = photo?.id ?? threadKey ?? dailySeed();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { overflow: "hidden", opacity: stack.photoOpacity }]}>
        <SceneryGradient seed={gradientSeed} />
        {imageSource !== null ? (
          depthEffects ? (
            <SceneryParallaxImage uri={imageSource} />
          ) : (
            <Image
              contentFit="cover"
              source={{ uri: imageSource }}
              style={StyleSheet.absoluteFill}
              transition={250}
            />
          )
        ) : null}
      </View>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: washColor, opacity: stack.washAlpha }]}
      />
      <EdgeTints
        washColor={washColor}
        topAlpha={stack.edgeTopAlpha}
        bottomAlpha={stack.edgeBottomAlpha}
      />
    </View>
  );
}
