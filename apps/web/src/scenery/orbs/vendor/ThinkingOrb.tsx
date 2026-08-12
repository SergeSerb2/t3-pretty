// @ts-nocheck -- vendored from thinking-orbs (MIT, Jakub Antalik); the upstream
// library is not written for this repo's noUncheckedIndexedAccess setting.
// The ThinkingOrb component. One 30fps rAF scheduler keeps every mounted
// orb in phase and pauses automatically while offscreen, hidden, or unfocused.
// Each canvas is paint-contained so a dirty frame cannot invalidate the
// scenery/chat layer. Reduced-motion and persistent status placements get a
// static representative frame that still follows the live theme.

import { useEffect, useRef } from "react";
import { MODE_DRAWS } from "./engine/registry";
import { subscribeOrbAnimationFrame } from "./orbAnimationScheduler";
import { resolvePreset } from "./presets";
import { useReducedMotion, useResolvedDark } from "./theme";
import type { ThinkingOrbProps } from "./types";

const LABELS: Record<string, string> = {
  working: "Working…",
  searching: "Searching…",
  solving: "Solving…",
  listening: "Listening…",
  connecting: "Connecting…",
  weaving: "Weaving…",
  composing: "Composing…",
  breathing: "Thinking…",
  shaping: "Shaping…",
};

export function ThinkingOrb({
  state = "working",
  size = 64,
  theme = "auto",
  speed = 1,
  paused = false,
  style,
  "aria-label": ariaLabel,
  ...rest
}: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useResolvedDark(theme, ref);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx =
      canvas.getContext("2d", { alpha: true, desynchronized: true }) ?? canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { mode, speed: baseSpeed, opts } = resolvePreset(state, size);
    const draw = MODE_DRAWS[mode];
    const effSpeed = baseSpeed * speed;

    const frame = (tSec: number) => {
      ctx.clearRect(0, 0, size, size);
      draw(ctx, size, tSec, dark, opts);
    };

    // Reduced motion and explicitly quiet placements (sidebar status chrome)
    // render once and install no observers, listeners, or animation clock.
    if (reduced || paused) {
      frame(reduced ? 0.6 : (performance.now() / 1000) * effSpeed);
      return;
    }

    let unsubscribeFrame: (() => void) | null = null;
    const start = () => {
      if (unsubscribeFrame !== null) return;
      unsubscribeFrame = subscribeOrbAnimationFrame((timestamp) => {
        frame((timestamp / 1000) * effSpeed);
      });
    };
    const stop = () => {
      unsubscribeFrame?.();
      unsubscribeFrame = null;
    };

    // draw at least one frame even when paused/offscreen
    frame((performance.now() / 1000) * effSpeed);

    // pause offscreen + on hidden tabs — free when not visible
    let visible = false;
    let pageActive = document.visibilityState !== "hidden" && document.hasFocus();
    const updateRunning = () => {
      if (visible && pageActive) start();
      else stop();
    };
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            updateRunning();
          })
        : null;
    io?.observe(canvas);
    const onPageActivity = () => {
      pageActive = document.visibilityState !== "hidden" && document.hasFocus();
      updateRunning();
    };
    document.addEventListener("visibilitychange", onPageActivity);
    window.addEventListener("focus", onPageActivity);
    window.addEventListener("blur", onPageActivity);
    if (!io) {
      visible = true;
      updateRunning();
    }

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onPageActivity);
      window.removeEventListener("focus", onPageActivity);
      window.removeEventListener("blur", onPageActivity);
    };
  }, [state, size, dark, speed, paused, reduced]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? LABELS[state]}
      style={{
        width: size,
        height: size,
        display: "block",
        ...style,
        // Size+paint containment keeps a 30fps canvas dirty-rect from
        // invalidating the scenery wallpaper / chat layer on 240 Hz displays.
        contain: "strict",
      }}
      {...rest}
    />
  );
}
