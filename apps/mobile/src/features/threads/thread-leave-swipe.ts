/** A deliberate right swipe or flick can leave; vertical, reversed, and cancelled drags cannot. */
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
    (event.translationX >= 80 || event.velocityX >= 600)
  );
}
