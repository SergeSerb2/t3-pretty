import { useEffect, useRef } from "react";

import {
  COMPOSER_HOVER_SETTLE_MS,
  COMPOSER_HOVER_SPEED_STALE_MS,
  composerHoverDestinationInside,
  composerHoverDurationScale,
  composerHoverIsTraveling,
  composerHoverSettle,
  createComposerHoverTracker,
  type ComposerHoverPhase,
} from "./composerHoverDuration";

/**
 * Pointer-reactive specular highlight for the composer glass shell. Renders
 * an aria-hidden layer and listens for pointermove on its parent (the glass
 * shell): each update writes two CSS vars that move a pre-rasterized radial
 * gradient with `translate` only, rAF-coalesced to at most one write per
 * frame (latest sample wins — every move updates the coordinates, only the
 * scheduling is skipped). A still pointer does not schedule a frame; styling and the
 * hover fade live in index.css (.chat-composer-specular), which also disables
 * the layer for coarse pointers, reduced motion, and the Motion toggle.
 *
 * Enter and exit durations are separate CSS multipliers
 * (`--composer-hover-in` / `--composer-hover-out`). Document pointermove keeps
 * the one you are about to use warm, and only rewrites it when the speed
 * bucket changes, so the :hover transition already has the right pace.
 * `--composer-hover-dur` stays in sync for the older glass-shell rules.
 * `--composer-hover-settle` opens the halo once the hand arrives.
 */
export function ComposerSpecular() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    let frame = 0;
    let positioned = false;
    let x = 0;
    let y = 0;
    let decayTimer = 0;
    let settleTimer = 0;
    let pointerInside = false;
    let haloOpen = false;
    let writtenIn = "";
    let writtenOut = "";
    let writtenSettle = "";
    const tracker = createComposerHoverTracker();
    const pointerMotion = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    const motionEnabled = () =>
      pointerMotion.matches && document.documentElement.hasAttribute("data-scenery-motion");

    const insideHost = (node: EventTarget | null) => node instanceof Node && host.contains(node);

    const writeScale = (phase: ComposerHoverPhase, speed: number, approachSpeed: number) => {
      const precise = composerHoverDurationScale(speed, phase, approachSpeed);
      // 0.05 steps. A steady hand must not rewrite style on every pointermove.
      const text = (Math.round(precise * 20) / 20).toFixed(2);
      if (phase === "enter") {
        if (text === writtenIn) return;
        writtenIn = text;
        host.style.setProperty("--composer-hover-in", text);
      } else {
        if (text === writtenOut) return;
        writtenOut = text;
        host.style.setProperty("--composer-hover-out", text);
      }
      host.style.setProperty("--composer-hover-dur", text);
    };

    const writeSettle = (value: number) => {
      const text = value.toFixed(2);
      if (text === writtenSettle) return;
      writtenSettle = text;
      host.style.setProperty("--composer-hover-settle", text);
    };

    const clearSettleTimer = () => {
      window.clearTimeout(settleTimer);
      settleTimer = 0;
    };

    const armSettle = (speed: number) => {
      if (!pointerInside) {
        haloOpen = false;
        clearSettleTimer();
        return;
      }
      // Once the halo has opened, leave it open until the pointer leaves.
      // A pass-through never gets here: travel keeps postponing the timer.
      if (haloOpen) return;
      if (composerHoverIsTraveling(speed)) clearSettleTimer();
      else if (settleTimer !== 0) return;
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        if (!pointerInside) return;
        haloOpen = true;
        writeSettle(1);
      }, COMPOSER_HOVER_SETTLE_MS);
    };

    const armDecay = () => {
      window.clearTimeout(decayTimer);
      decayTimer = window.setTimeout(() => {
        tracker.rest();
        writeScale(pointerInside ? "exit" : "enter", 0, 0);
      }, COMPOSER_HOVER_SPEED_STALE_MS);
    };

    const sampleVelocity = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !motionEnabled()) return;
      const sample = tracker.sample(event.clientX, event.clientY, event.timeStamp);
      pointerInside = insideHost(event.target);
      writeScale(pointerInside ? "exit" : "enter", sample.speed, sample.approachSpeed);
      armDecay();
      if (pointerInside) armSettle(sample.speed);
    };

    const applyHoverDuration = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !motionEnabled()) return;
      const entered = composerHoverDestinationInside(
        event.type,
        insideHost(event.target),
        insideHost(event.relatedTarget),
      );
      if (entered === null) return;
      pointerInside = entered;
      const sample = tracker.crossing(event.clientX, event.clientY, event.timeStamp);
      // The bucket written on the way in can hide a same-bucket change.
      // Force this cross by clearing the cache for the phase we are entering.
      if (entered) {
        positioned = false;
        layer.removeAttribute("data-specular-tracking");
        writtenIn = "";
        writeScale("enter", sample.speed, sample.approachSpeed);
        writeSettle(composerHoverSettle(sample.speed));
        armSettle(sample.speed);
        onPointerMove(event);
      } else {
        writtenOut = "";
        writeScale("exit", sample.speed, sample.approachSpeed);
        haloOpen = false;
        clearSettleTimer();
        writeSettle(0);
      }
      armDecay();
    };

    const onPointerMove = (event: PointerEvent) => {
      // The Motion toggle hides the layer (index.css); skip the layout read
      // and rAF too so a disabled highlight costs nothing per move.
      if (event.pointerType !== "mouse" || !motionEnabled()) return;
      x = event.clientX;
      y = event.clientY;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!motionEnabled()) return;
        const rect = host.getBoundingClientRect();
        // Place the glow instantly on entry. Later samples can ease from
        // that painted position instead of sweeping in from the fallback.
        if (positioned && !layer.hasAttribute("data-specular-tracking")) {
          layer.setAttribute("data-specular-tracking", "");
        }
        layer.style.setProperty("--spec-x", `${x - rect.left}px`);
        layer.style.setProperty("--spec-y", `${y - rect.top}px`);
        positioned = true;
      });
    };
    document.addEventListener("pointermove", sampleVelocity, { passive: true, capture: true });
    document.addEventListener("pointerover", applyHoverDuration, { capture: true });
    document.addEventListener("pointerout", applyHoverDuration, { capture: true });
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", sampleVelocity, { capture: true });
      document.removeEventListener("pointerover", applyHoverDuration, { capture: true });
      document.removeEventListener("pointerout", applyHoverDuration, { capture: true });
      host.removeEventListener("pointermove", onPointerMove);
      window.clearTimeout(decayTimer);
      clearSettleTimer();
      if (frame !== 0) cancelAnimationFrame(frame);
      layer.removeAttribute("data-specular-tracking");
    };
  }, []);

  return <div ref={layerRef} aria-hidden className="chat-composer-specular" />;
}
