/**
 * Rebase tripwire for the scenery CSS's structural assumptions about
 * upstream markup. scenery.css targets these selectors positionally; if a
 * nightly rebase renames a slot or wraps the thread view in a new div, the
 * photo silently disappears behind an opaque surface. This test makes that
 * failure loud instead.
 */
import { describe, expect, it } from "vite-plus/test";

import appSidebarLayoutSource from "../components/AppSidebarLayout.tsx?raw";
import chatComposerSource from "../components/chat/ChatComposer.tsx?raw";
import chatViewSource from "../components/ChatView.tsx?raw";
import sidebarSource from "../components/ui/sidebar.tsx?raw";
import useThemeSource from "../hooks/useTheme.ts?raw";
import rootRouteSource from "../routes/__root.tsx?raw";
import serverThreadRouteSource from "../routes/_chat.$environmentId.$threadId.tsx?raw";
import draftThreadRouteSource from "../routes/_chat.draft.$draftId.tsx?raw";

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

  it("the composer still ingests OS-style Files drops on its drag wrapper", () => {
    expect(chatComposerSource).toContain("onDrop={onComposerDrop}");
    expect(chatComposerSource).toContain('event.dataTransfer.types.includes("Files")');
    expect(chatComposerSource).toContain("void addComposerImages(files)");
  });

  it("the mention drop channel the text-file insert rides still exists", () => {
    expect(chatComposerSource).toContain("onDropCapture={composerMentionDragHandlers.onDrop}");
  });
});

describe("ink override contract with upstream appearance handling", () => {
  it("useTheme still memoizes applies, so the override survives re-renders", () => {
    expect(useThemeSource).toContain("lastAppliedTheme?.theme === theme");
  });

  it("useTheme still expresses appearance as the html dark class", () => {
    expect(useThemeSource).toContain('classList.toggle("dark", isDark)');
  });
});
