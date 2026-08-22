/**
 * Terminator sweep for the dark↔light swap: instead of a whole-window
 * crossfade, the new palette's snapshot clips in across the held old one as
 * a moving front — dusk settles downward, dawn rises from the bottom — with
 * a feather veil riding the edge. useTheme drives it; the direction and
 * tempo land as data attributes on <html> that select the keyframes in
 * index.css (see html[data-theme-swap] / html[data-theme-sweep]).
 */

export type SweepDirection = "dusk" | "dawn";
export type ThemeSwapSource = "user" | "system";

export type ActiveThemeSwap = {
  skipTransition: () => void;
  finish: () => void;
};

/** Going dark, night falls from the top; going light, dawn rises. */
export function sweepDirection(incomingDark: boolean): SweepDirection {
  return incomingDark ? "dusk" : "dawn";
}

const MASH_WINDOW_MS = 1000;
const MASH_LIMIT = 2;

let recentSweeps: number[] = [];
let activeThemeSwap: ActiveThemeSwap | null = null;

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

/**
 * Clip-path on a full-viewport snapshot is compositor-cheap on Blink/Gecko.
 * WebKit (Safari and every iOS browser) can re-clip every frame for
 * 600–1200ms — keep those on the dissolve by not setting data-theme-sweep
 * (250ms user, 1200ms system). Brand tokens must be rejected before the
 * allowlist: EdgiOS matches /Edg/.
 */
export function canSweepTerminatorFront(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  if (/iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS/i.test(userAgent)) return false;
  return /Chrome|Chromium|Edg|Firefox/i.test(userAgent);
}

export function retainActiveThemeSwap(swap: ActiveThemeSwap): () => void {
  activeThemeSwap = swap;
  return () => {
    if (activeThemeSwap === swap) activeThemeSwap = null;
  };
}

/** Skip the in-flight View Transition and finish it so a hard-cut is instant. */
export function cutActiveThemeSwap(): void {
  const swap = activeThemeSwap;
  activeThemeSwap = null;
  try {
    swap?.skipTransition();
  } catch {
    // Already finished or not skippable.
  }
  swap?.finish();
}

export function resetMashGuard(): void {
  recentSweeps = [];
  activeThemeSwap = null;
}

/**
 * Mount the feather band that rides the terminator front. Author CSS keeps
 * the live node at opacity 0; only ::view-transition-new(theme-sweep-veil)
 * reveals it. Own view-transition-name keeps it out of the root snapshot pair.
 */
export function mountSweepVeil(): () => void {
  const veil = document.createElement("div");
  veil.className = "theme-sweep-veil";
  document.body.append(veil);
  return () => {
    veil.remove();
  };
}
