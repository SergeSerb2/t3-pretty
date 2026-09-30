import { useEffect, useState, type CSSProperties } from "react";

import { isMacPlatform } from "../lib/utils";

// Mirrors QUIT_HOLD_DURATION_MS in apps/desktop/src/window/QuitHold.ts (the
// web bundle cannot import the Electron main process): the fill must complete
// exactly when the desktop hold actually quits.
const QUIT_HOLD_DURATION_MS = 1200;
// The hint from a quick tap lingers for as long as a full hold would have
// taken — the same duration by design, but a separate meaning.
const HIDE_AFTER_RELEASE_MS = QUIT_HOLD_DURATION_MS;

/**
 * Chrome-style "Hold ⌘Q to Quit" hint. The desktop main process intercepts
 * the quit accelerator and pushes press/release states; a quick tap shows
 * this pill while a full hold quits the app.
 */
export function QuitHoldOverlay() {
  // "holding" while the shortcut is down (the fill tracks the hold duration),
  // "released" while the hint lingers after a quick tap (the fill drains).
  const [overlay, setOverlay] = useState<{
    readonly phase: "holding" | "released";
    readonly mode: "hold" | "double-click";
  } | null>(null);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitShortcut;
    if (!subscribe) return;
    let hideTimer: number | undefined;
    let pressedMode: "hold" | "double-click" = "hold";
    const unsubscribe = subscribe((hint) => {
      window.clearTimeout(hideTimer);
      if (hint.state === "down") {
        pressedMode = hint.mode;
        setOverlay({ phase: "holding", mode: hint.mode });
        return;
      }
      if (pressedMode === "double-click") {
        setOverlay(null);
        return;
      }
      hideTimer = window.setTimeout(() => setOverlay(null), HIDE_AFTER_RELEASE_MS);
      // A release with no prior press stays hidden, matching the old behavior.
      setOverlay((current) =>
        current?.phase === "holding" ? { ...current, phase: "released" } : current,
      );
    });
    return () => {
      window.clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  if (overlay === null) return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  const message =
    overlay.mode === "hold"
      ? `Hold ${shortcut} or press twice to quit`
      : `Press ${shortcut} again to quit`;
  return (
    <div
      role="status"
      data-quit-phase={overlay.phase}
      // Drives the CSS fill duration from the mirrored hold constant, so the
      // bar cannot drift from the real quit timing.
      style={{ "--quit-hold-ms": `${QUIT_HOLD_DURATION_MS}ms` } as CSSProperties}
      className="pointer-events-none fixed inset-0 z-100 flex items-start justify-center"
    >
      <div className="quit-hold-scrim absolute inset-0" />
      <div className="relative mt-[22vh] overflow-hidden rounded-full bg-neutral-700/95 px-8 py-4 text-2xl font-bold text-white shadow-xl">
        <span aria-hidden className="quit-hold-fill absolute inset-0 bg-white/14" />
        <span className="relative">{message}</span>
      </div>
    </div>
  );
}
