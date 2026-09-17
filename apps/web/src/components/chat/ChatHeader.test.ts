// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { resolveRenameCommit } from "./ChatHeader";

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});

describe("header layout-control reserve", () => {
  it("animates the layout-control reserve with the right panel slide", () => {
    const source = NodeFS.readFileSync(new URL("./ChatHeader.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("data-chat-header-actions");
    expect(source).not.toContain("ProjectScriptsControl");
    expect(source).not.toContain("OpenInPicker");
    expect(source).not.toContain("GitActionsControl");
    expect(source).toContain("transition-[padding-right]");
    expect(source).toContain("duration-200");
    expect(source).toContain("ease-linear");
    expect(source).toContain('rightPanelOpen ? "pr-0" : "pr-16"');
  });
});
