import type { Wakeups } from "@t3tools/client-runtime/connection";

// Below this the socket almost always survived (iOS keeps the process alive
// for a while and nothing upstream has timed out yet), so a probe is enough.
// Beyond it the supervisor also opens a replacement lease in parallel with
// the probe, which costs a connection setup that is wasted when the socket
// turns out to be fine — worth it once death is likely.
export const MOBILE_BACKGROUND_RECONNECT_AFTER_MS = 30_000;

export type MobileApplicationActiveWakeup = Extract<
  Wakeups.ConnectionWakeup,
  "application-active-probe" | "application-active-reconnect"
>;

export function mobileApplicationActiveWakeup(
  backgroundedAtMs: number,
  activeAtMs: number,
): MobileApplicationActiveWakeup {
  return activeAtMs - backgroundedAtMs >= MOBILE_BACKGROUND_RECONNECT_AFTER_MS
    ? "application-active-reconnect"
    : "application-active-probe";
}
