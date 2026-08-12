/**
 * Applies the ink decision by repainting the World Scenery palette in the
 * chosen variant — the same call upstream's appearance system makes
 * (applyThemePalette + the `.dark` class), just with the scenery's verdict
 * instead of the appearance preference.
 *
 * Coexistence with upstream: `applyTheme` in useTheme.ts memoizes its inputs
 * and early-returns when nothing changed, so this override survives until a
 * real preference/system change re-applies the base appearance. A
 * MutationObserver watches for that stomp, adopts what upstream painted as
 * the new base appearance (that is what it would show without us), and
 * re-asserts the decision. Writes we made ourselves are recognized by class
 * + canvas probe and ignored, so the observer cannot loop.
 */
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";

import { applyThemePalette } from "../themePalette";
import { pickInkVariant, type InkDecisionInput, type InkVariant } from "./sceneryInk";
import { WORLD_SCENERY_THEME, WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

const VARIANT_CANVAS = {
  dark: WORLD_SCENERY_THEME.colors.canvas.toLowerCase(),
  light: WORLD_SCENERY_THEME.variants!.light!.canvas.toLowerCase(),
} as const;

function domVariant(root: HTMLElement): InkVariant {
  return root.classList.contains("dark") ? "dark" : "light";
}

/** Which variant the painted canvas var belongs to; null when unrecognized. */
function probeVariant(root: HTMLElement): InkVariant | null {
  const canvas = root.style.getPropertyValue("--app-theme-canvas").trim().toLowerCase();
  if (canvas === VARIANT_CANVAS.dark) {
    return "dark";
  }
  if (canvas === VARIANT_CANVAS.light) {
    return "light";
  }
  return null;
}

function applyVariant(root: HTMLElement, variant: InkVariant): void {
  applyThemePalette(WORLD_SCENERY_THEME_ID, variant);
  root.classList.toggle("dark", variant === "dark");
}

interface OverrideState {
  /** The appearance upstream last painted on its own. */
  readonly base: InkVariant;
  /** Bumped on every detected upstream stomp so the effect re-asserts. */
  readonly epoch: number;
}

/**
 * Keep the palette painted in the variant the ink decision picks for
 * `inputs` (null = no override), restoring upstream's appearance on unmount
 * unless the user has switched themes — then the painted palette is no
 * longer ours to touch. Applies in `useLayoutEffect` so a photo swap that
 * commits inside a view transition captures the new ink in the same frame.
 * Returns the upstream base appearance the decision is relative to.
 */
export function useInkOverride(inputs: Omit<InkDecisionInput, "baseAppearance"> | null): {
  readonly base: InkVariant;
} {
  const lastApplied = useRef<InkVariant | null>(null);
  const [state, observed] = useReducer(
    (previous: OverrideState, seen: InkVariant): OverrideState => ({
      base: seen,
      epoch: previous.epoch + 1,
    }),
    undefined,
    (): OverrideState => ({
      base: typeof document === "undefined" ? "dark" : domVariant(document.documentElement),
      epoch: 0,
    }),
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const applied = lastApplied.current;
      const seen = domVariant(root);
      if (applied === null) {
        return;
      }
      // Class and painted palette both matching what we wrote means the
      // mutation was ours (or a no-op); anything else is an upstream write.
      if (seen !== applied || (probeVariant(root) ?? applied) !== applied) {
        observed(seen);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  const decisionKey = inputs
    ? `${inputs.inkMode}|${inputs.averageColorHex ?? ""}|${inputs.seed}|${inputs.translucency}|${inputs.blur}`
    : null;

  const baseRef = useRef(state.base);
  baseRef.current = state.base;

  const restore = () => {
    const root = document.documentElement;
    const applied = lastApplied.current;
    lastApplied.current = null;
    if (
      applied !== null &&
      applied !== baseRef.current &&
      root.dataset.themeId === WORLD_SCENERY_THEME_ID
    ) {
      applyVariant(root, baseRef.current);
    }
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (inputs === null || root.dataset.themeId !== WORLD_SCENERY_THEME_ID) {
      restoreRef.current();
      return;
    }
    const variant = pickInkVariant({ ...inputs, baseAppearance: state.base });
    // Stamp lastApplied before mutating so the observer's microtask sees
    // our write, not an upstream stomp.
    lastApplied.current = variant;
    if (domVariant(root) !== variant || probeVariant(root) !== variant) {
      applyVariant(root, variant);
    }
    // No cleanup here: a decision change goes straight A→B without bouncing
    // through the base appearance. The unmount effect below restores.
    // decisionKey stands in for the `inputs` object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, state.base, state.epoch]);

  useEffect(() => () => restoreRef.current(), []);

  return { base: state.base };
}
