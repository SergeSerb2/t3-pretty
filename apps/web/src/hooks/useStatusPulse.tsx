/**
 * Status pulses (working dots, running-terminal and live indicators, the
 * connecting halo) are stepped by one document-wide ticker instead of
 * per-element infinite CSS animations. An infinite compositor animation keeps
 * BeginFrames ticking at the display refresh rate for the whole turn even
 * though the indicator only changes about 1.5 times a second.
 *
 * The ticker writes `html[data-status-pulse]` with a phase 0–5 (~1.5 Hz) that
 * index.css maps to opacity steps for `.status-pulse`, `.status-pulse-wave`
 * and `.status-ping`. It runs only while at least one subscriber is mounted,
 * the document is visible, and motion is allowed (Motion toggle on and no
 * `prefers-reduced-motion`); otherwise the attribute is absent and every
 * indicator renders its static state.
 */
import { useEffect } from "react";

import { cn } from "~/lib/utils";
import { useMotionStore } from "~/scenery/motionStore";

export const STATUS_PULSE_TICK_MS = 667;
export const STATUS_PULSE_PHASES = 6;
export const STATUS_PULSE_ATTRIBUTE = "data-status-pulse";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let phase = 0;
let listening = false;

function motionAllowed(): boolean {
  if (!useMotionStore.getState().enabled) {
    return false;
  }
  return !(globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);
}

function tick() {
  phase = (phase + 1) % STATUS_PULSE_PHASES;
  document.documentElement.setAttribute(STATUS_PULSE_ATTRIBUTE, String(phase));
}

function sync() {
  const shouldRun = subscribers > 0 && !document.hidden && motionAllowed();
  if (shouldRun && timer === null) {
    document.documentElement.setAttribute(STATUS_PULSE_ATTRIBUTE, String(phase));
    timer = setInterval(tick, STATUS_PULSE_TICK_MS);
  } else if (!shouldRun && timer !== null) {
    clearInterval(timer);
    timer = null;
    document.documentElement.removeAttribute(STATUS_PULSE_ATTRIBUTE);
  }
}

function ensureListeners() {
  if (listening) {
    return;
  }
  listening = true;
  document.addEventListener("visibilitychange", sync);
  globalThis.matchMedia?.(REDUCED_MOTION_QUERY).addEventListener?.("change", sync);
  useMotionStore.subscribe(sync);
}

/** Keeps the shared ticker alive until the returned release is called. */
export function subscribeStatusPulse(): () => void {
  ensureListeners();
  subscribers += 1;
  sync();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    subscribers -= 1;
    sync();
  };
}

/** Subscribes the mounted component to the shared ticker while `active`. */
export function useStatusPulse(active = true): void {
  useEffect(() => (active ? subscribeStatusPulse() : undefined), [active]);
}

/** A decorative dot that pulses with the shared ticker while `active`. */
export function StatusPulseDot({
  className,
  active = true,
}: {
  className?: string;
  active?: boolean;
}) {
  useStatusPulse(active);
  return (
    <span aria-hidden="true" className={cn("rounded-full", active && "status-pulse", className)} />
  );
}
