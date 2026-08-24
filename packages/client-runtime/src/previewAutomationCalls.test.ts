import { describe, expect, it } from "vite-plus/test";

import { humanizePreviewTarget, summarizePreviewAutomationCall } from "./previewAutomationCalls.ts";

describe("summarizePreviewAutomationCall", () => {
  it("labels Codex-shaped item calls", () => {
    expect(
      summarizePreviewAutomationCall({
        data: {
          item: {
            tool: "preview_click",
            server: "t3-code",
            arguments: { locator: "role=button[name='Send']" },
          },
        },
      }),
    ).toEqual({ operation: "click", label: "Clicked “Send”" });
  });

  it("labels Claude-shaped toolName calls with normalized arguments", () => {
    expect(
      summarizePreviewAutomationCall({
        data: {
          toolName: "mcp__t3-code__preview_navigate",
          arguments: { url: "https://localhost:5173/settings" },
        },
      }),
    ).toEqual({ operation: "navigate", label: "Opened localhost:5173/settings" });
  });

  it("falls back to a generic label from an ACP title without arguments", () => {
    expect(summarizePreviewAutomationCall({ title: "preview_click" })).toEqual({
      operation: "click",
      label: "Clicked in the browser",
    });
  });

  it("returns null for non-preview tools", () => {
    expect(
      summarizePreviewAutomationCall({
        data: { item: { tool: "fetch_pr", server: "github", arguments: { pr: 42 } } },
      }),
    ).toBeNull();
    expect(summarizePreviewAutomationCall({ title: "Read File" })).toBeNull();
  });

  it("labels coordinate clicks, typing, keys, and scrolls", () => {
    const call = (tool: string, args: Record<string, unknown>) =>
      summarizePreviewAutomationCall({ data: { item: { tool, arguments: args } } })?.label;
    expect(call("preview_click", { x: 12.4, y: 80.6 })).toBe("Clicked at (12, 81)");
    expect(call("preview_type", { text: "hello" })).toBe("Typed “hello”");
    expect(call("preview_type", { text: "x".repeat(60) })).toBe(`Typed “${"x".repeat(39)}…”`);
    expect(call("preview_type", { text: "", clear: true })).toBe("Cleared a text field");
    expect(call("preview_press", { key: "Enter", modifiers: ["Meta", "Shift"] })).toBe(
      "Pressed Cmd+Shift+Enter",
    );
    expect(call("preview_scroll", { deltaY: 400 })).toBe("Scrolled down");
    expect(call("preview_scroll", { deltaX: -120 })).toBe("Scrolled left");
    expect(call("preview_wait_for", { text: "Saved" })).toBe("Waited for “Saved”");
    expect(
      call("preview_navigate", { target: { kind: "environment-port", port: 5173, path: "/x" } }),
    ).toBe("Opened localhost:5173/x");
    expect(call("preview_resize", { mode: "freeform", width: 1280, height: 800 })).toBe(
      "Resized to 1280×800",
    );
    expect(call("preview_set_appearance", { colorScheme: "dark" })).toBe(
      "Switched the page to dark mode",
    );
  });
});

describe("humanizePreviewTarget", () => {
  it("extracts accessible names, text locators, and clips raw selectors", () => {
    expect(humanizePreviewTarget("role=button[name='Send']")).toBe("Send");
    expect(humanizePreviewTarget('role=textbox[name="Message input"]')).toBe("Message input");
    expect(humanizePreviewTarget("text=Continue")).toBe("Continue");
    expect(humanizePreviewTarget("button[type='submit']")).toBe("button[type='submit']");
    expect(humanizePreviewTarget(`div${".x".repeat(40)}`)).toHaveLength(40);
  });
});
