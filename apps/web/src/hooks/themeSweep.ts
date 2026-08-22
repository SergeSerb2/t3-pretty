/**
 * Terminator sweep for the dark↔light swap: instead of a whole-window
 * crossfade, the new palette's snapshot clips in across the held old one as
 * a moving front — dusk settles downward, dawn rises from the bottom — with
 * a feather veil riding the edge. useTheme drives it; the direction and
 * tempo land as data attributes on <html> that select the keyframes in
 * index.css (see html[data-theme-swap]).
 */

export type SweepDirection = "dusk" | "dawn";
export type ThemeSwapSource = "user" | "system";

/** Going dark, night falls from the top; going light, dawn rises. */
export function sweepDirection(incomingDark: boolean): SweepDirection {
  return incomingDark ? "dusk" : "dawn";
}

const MASH_WINDOW_MS = 1000;
const MASH_LIMIT = 2;

let recentSweeps: number[] = [];

/**
 * Rapid re-toggles are comparison, not choreography: after two animated
 * sweeps inside one second, further swaps hard-cut until the burst decays.
 * Call once per would-be animated swap; a `true` return was not recorded,
 * so the animation comes back on its own once the window empties.
 */
export function shouldMashCut(now: number): boolean {
  recentSweeps = recentSweeps.filter((at) => now - at < MASH_WINDOW_MS);
  if (recentSweeps.length >= MASH_LIMIT) return true;
  recentSweeps.push(now);
  return false;
}

export function resetMashGuard(): void {
  recentSweeps = [];
}

/**
 * Mount the feather band that rides the terminator front. Must be called in
 * the same task as startViewTransition: the element then reaches the old
 * capture without ever painting live, and its own view-transition-name keeps
 * it out of the root snapshot pair.
 */
export function mountSweepVeil(): () => void {
  const veil = document.createElement("div");
  veil.className = "theme-sweep-veil";
  document.body.append(veil);
  return () => {
    veil.remove();
  };
}
