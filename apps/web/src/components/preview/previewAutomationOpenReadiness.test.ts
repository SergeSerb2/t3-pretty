import type { PreviewAutomationOpenInput, PreviewSessionSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PREVIEW_AUTOMATION_VIEWPORT,
  previewAutomationDesktopStatusReady,
  previewAutomationDefaultViewport,
  previewAutomationOpenNeedsOverlay,
  shouldOpenPreviewMiniPlayer,
  shouldPresentAutomationActivity,
} from "./previewAutomationOpenReadiness";

describe("shouldPresentAutomationActivity", () => {
  const base = {
    operation: "click",
    autoShowFloatingPreview: true,
    tabId: "tab-1",
    dismissedTabIds: [],
    miniPlayerTabId: null,
    panelPreviewTabId: null,
  } as const;

  it("presents input actions on a hidden tab", () => {
    for (const operation of ["click", "type", "press", "scroll"]) {
      expect(shouldPresentAutomationActivity({ ...base, operation })).toBe(true);
    }
  });

  it("ignores passive operations", () => {
    for (const operation of ["status", "snapshot", "navigate", "open", "evaluate", "waitFor"]) {
      expect(shouldPresentAutomationActivity({ ...base, operation })).toBe(false);
    }
  });

  it("respects the auto-show preference, dismissal, and visible surfaces", () => {
    expect(shouldPresentAutomationActivity({ ...base, autoShowFloatingPreview: false })).toBe(
      false,
    );
    expect(shouldPresentAutomationActivity({ ...base, dismissedTabIds: ["tab-1"] })).toBe(false);
    expect(shouldPresentAutomationActivity({ ...base, miniPlayerTabId: "tab-1" })).toBe(false);
    expect(shouldPresentAutomationActivity({ ...base, panelPreviewTabId: "tab-1" })).toBe(false);
    // Another tab's dismissal or surface never blocks this tab.
    expect(
      shouldPresentAutomationActivity({
        ...base,
        dismissedTabIds: ["tab-2"],
        miniPlayerTabId: "tab-2",
        panelPreviewTabId: "tab-2",
      }),
    ).toBe(true);
  });
});

const snapshot = (navStatus: PreviewSessionSnapshot["navStatus"]): PreviewSessionSnapshot => ({
  threadId: "thread-1",
  tabId: "tab-1",
  navStatus,
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-26T00:00:00.000Z",
});

describe("preview automation open readiness", () => {
  it("opens the inline preview by default", () => {
    expect(shouldOpenPreviewMiniPlayer({} as PreviewAutomationOpenInput)).toBe(true);
  });

  it("supports explicit opt-out and the legacy show alias", () => {
    expect(shouldOpenPreviewMiniPlayer({ open: false } as PreviewAutomationOpenInput)).toBe(false);
    expect(shouldOpenPreviewMiniPlayer({ show: false } as PreviewAutomationOpenInput)).toBe(false);
    expect(
      shouldOpenPreviewMiniPlayer({ open: true, show: false } as PreviewAutomationOpenInput),
    ).toBe(true);
  });

  it("does not wait for a desktop overlay when opening an empty tab", () => {
    expect(
      previewAutomationOpenNeedsOverlay(
        {} as PreviewAutomationOpenInput,
        snapshot({ _tag: "Idle" }),
      ),
    ).toBe(false);
  });

  it("waits when an empty tab is immediately given a URL", () => {
    expect(
      previewAutomationOpenNeedsOverlay(
        { url: "https://example.com" } as PreviewAutomationOpenInput,
        snapshot({ _tag: "Idle" }),
      ),
    ).toBe(true);
  });

  it("waits for existing tabs that already have rendered content", () => {
    expect(
      previewAutomationOpenNeedsOverlay(
        {} as PreviewAutomationOpenInput,
        snapshot({
          _tag: "Success",
          url: "https://example.com/",
          title: "Example",
        }),
      ),
    ).toBe(true);
  });

  it("keeps waiting when a stale overlay points at an evicted desktop tab", async () => {
    expect(
      await previewAutomationDesktopStatusReady(async () => {
        throw new Error("PreviewTabNotFoundError");
      }),
    ).toBe(false);
    expect(await previewAutomationDesktopStatusReady(async () => ({ available: true }))).toBe(true);
  });

  it("gives newly-created automation tabs a stable desktop viewport", () => {
    expect(previewAutomationDefaultViewport(false, snapshot({ _tag: "Idle" }))).toEqual(
      DEFAULT_PREVIEW_AUTOMATION_VIEWPORT,
    );
  });

  it("preserves reused and already-fixed browser viewports", () => {
    expect(previewAutomationDefaultViewport(true, snapshot({ _tag: "Idle" }))).toBeNull();
    expect(
      previewAutomationDefaultViewport(false, {
        ...snapshot({ _tag: "Idle" }),
        viewport: { _tag: "freeform", width: 900, height: 600 },
      }),
    ).toBeNull();
  });
});

describe("shouldOpenPreviewMiniPlayer with the floating-preview preference", () => {
  it("honours the preference when the agent said nothing either way", () => {
    // `preview_open` no longer arrives with `open` pre-filled, so an agent
    // that omitted it leaves the decision to the user's setting.
    expect(shouldOpenPreviewMiniPlayer({}, false)).toBe(false);
    expect(shouldOpenPreviewMiniPlayer({}, true)).toBe(true);
  });

  it("lets an explicit request outrank the preference in both directions", () => {
    expect(shouldOpenPreviewMiniPlayer({ open: true }, false)).toBe(true);
    expect(shouldOpenPreviewMiniPlayer({ open: false }, true)).toBe(false);
    expect(shouldOpenPreviewMiniPlayer({ show: true }, false)).toBe(true);
  });
});
