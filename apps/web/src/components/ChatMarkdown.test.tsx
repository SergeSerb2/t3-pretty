import { describe, expect, it } from "vite-plus/test";

import { extractMarkdownFileLinkCandidates, orderedListGutterStyle } from "./ChatMarkdown";
import chatMarkdownSource from "./ChatMarkdown.tsx?raw";

describe("orderedListGutterStyle", () => {
  it("leaves the default gutter alone for single-digit lists", () => {
    expect(orderedListGutterStyle(9, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for two-digit lists", () => {
    expect(orderedListGutterStyle(99, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for a two-digit list that starts above 1", () => {
    // start=50 + 49 items => last marker is "98", still two digits.
    expect(orderedListGutterStyle(49, 50)).toBeUndefined();
  });

  it("widens the gutter once the last marker reaches three digits", () => {
    // item 100 is the bug from #6512: a 100-item list starting at 1.
    expect(orderedListGutterStyle(100, undefined)).toEqual({ "--list-gutter": "4ch" });
  });

  it("accounts for a non-default start attribute", () => {
    // start=95 + 9 items => last marker is "103", three digits.
    expect(orderedListGutterStyle(9, 95)).toEqual({ "--list-gutter": "4ch" });
  });

  it("scales further for four-digit markers", () => {
    expect(orderedListGutterStyle(1000, undefined)).toEqual({ "--list-gutter": "5ch" });
  });

  it("treats a missing/zero item count as a single item", () => {
    expect(orderedListGutterStyle(0, undefined)).toBeUndefined();
  });
});

describe("extractMarkdownFileLinkCandidates", () => {
  it("collects mixed candidates in one pass without linking fenced inline code", () => {
    const candidates = extractMarkdownFileLinkCandidates(
      [
        "[doc](/outside.md) and `src/a.ts:1`",
        "[`src/in-label.ts`](./target.md)",
        "`[nested](./nested.md)`",
        "```md",
        "[fenced](./fenced.md) and `ignored.ts`",
        "```",
      ].join("\n"),
    );

    expect(candidates).toEqual({
      hrefs: ["/outside.md", "./target.md", "./nested.md", "./fenced.md"],
      inlineCodeSpans: ["src/a.ts:1", "src/in-label.ts", "[nested](./nested.md)"],
    });
  });

  it("treats an unclosed fence as fenced through the end", () => {
    expect(
      extractMarkdownFileLinkCandidates(
        "`src/before.ts`\n```md\n[fenced](./inside.md) and `ignored.ts`",
      ),
    ).toEqual({
      hrefs: ["./inside.md"],
      inlineCodeSpans: ["src/before.ts"],
    });
  });
});

describe("streaming markdown stability", () => {
  it("reads per-delta text and link maps through refs", () => {
    expect(chatMarkdownSource).toContain("renderedTextRef.current");
    expect(chatMarkdownSource).toContain("markdownFileLinkMetaByHrefRef.current");
    expect(chatMarkdownSource).toContain("inlineCodeFileLinkMetaByTextRef.current");
    expect(chatMarkdownSource).toContain("fileLinkParentSuffixByPathRef.current");
  });

  it("caches negative inline-code file-link resolutions", () => {
    expect(chatMarkdownSource).toContain(
      "metaByText.set(span, resolveInlineCodeFileLinkMeta(span, cwd))",
    );
    expect(chatMarkdownSource).not.toContain(
      "inlineCodeFileLinkMetaByTextRef.current.get(codeText.trim()) ??",
    );
  });

  it("renders fenced code as plain text while streaming", () => {
    expect(chatMarkdownSource).toContain("isStreaming ?");
    expect(chatMarkdownSource).toContain("<code className={codeBlock.className}");
    expect(chatMarkdownSource).not.toContain("isStreaming={isStreaming}");
  });

  it("highlights settled fences with the painted appearance, not the stored preference", () => {
    expect(chatMarkdownSource).toContain("usePaintedAppearance");
    expect(chatMarkdownSource).toContain("resolveDiffThemeName(resolvedTheme)");
  });
});
