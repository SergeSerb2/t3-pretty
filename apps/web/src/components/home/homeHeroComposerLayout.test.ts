import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "../ChatView.tsx?raw";
import composerEditorSource from "../ComposerPromptEditorTiptap.tsx?raw";

describe("home hero composer layout", () => {
  it("clips the landing to the chat column and scrolls the shelves above a fixed composer", () => {
    expect(chatViewSource).toContain(
      "pointer-events-none absolute inset-0 z-20 flex min-h-0 flex-col overflow-clip",
    );
    expect(chatViewSource).toContain('data-home-hero-body="true"');
    expect(chatViewSource).toContain("min-h-0 overflow-y-auto overscroll-y-contain");
    expect(chatViewSource).toContain(
      'data-home-hero-composer={isDraftHeroState ? "true" : undefined}',
    );
    expect(chatViewSource).toContain('cn("relative", isDraftHeroState && "shrink-0")');
  });

  it("keeps the prompt scrolling inside the composer instead of growing the page", () => {
    expect(composerEditorSource).toContain("max-h-50");
    expect(composerEditorSource).toContain("overflow-y-auto");
    expect(composerEditorSource).toContain("overscroll-contain");
  });
});
