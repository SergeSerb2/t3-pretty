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
import sidebarSource from "../components/ui/sidebar.tsx?raw";
import useThemeSource from "../hooks/useTheme.ts?raw";
import rootRouteSource from "../routes/__root.tsx?raw";
import serverThreadRouteSource from "../routes/_chat.$environmentId.$threadId.tsx?raw";
import draftThreadRouteSource from "../routes/_chat.draft.$draftId.tsx?raw";
import sceneryLayerSource from "./SceneryLayer.tsx?raw";
import sceneryQuickSettingsSource from "./SceneryQuickSettings.tsx?raw";
import activeScenerySource from "./ActiveScenery.tsx?raw";
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
    expect(chatComposerSource).toContain("onDrop={onComposerDrop}");
    expect(chatComposerSource).toContain('event.dataTransfer.types.includes("Files")');
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
});

describe("scenery attribution contract", () => {
  it("keeps long photographer credits shrinkable inside the compact dock", () => {
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
  });

  it("keeps Unsplash attribution while clearing right-panel actions", () => {
    expect(sceneryCssSource).toContain(
      'html:has([data-right-panel-open="true"]) .scenery-quick__trigger',
    );
    // Dialog/backdrop dismiss in SceneryQuickSettings when the panel opens;
    // do not rely on CSS display:none for those nodes alone.
    expect(sceneryCssSource).not.toContain(
      'html:has([data-right-panel-open="true"]) .scenery-quick__panel',
    );
    expect(sceneryCssSource).not.toContain(
      'html:has([data-right-panel-open="true"]) .scenery-quick__backdrop',
    );
    expect(sceneryQuickSettingsSource).toContain("rightPanelOpen");
    expect(sceneryQuickSettingsSource).toContain("dialogOpen");
    expect(sceneryQuickSettingsSource).toContain("setOpen(false)");
    expect(sceneryCssSource).toMatch(
      /html:has\(\[data-right-panel-open="true"\]\) \.scenery-attribution\s*\{[^}]*left:/s,
    );
    // Ordinary open panels must not blanket-hide the required credit pill.
    expect(sceneryCssSource).not.toMatch(
      /html:has\(\[data-right-panel-open="true"\]\) \.scenery-attribution,\s*\n\s*html:has\(\[data-right-panel-open="true"\]\) \.scenery-quick__trigger/s,
    );
  });
});

describe("ink override contract with upstream appearance handling", () => {
  it("useTheme still memoizes applies, so the override survives re-renders", () => {
    expect(useThemeSource).toContain("lastAppliedTheme?.theme === theme");
  });

  it("useTheme still expresses appearance as the html dark class", () => {
    expect(useThemeSource).toContain('classList.toggle("dark", isDark)');
  });

  it("applies ink in layout so a photo view transition captures the new palette", () => {
    expect(useInkOverrideSource).toContain("useLayoutEffect");
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
});
