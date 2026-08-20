import { useEffect, useState } from "react";

import { isMacPlatform } from "../lib/utils";

// Matches the hold duration in apps/desktop/src/window/QuitHold.ts: the hint
// from a quick tap lingers for as long as a full hold would have taken.
const HIDE_AFTER_RELEASE_MS = 1200;

/**
 * Chrome-style "Hold ⌘Q to Quit" hint. The desktop main process intercepts
 * the quit accelerator and pushes press/release states; a quick tap shows
 * this pill while a full hold quits the app.
 */
export function QuitHoldOverlay() {
  // "holding" while the shortcut is down (the fill tracks the hold duration),
  // "released" while the hint lingers after a quick tap (the fill drains).
  const [phase, setPhase] = useState<"idle" | "holding" | "released">("idle");

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitShortcut;
    if (!subscribe) return;
    let hideTimer: number | undefined;
    const unsubscribe = subscribe((state) => {
      window.clearTimeout(hideTimer);
      if (state === "down") {
        setPhase("holding");
        return;
      }
      hideTimer = window.setTimeout(() => setPhase("idle"), HIDE_AFTER_RELEASE_MS);
      // A release with no prior press stays hidden, matching the old behavior.
      setPhase((current) => (current === "holding" ? "released" : current));
    });
    return () => {
      window.clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  if (phase === "idle") return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  return (
    <div
      role="status"
      data-quit-phase={phase}
      className="pointer-events-none fixed inset-0 z-100 flex items-start justify-center"
    >
      <div className="quit-hold-scrim absolute inset-0" />
      <div className="relative mt-[22vh] overflow-hidden rounded-full bg-neutral-700/95 px-8 py-4 text-2xl font-bold text-white shadow-xl">
        <span aria-hidden className="quit-hold-fill absolute inset-0 bg-white/14" />
        <span className="relative">Hold {shortcut} to Quit</span>
      </div>
    </div>
  );
}
