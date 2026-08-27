import { useEffect, useRef } from "react";

import {
  COMPOSER_HOVER_SPEED_STALE_MS,
  composerHoverDurationScale,
  pointerSpeedPxPerMs,
} from "./composerHoverDuration";

/**
 * Pointer-reactive specular highlight for the composer glass shell. Renders
 * an aria-hidden layer and listens for pointermove on its parent (the glass
 * shell): each update writes two CSS vars that move a pre-rasterized radial
 * gradient with `translate` only, rAF-coalesced to at most one write per
 * frame (latest sample wins — every move updates the coordinates, only the
 * scheduling is skipped). A still pointer produces zero work; styling and the
 * hover fade live in index.css (.chat-composer-specular), which also disables
 * the layer for coarse pointers, reduced motion, and the Motion toggle.
 *
 * Hover in/out duration is a CSS multiplier (`--composer-hover-dur`) written
 * only on enter/leave from the last document pointer speed. The document
 * listener stores coordinates — no layout, no style — so approach velocity
 * exists before the pointer crosses the shell.
 */
export function ComposerSpecular() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let lastSpeed = 0;

    const sampleVelocity = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (lastT !== 0) {
        lastSpeed = pointerSpeedPxPerMs(
          lastX,
          lastY,
          lastT,
          event.clientX,
          event.clientY,
          event.timeStamp,
        );
      }
      lastX = event.clientX;
      lastY = event.clientY;
      lastT = event.timeStamp;
    };

    const applyHoverDuration = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const speed = event.timeStamp - lastT >= COMPOSER_HOVER_SPEED_STALE_MS ? 0 : lastSpeed;
      host.style.setProperty("--composer-hover-dur", String(composerHoverDurationScale(speed)));
    };

    const onPointerMove = (event: PointerEvent) => {
      // The Motion toggle hides the layer (index.css); skip the layout read
      // and rAF too so a disabled highlight costs nothing per move.
      if (event.pointerType !== "mouse") return;
      if (!document.documentElement.hasAttribute("data-scenery-motion")) return;
      const rect = host.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layer.style.setProperty("--spec-x", `${x}px`);
        layer.style.setProperty("--spec-y", `${y}px`);
      });
    };
    document.addEventListener("pointermove", sampleVelocity, { passive: true, capture: true });
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerenter", applyHoverDuration);
    host.addEventListener("pointerleave", applyHoverDuration);
    return () => {
      document.removeEventListener("pointermove", sampleVelocity, { capture: true });
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerenter", applyHoverDuration);
      host.removeEventListener("pointerleave", applyHoverDuration);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={layerRef} aria-hidden className="chat-composer-specular" />;
}
