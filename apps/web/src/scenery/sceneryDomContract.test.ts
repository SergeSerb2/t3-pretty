// @effect-diagnostics nodeBuiltinImport:off - Module-scope raw CSS fixture loading has no Effect test scope.
/**
 * Rebase tripwire for the scenery CSS's structural assumptions about
 * upstream markup. scenery.css targets these selectors positionally; if a
 * nightly rebase renames a slot or wraps the thread view in a new div, the
 * photo silently disappears behind an opaque surface. This test makes that
 * failure loud instead.
 */
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import appSidebarLayoutSource from "../components/AppSidebarLayout.tsx?raw";
import chatComposerSource from "../components/chat/ChatComposer.tsx?raw";
import chatViewSource from "../components/ChatView.tsx?raw";
import previewPanelShellSource from "../components/preview/PreviewPanelShell.tsx?raw";
import threadTerminalDrawerSource from "../components/ThreadTerminalDrawer.tsx?raw";
import sidebarSource from "../components/ui/sidebar.tsx?raw";
import useHandleNewThreadSource from "../hooks/useHandleNewThread.ts?raw";
import useThemeSource from "../hooks/useTheme.ts?raw";
import rightPanelLayoutSource from "../rightPanelLayout.ts?raw";
import rootRouteSource from "../routes/__root.tsx?raw";
import serverThreadRouteSource from "../routes/_chat.$environmentId.$threadId.tsx?raw";
import draftThreadRouteSource from "../routes/_chat.draft.$draftId.tsx?raw";
import sceneryLayerSource from "./SceneryLayer.tsx?raw";
import sceneryPlaceCreditSource from "./SceneryPlaceCredit.tsx?raw";
import sceneryArrivalSource from "./SceneryArrival.tsx?raw";
import sceneryAppearanceSettingsSource from "./SceneryAppearanceSettings.tsx?raw";
import activeScenerySource from "./ActiveScenery.tsx?raw";
import primeWorldScenerySource from "./primeWorldScenery.ts?raw";
import useInkOverrideSource from "./useInkOverride.ts?raw";
import sceneryInkTransitionSource from "./sceneryInkTransition.ts?raw";

// ?raw on a .css module yields "" under the test pipeline (the CSS transform
// wins), so the stylesheet contract reads the file straight from disk.
const indexCssSource = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
const sceneryCssSource = NodeFS.readFileSync(new URL("./scenery.css", import.meta.url), "utf8");

describe("scenery structural contract with upstream markup", () => {
  it("SidebarInset is still main[data-slot=sidebar-inset] painting bg-background", () => {
    expect(sidebarSource).toContain('data-slot="sidebar-inset"');
    expect(sidebarSource).toContain('data-slot="sidebar-inner"');
  });

  it("ChatView root is still the direct bg-background child the CSS clears", () => {
    expect(chatViewSource).toContain(
      '"relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"',
    );
    expect(chatViewSource).toContain("data-chat-header");
  });

  it("the composer overlay still carries the attributes the dock clearance targets", () => {
    expect(chatViewSource).toContain('data-chat-composer-overlay="true"');
    expect(chatViewSource).toContain(
      'data-composer-placement={isDraftHeroState ? "hero" : "docked"}',
    );
    expect(sceneryCssSource).toContain("[data-chat-composer-overlay][data-composer-placement=");
  });

  it("the composer still ends with the spacer the dock clearance subtracts", () => {
    // --scenery-composer-own-spacer mirrors this element; if upstream resizes
    // or removes it, the dock clearance math drifts.
    expect(chatViewSource).toContain(
      "h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]",
    );
  });

  it("the sidebar container still carries data-app-sidebar", () => {
    expect(appSidebarLayoutSource).toContain("data-app-sidebar");
  });

  it("SceneryHost is still mounted at the root route", () => {
    expect(rootRouteSource).toContain("<SceneryHost />");
  });

  it("the thread routes still render ChatView inside SidebarInset", () => {
    for (const text of [serverThreadRouteSource, draftThreadRouteSource]) {
      expect(text).toContain("<SidebarInset");
      expect(text).toContain("<ChatView");
    }
  });
});

describe("composer attach contract with upstream markup", () => {
  it("the right action group the attach slot is injected into still exists", () => {
    expect(chatComposerSource).toContain('data-chat-composer-actions="right"');
  });

  it("the editor chrome the file-chip strip mounts into still exists", () => {
    expect(chatComposerSource).toContain('data-chat-composer-editor-chrome="true"');
  });

  it("the composer still ingests OS-style Files drops on its drag wrapper", () => {
    expect(chatViewSource).toContain("onDrop={workspaceFileDropHandlers.onDrop}");
    expect(chatComposerSource).toContain("addDroppedFiles: (files: File[]) => {");
    expect(chatComposerSource).toContain("void addComposerImages(files)");
  });

  it("ChatView still bakes attached filepaths into the outgoing prompt", () => {
    expect(chatViewSource).toContain("applyAttachedFilePathsSuffix");
    expect(chatViewSource).toContain("takeAttachedFilesForThread");
  });

  it("plan follow-up send also bakes attached filepaths before starting the turn", () => {
    const followUpFnStart = chatViewSource.indexOf("const onSubmitPlanFollowUp = useCallback");
    expect(followUpFnStart).toBeGreaterThan(-1);
    const nextCallback = chatViewSource.indexOf(
      "const onImplementPlanInNewThread = useCallback",
      followUpFnStart,
    );
    const followUpSlice = chatViewSource.slice(
      followUpFnStart,
      nextCallback === -1 ? followUpFnStart + 8000 : nextCallback,
    );
    expect(followUpSlice).toContain("takeAttachedFilesForThread(activeThreadKey)");
    expect(followUpSlice).toContain("applyAttachedFilePathsSuffix");
    expect(followUpSlice).toContain("restoreAttachedFiles(activeThreadKey, attachedFilesSnapshot)");
  });
});

describe("glass contract with upstream chrome", () => {
  it("the composer still wears the glass shell driven by the --glass vars", () => {
    expect(chatViewSource).toContain("chat-composer-glass-shell");
    expect(indexCssSource).toContain("var(--chat-composer-glass-surface) var(--glass-opacity)");
  });

  it("header controls still paint from the --toolbar-control var", () => {
    expect(indexCssSource).toContain("[data-chat-header] [data-toolbar-control]");
    expect(indexCssSource).toContain("background-color: var(--toolbar-control)");
  });

  it("the right panel still exposes the hooks the scenery glass plate targets", () => {
    expect(previewPanelShellSource).toContain("right-panel-inline-body");
    expect(previewPanelShellSource).toContain('data-right-panel=""');
    expect(previewPanelShellSource).toContain(
      'data-right-panel={props.mode === "sidebar" ? "" : "embedded"}',
    );
    expect(rightPanelLayoutSource).toContain("right-panel-sheet");
    expect(sceneryCssSource).toContain(".right-panel-inline-body");
    expect(sceneryCssSource).toContain(".right-panel-sheet");
    expect(sceneryCssSource).toContain('[data-right-panel="embedded"]');
    expect(sceneryCssSource).toMatch(
      /\[data-right-panel=""\]\s+\.bg-background\s*\{[^}]*background-color: transparent;/s,
    );
  });

  it("the bottom terminal drawer wears the same chrome glass plate as the sidebars", () => {
    expect(threadTerminalDrawerSource).toContain(
      'data-terminal-owner={isPanel ? "right-panel" : "drawer"}',
    );
    expect(sceneryCssSource).toContain('[data-terminal-owner="drawer"]');
    expect(sceneryCssSource).toContain("var(--scenery-chrome-fill)");
    expect(sceneryCssSource).toMatch(
      /\[data-terminal-owner="drawer"\]\s*\{[^}]*backdrop-filter: blur\(14px\) saturate\(1\.1\);/s,
    );
    expect(sceneryCssSource).toMatch(
      /\[data-terminal-owner="drawer"\]\s+\.bg-background\s*\{[^}]*background-color: transparent;/s,
    );
    expect(threadTerminalDrawerSource).toContain(
      'attributeFilter: ["class", "style", "data-scenery-on"]',
    );
    expect(threadTerminalDrawerSource).toContain(
      'transparentBackground: document.documentElement.hasAttribute("data-scenery-on")',
    );
  });

  it("chrome glass panels meet without a painted divider", () => {
    const seamRule =
      sceneryCssSource.match(/\/\* Chrome seams:[\s\S]*?\{[^}]*border-color: transparent;/)?.[0] ??
      "";
    expect(seamRule).toContain("[data-app-sidebar]");
    expect(seamRule).toContain(".right-panel-inline-body");
    expect(seamRule).toContain('[data-terminal-owner="drawer"]');
    expect(sceneryCssSource).not.toContain(
      "border-color: color-mix(in srgb, var(--sidebar-foreground) 10%, transparent)",
    );
  });
});

describe("scenery attribution contract", () => {
  it("keeps long photographer credits shrinkable inside the compact Home pill", () => {
    expect(sceneryCssSource).toMatch(
      /\.scenery-attribution__credit\s*\{[^}]*min-width: 0;[^}]*flex-shrink: 1;/s,
    );
    expect(sceneryCssSource).toMatch(
      /\.scenery-attribution__photographer\s*\{[^}]*min-width: 0;[^}]*flex-shrink: 1;[^}]*overflow: hidden;/s,
    );
  });

  it("preserves Unsplash credit spaces in markup and in the painted flex items", () => {
    expect(sceneryCssSource).toMatch(
      /\.scenery-attribution__prefix\s*\{[^}]*flex-shrink: 0;[^}]*white-space: pre;/s,
    );
    expect(sceneryCssSource).toMatch(
      /\.scenery-attribution__separator\s*\{[^}]*flex-shrink: 0;[^}]*white-space: pre;/s,
    );
    expect(sceneryLayerSource).toContain(">Photo by </span>");
    expect(sceneryLayerSource).toContain("> on </span>");
    expect(sceneryPlaceCreditSource).toContain(">Photo by </span>");
    expect(sceneryPlaceCreditSource).toContain("> on </span>");
  });

  it("moves thread credits into the composer and hides the Home pill while the slot is mounted", () => {
    expect(chatViewSource).toContain("data-scenery-place-slot");
    expect(chatViewSource).toContain("bindSceneryPlaceSlot");
    expect(activeScenerySource).toContain("SceneryPlaceCredit");
    expect(sceneryCssSource).toContain("html:has([data-scenery-place-slot]) .scenery-attribution");
    expect(sceneryCssSource).toContain("html:has([data-scenery-composer]) .scenery-attribution");
    expect(sceneryCssSource).toMatch(
      /html:has\(\[data-right-panel-open="true"\]\) \.scenery-attribution\s*\{[^}]*left:/s,
    );
  });

  it("pins the hero place credit to the bottom band, not the centered composer", () => {
    expect(chatViewSource).toContain("absolute inset-0 z-20 flex flex-col");
    expect(chatViewSource).toContain("min-h-0 flex-1 flex-col justify-end");
    expect(chatViewSource).toContain('data-scenery-place-slot=""');
    expect(sceneryCssSource).toMatch(/\.scenery-place\s*\{[^}]*margin: 0 auto;/s);
    expect(sceneryCssSource).toMatch(
      /\[data-composer-placement="docked"\] \.scenery-place\s*\{[^}]*margin-top: 0\.45rem;/s,
    );
  });

  it("hides the docked place credit with the scroll-to-end pill", () => {
    expect(chatViewSource).toContain(
      'data-scenery-place-hidden={showScrollToBottom ? "" : undefined}',
    );
    expect(sceneryCssSource).toContain("[data-scenery-place-slot][data-scenery-place-hidden]");
    expect(sceneryCssSource).toMatch(
      /\[data-scenery-place-slot\]\[data-scenery-place-hidden\]\s+\.scenery-place\s*\{[^}]*opacity: 0;[^}]*visibility: hidden;/s,
    );
  });

  it("does not keep a bottom-right scenery settings dock", () => {
    expect(activeScenerySource).not.toContain("SceneryQuickSettings");
    expect(sceneryCssSource).not.toContain(".scenery-quick__trigger");
    expect(sceneryAppearanceSettingsSource).toContain("Photo blur");
  });
});

describe("scenery new-thread arrival contract", () => {
  it("plays the fog sequence only from the scenery layer", () => {
    expect(activeScenerySource).toContain("SceneryArrival");
    expect(sceneryArrivalSource).toContain("Entering...");
    expect(sceneryCssSource).toContain(".scenery-fog");
    expect(chatViewSource).toContain('data-scenery-hero-chrome="headline"');
    expect(chatViewSource).toContain('data-scenery-hero-chrome="composer"');
  });

  it("docks the World Scenery composer with the longer scenery curve", () => {
    expect(chatViewSource).toContain("SCENERY_DRAFT_HERO_TRANSITION_DURATION_MS");
    expect(chatViewSource).toContain("scenery-hero-headline-ghost");
  });

  it("holds fog until the wallpaper is decoded and primes it before navigation", () => {
    expect(sceneryArrivalSource).toContain("photoReady");
    expect(sceneryArrivalSource).toContain("remainingFogHoldMs");
    expect(sceneryLayerSource).toContain("preloadWallpaper");
    expect(sceneryLayerSource).toContain("sceneryArrivalCoversSwap");
    expect(useHandleNewThreadSource).toContain("primeWorldSceneryForNewThread");
    expect(primeWorldScenerySource).toContain("requestSceneryArrival");
    expect(chatViewSource).toContain("writeSceneryComposerPlacement");
  });

  it("covers the swap with a transition so fog does not restart at reveal", () => {
    expect(sceneryCssSource).toContain("@starting-style");
    expect(sceneryCssSource).toContain("calc(var(--fog-alpha, 1) * 0.78)");
    expect(sceneryCssSource).not.toContain("scenery-fog-gather");
    expect(sceneryCssSource).not.toContain("scenery-fog-dissipate");
  });

  it("does not blur hero chrome during the fog sequence", () => {
    const fogChrome =
      /html\[data-scenery-arrival="fog"\] \[data-scenery-hero-chrome\]\s*\{[^}]+\}/.exec(
        sceneryCssSource,
      )?.[0];
    expect(fogChrome, "missing fog chrome rule").toBeTruthy();
    expect(fogChrome).not.toContain("filter:");
  });

  it("locks fog ink to the arrival overlay so an ink flip cannot snap it", () => {
    expect(sceneryCssSource).toContain('.scenery-arrival[data-fog="light"] .scenery-fog');
    expect(sceneryCssSource).not.toContain("html:not(.dark) .scenery-fog");
  });

  it("uses one warped noise field instead of a repeating turbulence tile", () => {
    expect(sceneryArrivalSource).toContain("scenery-fog__field");
    expect(sceneryArrivalSource).toContain("feDisplacementMap");
    expect(sceneryCssSource).toContain(".scenery-fog__field");
    expect(sceneryCssSource).not.toContain("400px 400px");
    expect(sceneryCssSource).not.toContain("stitchTiles");
  });
});

describe("ink override contract with upstream appearance handling", () => {
  it("useTheme still memoizes applies, so the override survives re-renders", () => {
    expect(useThemeSource).toContain("lastAppliedTheme?.theme === theme");
  });

  it("useTheme still expresses appearance as the html dark class", () => {
    expect(useThemeSource).toContain('classList.toggle("dark", isDark)');
  });

  it("theme swap view transitions run only when transitions are not suppressed", () => {
    expect(useThemeSource).toContain("if (suppressTransitions)");
    expect(useThemeSource).not.toContain("if (!suppressTransitions)");
  });

  it("applies ink in layout so a photo view transition captures the new palette", () => {
    expect(useInkOverrideSource).toContain("useLayoutEffect");
  });

  it("light scenery code plates are sage frost, not blown white", () => {
    expect(sceneryCssSource).toContain("--code-background: rgb(232 238 233 / 88%)");
    expect(sceneryCssSource).toContain("--code-foreground: #161a17");
  });

  it("flattens a mismatched dark highlighter onto a light code plate", () => {
    expect(sceneryCssSource).toContain(".shiki.pierre-dark");
    expect(sceneryCssSource).toContain("color: var(--code-foreground) !important");
  });
});

describe("scenery light/dark appearance crossfade", () => {
  it("holds ink on the displayed photo until the next one has decoded", () => {
    expect(activeScenerySource).toContain("displayedTone");
    expect(activeScenerySource).toContain("appearanceCrossfade");
    expect(activeScenerySource).toContain("delayedInk");
  });

  it("commits an appearance-flipping photo swap inside a view transition", () => {
    expect(sceneryLayerSource).toContain("runSceneryInkTransition");
    expect(sceneryLayerSource).toContain("flushSync(commit)");
    expect(sceneryLayerSource).toContain("appearanceCrossfadeRef.current");
  });

  it("crossfades wash by opacity instead of snapping rgb() channels", () => {
    expect(sceneryCssSource).toContain("scenery-layer__wash--dark");
    expect(sceneryCssSource).toContain("scenery-layer__wash--light");
    expect(sceneryCssSource).toContain("scenery-layer__edges--dark");
    expect(sceneryCssSource).toContain("scenery-layer__edges--light");
    expect(sceneryCssSource).not.toContain("--scenery-wash-channel");
    expect(sceneryLayerSource).toContain(
      'className="scenery-layer__wash scenery-layer__wash--dark"',
    );
  });

  it("dissolves the ink view transition with normal blend so light/dark does not flash", () => {
    expect(sceneryCssSource).toContain("html[data-scenery-ink-transition]");
    expect(sceneryCssSource).toContain("mix-blend-mode: normal");
    expect(sceneryInkTransitionSource).toContain("sceneryInkTransition");
  });

  it("parks the CSS layers only when the view transition really animates", () => {
    // Fallbacks (no API, reduced motion, a skipped start) must keep the CSS
    // dissolve; parking layers for a snapshot that never happens hard-cuts
    // the swap on browsers without View Transitions.
    expect(sceneryInkTransitionSource).toContain("runUpdate(true)");
    expect(sceneryInkTransitionSource).toContain("runUpdate(false)");
    expect(sceneryLayerSource).toContain("inkAnimating = animating");
  });
});

describe("scenery photo swap animations", () => {
  it("keeps exactly one timing function in each animation shorthand", () => {
    // The --scenery-swap-* vars already carry duration + easing; a second
    // timing function after the var() invalidates the whole shorthand at
    // computed-value time and the fades silently stop running.
    for (const keyframes of ["scenery-fade-in", "scenery-fade-out"]) {
      const declaration = new RegExp(`animation: ${keyframes} [^;]+;`).exec(sceneryCssSource)?.[0];
      expect(declaration, `missing animation for ${keyframes}`).toBeTruthy();
      expect(declaration?.match(/cubic-bezier\(/g)).toHaveLength(1);
    }
  });

  it("keeps the fade-out duration mirrored with the React unmount timer", () => {
    expect(sceneryCssSource).toContain("--scenery-swap-out: 0.6s");
    expect(sceneryLayerSource).toContain("SCENERY_SWAP_OUT_MS = 600");
  });

  it("keys the outgoing layer so a new dissolve restarts the animation", () => {
    // Unkeyed, React reuses the node when outgoing changes mid-fade and the
    // new photo inherits the previous one's half-finished dissolve.
    expect(sceneryLayerSource).toContain("key={displayedPhotoKey(outgoing)}");
  });

  it("does not strip the outgoing fade when the ink gate opens", () => {
    // The attribute is set before the old view-transition snapshot is
    // captured; animation:none there would resurrect a half-dissolved photo
    // at full opacity inside that snapshot.
    expect(sceneryCssSource).not.toContain(
      "html[data-scenery-ink-transition] .scenery-layer__photo--outgoing",
    );
  });
});
