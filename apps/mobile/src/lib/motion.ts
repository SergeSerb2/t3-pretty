import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  LinearTransition,
  ReduceMotion,
  ZoomIn,
} from "react-native-reanimated";

/**
 * Shared motion vocabulary for the mobile app. Prefer these over per-file
 * durations so state changes across screens read as one system: content
 * enters a touch slower than it leaves, layout settles with one curve, and
 * everything respects the system reduce-motion setting.
 *
 * Share configured builders without changing them. Builder modifiers mutate
 * their instance; use the factory when an entrance needs its own delay.
 */
export const MOTION_ENTER_MS = 160;
export const MOTION_EXIT_MS = 100;
export const MOTION_LAYOUT_MS = 180;
export const MOTION_EASING = Easing.bezier(0.23, 1, 0.32, 1);

export const enterFade = FadeIn.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

export function createEnterFadeDown(delay = 0) {
  return FadeInDown.duration(MOTION_ENTER_MS)
    .easing(MOTION_EASING)
    .withInitialValues({ transform: [{ translateY: 3 }] })
    .delay(delay)
    .reduceMotion(ReduceMotion.System);
}

export const enterFadeDown = createEnterFadeDown();

export const enterFadeUp = FadeInUp.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .withInitialValues({ transform: [{ translateY: -3 }] })
  .reduceMotion(ReduceMotion.System);

/** Small entry pop for status glyphs and occasional inline controls. */
export const enterPop = ZoomIn.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .withInitialValues({ transform: [{ scale: 0.97 }] })
  .reduceMotion(ReduceMotion.System);

export const exitFade = FadeOut.duration(MOTION_EXIT_MS).reduceMotion(ReduceMotion.System);

export const exitFadeDown = FadeOutDown.duration(MOTION_EXIT_MS)
  .withTargetValues({ transform: [{ translateY: 3 }] })
  .reduceMotion(ReduceMotion.System);

export const layoutSettle = LinearTransition.duration(MOTION_LAYOUT_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

/** Timing config for withTiming calls that should match entering motion. */
export const MOTION_TIMING = {
  duration: MOTION_ENTER_MS,
  easing: MOTION_EASING,
  reduceMotion: ReduceMotion.System,
} as const;

/** Press feedback: lands fast and settles without a visible bounce. */
export const MOTION_PRESS_SPRING = {
  duration: 120,
  dampingRatio: 1,
  reduceMotion: ReduceMotion.System,
} as const;

/** Things moving into place (chevrons, lifts, reflows): quick with a soft landing. */
export const MOTION_SETTLE_SPRING = {
  duration: 200,
  dampingRatio: 1,
  reduceMotion: ReduceMotion.System,
} as const;

/** Playful release: a small rebound that finishes promptly. */
export const MOTION_POP_SPRING = {
  duration: 180,
  dampingRatio: 0.9,
  reduceMotion: ReduceMotion.System,
} as const;

/** Release half of a press highlight: a touch slower than it arrived, like UIKit. */
export const MOTION_RELEASE_TIMING = {
  duration: 160,
  easing: MOTION_EASING,
  reduceMotion: ReduceMotion.System,
} as const;
