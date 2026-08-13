import { describe, expect, it } from "vite-plus/test";

import {
  markdownLinkActionItems,
  markdownLinkActionTitle,
  markdownLinkCopyValue,
} from "./markdownLinkActions";

describe("markdownLinkActionItems", () => {
  it("offers Open, Copy Link, and Share for http(s) links", () => {
    expect(markdownLinkActionItems("https://example.com/docs?q=1")).toEqual([
      { id: "open", label: "Open" },
      { id: "copy", label: "Copy Link" },
      { id: "share", label: "Share" },
    ]);
  });

  it("offers Open and Copy Path for file links", () => {
    expect(markdownLinkActionItems("apps/mobile/src/index.ts:10")).toEqual([
      { id: "open", label: "Open" },
      { id: "copy", label: "Copy Path" },
    ]);
  });

  it("does not offer Share for mailto or app routes", () => {
    expect(markdownLinkActionItems("mailto:hello@example.com")).toEqual([
      { id: "open", label: "Open" },
      { id: "copy", label: "Copy Link" },
    ]);
    expect(markdownLinkActionItems("/chat/settings")).toEqual([
      { id: "open", label: "Open" },
      { id: "copy", label: "Copy Link" },
    ]);
  });
});

describe("markdownLinkCopyValue", () => {
  it("copies the exact destination for web links", () => {
    expect(markdownLinkCopyValue("https://example.com/docs?q=1#copy")).toBe(
      "https://example.com/docs?q=1#copy",
    );
  });

  it("copies the workspace path for file links, not the display label", () => {
    expect(markdownLinkCopyValue("apps/mobile/src/index.ts:10")).toBe("apps/mobile/src/index.ts");
    expect(markdownLinkCopyValue("file:///Users/julius/project/src/main.ts#L42C7")).toBe(
      "/Users/julius/project/src/main.ts",
    );
  });
});

describe("markdownLinkActionTitle", () => {
  it("uses the host for external links and the file label for paths", () => {
    expect(markdownLinkActionTitle("https://example.com/docs")).toBe("example.com");
    expect(markdownLinkActionTitle("apps/mobile/src/index.ts:10")).toBe("index.ts:10");
    expect(markdownLinkActionTitle("mailto:hello@example.com")).toBeNull();
  });
});
