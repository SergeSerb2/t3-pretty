import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";

/**
 * Shared motion vocabulary for the mobile app. Prefer these over per-file
 * durations so state changes across screens read as one system: content
 * enters a touch slower than it leaves, layout settles with one curve, and
 * everything respects the system reduce-motion setting.
 *
 * All builders are module-level singletons; Reanimated treats them as
 * read-only config, so sharing instances across components is safe.
 */
export const MOTION_ENTER_MS = 200;
export const MOTION_EXIT_MS = 120;
export const MOTION_LAYOUT_MS = 220;
export const MOTION_EASING = Easing.out(Easing.cubic);

export const enterFade = FadeIn.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

export const enterFadeDown = FadeInDown.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

export const enterFadeUp = FadeInUp.duration(MOTION_ENTER_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

export const exitFade = FadeOut.duration(MOTION_EXIT_MS).reduceMotion(ReduceMotion.System);

export const exitFadeDown = FadeOutDown.duration(MOTION_EXIT_MS).reduceMotion(ReduceMotion.System);

export const layoutSettle = LinearTransition.duration(MOTION_LAYOUT_MS)
  .easing(MOTION_EASING)
  .reduceMotion(ReduceMotion.System);

/** Timing config for withTiming calls that should match entering motion. */
export const MOTION_TIMING = {
  duration: MOTION_ENTER_MS,
  easing: MOTION_EASING,
  reduceMotion: ReduceMotion.System,
} as const;
