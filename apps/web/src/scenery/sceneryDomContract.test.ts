/**
 * Rebase tripwire for the scenery CSS's structural assumptions about
 * upstream markup. scenery.css targets these selectors positionally; if a
 * nightly rebase renames a slot or wraps the thread view in a new div, the
 * photo silently disappears behind an opaque surface. This test makes that
 * failure loud instead.
 */
import { describe, expect, it } from "vite-plus/test";

import appSidebarLayoutSource from "../components/AppSidebarLayout.tsx?raw";
import chatViewSource from "../components/ChatView.tsx?raw";
import sidebarSource from "../components/ui/sidebar.tsx?raw";
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
