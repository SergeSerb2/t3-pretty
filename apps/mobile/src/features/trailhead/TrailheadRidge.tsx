import {
  TRAILHEAD_RIDGE_HEIGHT,
  TRAILHEAD_RIDGE_POINTS,
  TRAILHEAD_RIDGE_WIDTH,
  formatTrailheadAltitude,
  trailheadAltitudeAt,
  trailheadRidgePath,
  trailheadRidgeY,
  type TrailheadWaypoint,
} from "@t3tools/shared/trailhead";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

const ThemedSvg = withUniwind(Svg);

/** Height of the drawn ridge band; the safe-area inset is filled below it. */
const TRAILHEAD_RIDGE_BAND_HEIGHT = 132;
/** One climb between waypoints: marker, walked line, and altimeter share it. */
const CLIMB_MS = 900;
const CLIMB_TIMING = {
  duration: CLIMB_MS,
  // Same out-cubic curve as `trailheadAltitudeAt`, so the readout lands with the marker.
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

const RIDGE_LINE = trailheadRidgePath();
const RIDGE_FILL = trailheadRidgePath({ closed: true });
const RIDGE_XS = TRAILHEAD_RIDGE_POINTS.map((point) => point[0]);
const RIDGE_YS = TRAILHEAD_RIDGE_POINTS.map((point) => point[1]);
const SCALE_Y = TRAILHEAD_RIDGE_BAND_HEIGHT / TRAILHEAD_RIDGE_HEIGHT;
const LABEL_WIDTH = 92;
const MARKER_SIZE = 18;

function RidgeSvg(props: { readonly width: number; readonly walked?: boolean }) {
  return (
    <ThemedSvg
      colorClassName="accent-foreground"
      width={props.width}
      height={TRAILHEAD_RIDGE_BAND_HEIGHT}
      viewBox={`0 0 ${TRAILHEAD_RIDGE_WIDTH} ${TRAILHEAD_RIDGE_HEIGHT}`}
      preserveAspectRatio="none"
    >
      {props.walked ? null : <Path d={RIDGE_FILL} fill="currentColor" fillOpacity={0.05} />}
      <Path
        d={RIDGE_LINE}
        fill="none"
        stroke="currentColor"
        strokeOpacity={props.walked ? 0.9 : 0.35}
        strokeWidth={props.walked ? 2 : 1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </ThemedSvg>
  );
}

/**
 * Monospace altitude readout. Counts from the previous waypoint to the new
 * one over a single climb, then stops; reduce motion shows the value at once.
 */
function Altimeter(props: { readonly altitude: number }) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(props.altitude);
  const shownRef = useRef(props.altitude);

  useEffect(() => {
    const from = shownRef.current;
    const to = props.altitude;
    if (reduceMotion || from === to) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    const startedAt = Date.now();
    let frame = 0;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / CLIMB_MS);
      const value = trailheadAltitudeAt(from, to, progress);
      shownRef.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [props.altitude, reduceMotion]);

  return (
    <View
      accessible
      accessibilityLabel={`Altitude ${formatTrailheadAltitude(props.altitude)}`}
      className="absolute left-5 top-1 gap-0.5"
    >
      <Text className="font-mono text-3xs uppercase tracking-[1.4px] text-foreground-tertiary">
        Alt
      </Text>
      <Text className="font-mono text-sm tabular-nums text-foreground">
        {formatTrailheadAltitude(shown)}
      </Text>
    </View>
  );
}

/**
 * The ridge along the bottom of Trailhead: a faint full line, a brighter
 * walked segment up to the marker, and one dot per waypoint. Passed
 * waypoints are buttons that walk back down to them.
 */
export function TrailheadRidge<Id extends string>(props: {
  readonly waypoints: ReadonlyArray<TrailheadWaypoint<Id>>;
  readonly current: Id;
  readonly canSelect: (id: Id) => boolean;
  readonly onSelect: (id: Id) => void;
}) {
  const [width, setWidth] = useState(0);
  const currentIndex = props.waypoints.findIndex((waypoint) => waypoint.id === props.current);
  const currentWaypoint = props.waypoints[currentIndex]!;
  const markerX = useSharedValue(currentWaypoint.x);

  useEffect(() => {
    markerX.set(withTiming(currentWaypoint.x, CLIMB_TIMING));
  }, [currentWaypoint.x, markerX]);

  const walkedStyle = useAnimatedStyle(() => ({
    width: (markerX.value / TRAILHEAD_RIDGE_WIDTH) * width,
  }));
  const markerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (markerX.value / TRAILHEAD_RIDGE_WIDTH) * width - MARKER_SIZE / 2 },
      {
        translateY: interpolate(markerX.value, RIDGE_XS, RIDGE_YS) * SCALE_Y - MARKER_SIZE / 2,
      },
    ],
  }));

  return (
    <View
      className="w-full"
      style={{ height: TRAILHEAD_RIDGE_BAND_HEIGHT }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <RidgeSvg width={width} />
          </View>
          <Animated.View
            pointerEvents="none"
            style={[styles.walked, walkedStyle]}
            importantForAccessibility="no-hide-descendants"
          >
            <RidgeSvg width={width} walked />
          </Animated.View>
          {props.waypoints.map((waypoint, index) => {
            const left = (waypoint.x / TRAILHEAD_RIDGE_WIDTH) * width;
            const top = trailheadRidgeY(waypoint.x) * SCALE_Y;
            const passed = index < currentIndex;
            const selectable = passed && props.canSelect(waypoint.id);
            const labelLeft = Math.min(
              Math.max(left - LABEL_WIDTH / 2, 4),
              width - LABEL_WIDTH - 4,
            );
            return (
              <Pressable
                key={waypoint.id}
                accessibilityRole="button"
                accessibilityLabel={`Back to ${waypoint.name}`}
                accessibilityState={{ disabled: !selectable }}
                accessibilityElementsHidden={!selectable}
                importantForAccessibility={selectable ? "yes" : "no-hide-descendants"}
                disabled={!selectable}
                hitSlop={8}
                onPress={() => props.onSelect(waypoint.id)}
                style={{
                  position: "absolute",
                  left: labelLeft,
                  top: top - 10,
                  width: LABEL_WIDTH,
                  height: 40,
                }}
              >
                <View
                  className={cn(
                    "absolute size-2 rounded-full",
                    index <= currentIndex
                      ? "bg-foreground"
                      : "border border-foreground/40 bg-screen",
                  )}
                  style={{ left: left - labelLeft - 4, top: 6 }}
                />
                <Text
                  numberOfLines={1}
                  className={cn(
                    "absolute inset-x-0 top-[18px] text-center font-mono text-3xs uppercase tracking-[1.2px]",
                    index === currentIndex ? "text-foreground" : "text-foreground-tertiary",
                  )}
                >
                  {waypoint.name}
                </Text>
              </Pressable>
            );
          })}
          <Animated.View
            pointerEvents="none"
            className="absolute left-0 top-0 items-center justify-center rounded-full border-[1.5px] border-foreground"
            style={[{ width: MARKER_SIZE, height: MARKER_SIZE }, markerStyle]}
          >
            <View className="size-2 rounded-full bg-foreground" />
          </Animated.View>
          <Altimeter altitude={currentWaypoint.altitude} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  walked: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
});
