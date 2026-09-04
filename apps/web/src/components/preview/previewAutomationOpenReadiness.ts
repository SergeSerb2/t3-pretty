import {
  FILL_PREVIEW_VIEWPORT,
  type PreviewAutomationOpenInput,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
} from "@t3tools/contracts";

/**
 * Viewport an agent-opened tab falls back to when the user has no configured
 * browser default. Agents screenshot and assert against what they open, so a
 * brand-new tab left in fill mode would be sized by whatever the panel happens
 * to be — deterministic beats incidental here.
 */
export const DEFAULT_PREVIEW_AUTOMATION_VIEWPORT = {
  _tag: "freeform",
  width: 1280,
  height: 800,
} as const satisfies PreviewViewportSetting;

/**
 * An explicit `open`/`show` is the agent deliberately surfacing or suppressing
 * its work, so it outranks the preference; the setting only decides what
 * happens when the agent said nothing either way.
 */
export function shouldOpenPreviewMiniPlayer(
  input: PreviewAutomationOpenInput,
  autoShowFloatingPreview = true,
): boolean {
  return input.open ?? input.show ?? autoShowFloatingPreview;
}

/** Input actions that surface the floating player when their tab is hidden. */
export const AUTO_PRESENT_AUTOMATION_OPERATIONS: ReadonlySet<string> = new Set([
  "click",
  "type",
  "press",
  "scroll",
]);

/**
 * Whether an agent input action should pop the floating player so the human
 * can watch. Act → show, unless the user turned auto-show off, already sees
 * the tab (panel or player), or dismissed this tab's player.
 */
export function shouldPresentAutomationActivity(input: {
  readonly operation: string;
  readonly autoShowFloatingPreview: boolean;
  readonly tabId: string;
  readonly dismissedTabIds: readonly string[];
  readonly miniPlayerTabId: string | null;
  readonly panelPreviewTabId: string | null;
}): boolean {
  if (!AUTO_PRESENT_AUTOMATION_OPERATIONS.has(input.operation)) return false;
  if (!input.autoShowFloatingPreview) return false;
  if (input.dismissedTabIds.includes(input.tabId)) return false;
  if (input.miniPlayerTabId === input.tabId) return false;
  if (input.panelPreviewTabId === input.tabId) return false;
  return true;
}

export function previewAutomationOpenNeedsOverlay(
  input: PreviewAutomationOpenInput,
  snapshot: PreviewSessionSnapshot,
): boolean {
  return input.url !== undefined || snapshot.navStatus._tag !== "Idle";
}

export async function previewAutomationDesktopStatusReady(
  readStatus: () => Promise<{ readonly available: boolean }>,
): Promise<boolean> {
  try {
    return (await readStatus()).available;
  } catch {
    // A dormant guest can leave a stale renderer overlay until its deferred
    // close lands. Treat the missing desktop tab as not ready while React
    // mounts its replacement instead of failing the automation request.
    return false;
  }
}

/**
 * Whether a freshly opened automation tab still needs a viewport applied.
 *
 * A configured browser default is sent with `preview.open`, so the snapshot
 * already carries it and nothing is needed here. Fill means the user has no
 * stated preference, which is where the agent fallback applies.
 */
export function previewAutomationDefaultViewport(
  reusedExistingTab: boolean,
  snapshot: PreviewSessionSnapshot,
): PreviewViewportSetting | null {
  const viewport = snapshot.viewport ?? FILL_PREVIEW_VIEWPORT;
  return !reusedExistingTab && viewport._tag === "fill"
    ? DEFAULT_PREVIEW_AUTOMATION_VIEWPORT
    : null;
}
