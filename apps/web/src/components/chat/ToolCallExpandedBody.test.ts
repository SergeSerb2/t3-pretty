import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkEntryDisplaySections,
  resolveToolCallCommand,
  workEntryDisplayAddsStructure,
  workEntryDisplayBody,
} from "./toolCallPresentation";

describe("tool call expanded body", () => {
  it("prefers a distinct raw wrapper and pretty-breaks the displayed command", () => {
    expect(
      resolveToolCallCommand({
        command: "bun test",
        rawCommand: "/bin/zsh -lc 'bun test'",
      }),
    ).toBe("/bin/zsh -lc 'bun test'");
    expect(resolveToolCallCommand({ command: "bun test", rawCommand: "bun test" })).toBe(
      "bun test",
    );

    const sections = buildWorkEntryDisplaySections({
      command: `echo "===== ISSUE 198 =====" && gh issue view 198`,
      output: "title: Upstream sync blocked\nstate: OPEN",
    });
    expect(workEntryDisplayAddsStructure(sections)).toBe(true);
    expect(workEntryDisplayBody(sections)).toBe(
      `echo "===== ISSUE 198 =====" &&\n  gh issue view 198\n\ntitle: Upstream sync blocked\nstate: OPEN`,
    );
    expect(sections.map((section) => section.kind)).toEqual(["command", "text"]);
  });

  it("highlights JSON tool output and keeps MCP payload as leading text", () => {
    const sections = buildWorkEntryDisplaySections({
      itemType: "mcp_tool_call",
      toolData: { query: "work log" },
      output: `{"ok":true}`,
    });
    expect(sections[0]).toMatchObject({
      kind: "text",
      text: 'MCP call\n{\n  "query": "work log"\n}',
    });
    expect(sections[1]).toEqual({ kind: "json", text: `{"ok":true}` });
  });

  it("prefers a compact file diff over repeating the changed path", () => {
    const sections = buildWorkEntryDisplaySections({
      output: "src/a.ts",
      changedFilesText: "src/a.ts",
      changedFileDiffs: [{ path: "src/a.ts", kind: "update", diff: "-old\n+new" }],
    });
    expect(sections).toEqual([{ kind: "diff", text: "-old\n+new" }]);
    expect(workEntryDisplayBody(sections)).toBe("-old\n+new");

    const withSiblings = buildWorkEntryDisplaySections({
      changedFilesText: "src/a.ts\nsrc/b.ts",
      changedFileDiffs: [{ path: "src/a.ts", kind: "update", diff: "-old\n+new" }],
    });
    expect(withSiblings).toEqual([
      { kind: "diff", text: "-old\n+new" },
      { kind: "text", text: "src/b.ts" },
    ]);
  });
});
