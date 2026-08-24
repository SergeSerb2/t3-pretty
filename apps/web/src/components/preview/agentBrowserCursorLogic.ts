import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";

export type BrowserController = "human" | "agent" | "none";

export function agentBrowserCursorOpacity(active: boolean, controller: BrowserController): number {
  if (active) return 1;
  return controller === "human" ? 0.18 : 0.35;
}

/**
 * Distance-scaled glide duration in screen pixels, so short hops feel
 * instant and long jumps stay legible. Capped below the desktop's
 * AGENT_CURSOR_MOVE_MS click lead so the ripple fires after arrival.
 */
export function agentCursorGlideMs(distancePx: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) return 0;
  return Math.round(Math.min(280, Math.max(120, distancePx * 0.4)));
}

export function agentCursorActionLabel(phase: DesktopPreviewPointerEvent["phase"]): string | null {
  switch (phase) {
    case "click":
      return "Click";
    case "type":
      return "Type";
    case "press":
      return "Press";
    case "scroll":
      return "Scroll";
    case "move":
      return null;
  }
}
