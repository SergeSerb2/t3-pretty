import * as Haptics from "expo-haptics";

/**
 * Semantic haptics for user-caused moments. Fire one per action, in the same
 * frame as the visual change, and never as the only feedback. Failures are
 * ignored because devices without a Taptic Engine reject these calls.
 */
function fire(play: () => Promise<void>) {
  try {
    void play().catch(() => undefined);
  } catch {
    // Haptics unavailable on this device or runtime.
  }
}

/** A value ticked to a new option: picker row, segment, choice. */
export function hapticSelection() {
  fire(() => Haptics.selectionAsync());
}

/** A light commit: send, attach, snap, start. */
export function hapticTap() {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A heavier commit: stop, destructive action, long-press menu opening. */
export function hapticThud() {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function hapticSuccess() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Something needs attention, or work stopped short of success. */
export function hapticWarning() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function hapticError() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
