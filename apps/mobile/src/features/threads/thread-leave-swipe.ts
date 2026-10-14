export const THREAD_LEAVE_SWIPE_DISTANCE = 80;

/** Commit a deliberate drag immediately; short flicks must finish before leaving. */
export function shouldLeaveThreadOnSwipe(
  event: {
    readonly canceled?: boolean;
    readonly translationX: number;
    readonly translationY: number;
    readonly velocityX: number;
  },
  phase: "drag" | "release",
) {
  "worklet";
  return (
    !event.canceled &&
    event.translationX >= 20 &&
    event.velocityX >= 0 &&
    Math.abs(event.translationY) <= Math.abs(event.translationX) / 2 &&
    (event.translationX >= THREAD_LEAVE_SWIPE_DISTANCE ||
      (phase === "release" && event.velocityX >= 600))
  );
}
