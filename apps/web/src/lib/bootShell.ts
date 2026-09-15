/** Keep in sync with the #boot-shell-t / #boot-shell-three entrance in index.html. */
export const BOOT_SHELL_ENTER_MS = 600;

/** Keep in sync with the #boot-shell exit transition in index.html. */
export const BOOT_SHELL_EXIT_MS = 320;

/** Hold the splash until the lockup has settled so a fast load cannot cut the entrance. */
export function bootShellRevealDelayMs(
  elapsedSinceNavigationMs: number,
  reduceMotion: boolean,
): number {
  if (reduceMotion) return 0;
  return Math.max(0, BOOT_SHELL_ENTER_MS - elapsedSinceNavigationMs);
}
