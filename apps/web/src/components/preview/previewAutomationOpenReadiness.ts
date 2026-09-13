import {
  FILL_PREVIEW_VIEWPORT,
  type PreviewAutomationOperation,
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

export function shouldAutoShowPreviewForAutomationUse(input: {
  readonly operation: PreviewAutomationOperation;
  readonly autoShowFloatingPreview: boolean;
  readonly presentationSuppressed: boolean;
}): boolean {
  return (
    input.operation !== "open" && input.autoShowFloatingPreview && !input.presentationSuppressed
  );
}

export function explicitlySuppressesPreviewMiniPlayer(input: PreviewAutomationOpenInput): boolean {
  return (input.open ?? input.show) === false;
}

/**
 * Adapter for T3 Pretty's per-tab presentation state. Upstream owns which
 * automation operations auto-show; Pretty contributes whether this tab is
 * already visible or its floating player has been dismissed.
 */
export function shouldPresentAutomationActivity(input: {
  readonly operation: string;
  readonly autoShowFloatingPreview: boolean;
  readonly tabId: string;
  readonly dismissedTabIds: readonly string[];
  readonly miniPlayerTabId: string | null;
  readonly panelPreviewTabId: string | null;
}): boolean {
  const presentationSuppressed =
    input.dismissedTabIds.includes(input.tabId) ||
    input.miniPlayerTabId === input.tabId ||
    input.panelPreviewTabId === input.tabId;

  return shouldAutoShowPreviewForAutomationUse({
    operation: input.operation as PreviewAutomationOperation,
    autoShowFloatingPreview: input.autoShowFloatingPreview,
    presentationSuppressed,
  });
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
