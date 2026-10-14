export const THREAD_LEAVE_SWIPE_DISTANCE = 80;

/** A completed right swipe or flick can leave; cancelled and reversed drags cannot. */
export function shouldLeaveThreadOnSwipe(event: {
  readonly canceled: boolean;
  readonly translationX: number;
  readonly translationY: number;
  readonly velocityX: number;
}) {
  "worklet";
  return (
    !event.canceled &&
    event.translationX >= 20 &&
    event.velocityX >= 0 &&
    Math.abs(event.translationY) <= Math.abs(event.translationX) / 2 &&
    (event.translationX >= THREAD_LEAVE_SWIPE_DISTANCE || event.velocityX >= 600)
  );
}
