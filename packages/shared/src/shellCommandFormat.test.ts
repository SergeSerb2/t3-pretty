import { describe, expect, it } from "vite-plus/test";

import {
  buildToolCallDisplaySections,
  detectStructuredTextLanguage,
  formatShellCommandForDisplay,
  serializeToolCallDisplaySections,
  toolCallDisplayAddsStructure,
} from "./shellCommandFormat.ts";

describe("formatShellCommandForDisplay", () => {
  it("leaves simple and already-multiline commands alone", () => {
    expect(formatShellCommandForDisplay("  bun test  ")).toBe("bun test");
    expect(formatShellCommandForDisplay("echo one\necho two")).toBe("echo one\necho two");
  });

  it("breaks top-level &&, ||, |, and |& chains", () => {
    expect(formatShellCommandForDisplay("echo one && echo two || echo three")).toBe(
      "echo one &&\n  echo two ||\n  echo three",
    );
    expect(formatShellCommandForDisplay("cat file | grep foo | jq .")).toBe(
      "cat file |\n  grep foo |\n  jq .",
    );
    expect(formatShellCommandForDisplay("left |& right")).toBe("left |&\n  right");
    expect(formatShellCommandForDisplay("echo foo&&echo bar")).toBe("echo foo&&\n  echo bar");
  });

  it("does not break operators inside quotes, $(), backticks, subshells, or [[ ]]", () => {
    expect(formatShellCommandForDisplay(`echo "a && b" && echo done`)).toBe(
      `echo "a && b" &&\n  echo done`,
    );
    expect(formatShellCommandForDisplay("echo 'a && b' && echo done")).toBe(
      "echo 'a && b' &&\n  echo done",
    );
    expect(formatShellCommandForDisplay("echo $(foo && bar) && echo done")).toBe(
      "echo $(foo && bar) &&\n  echo done",
    );
    expect(formatShellCommandForDisplay("echo `foo && bar` && echo done")).toBe(
      "echo `foo && bar` &&\n  echo done",
    );
    expect(formatShellCommandForDisplay("(echo a && echo b) && echo c")).toBe(
      "(echo a && echo b) &&\n  echo c",
    );
    expect(formatShellCommandForDisplay('[[ -f "$f" && -n "$x" ]] && echo yes')).toBe(
      '[[ -f "$f" && -n "$x" ]] &&\n  echo yes',
    );
  });

  it("leaves heredocs and unmatched quotes untouched", () => {
    expect(formatShellCommandForDisplay("cat <<EOF && echo done")).toBe("cat <<EOF && echo done");
    expect(formatShellCommandForDisplay(`echo "oops && echo still`)).toBe(
      `echo "oops && echo still`,
    );
  });

  it("does not treat a trailing background & or a comment as a chain", () => {
    expect(formatShellCommandForDisplay("sleep 1 &")).toBe("sleep 1 &");
    expect(formatShellCommandForDisplay("echo hi # note && not a command")).toBe(
      "echo hi # note && not a command",
    );
  });

  it("formats the long one-liner from agent bash cards", () => {
    const formatted = formatShellCommandForDisplay(
      `echo "===== ISSUE 198 =====" && gh issue view 198 --repo SergeSerb2/t3-pretty && echo && echo "===== ISSUE 169 =====" && gh issue view 169 --repo SergeSerb2/t3-pretty`,
    );
    expect(formatted).toBe(
      [
        `echo "===== ISSUE 198 =====" &&`,
        `  gh issue view 198 --repo SergeSerb2/t3-pretty &&`,
        `  echo &&`,
        `  echo "===== ISSUE 169 =====" &&`,
        `  gh issue view 169 --repo SergeSerb2/t3-pretty`,
      ].join("\n"),
    );
  });
});

describe("tool call display sections", () => {
  it("detects JSON output and ignores key-value text", () => {
    expect(detectStructuredTextLanguage(`{"state":"OPEN"}`)).toBe("json");
    expect(detectStructuredTextLanguage("title: Upstream sync blocked")).toBe("text");
  });

  it("separates command from output and pretty-breaks the command", () => {
    const sections = buildToolCallDisplaySections({
      command: "echo one && echo two",
      output: "one\ntwo",
    });
    expect(sections).toEqual([
      {
        kind: "command",
        original: "echo one && echo two",
        display: "echo one &&\n  echo two",
      },
      { kind: "text", text: "one\ntwo" },
    ]);
    expect(toolCallDisplayAddsStructure(sections)).toBe(true);
    expect(serializeToolCallDisplaySections(sections)).toBe("echo one &&\n  echo two\n\none\ntwo");
  });

  it("dedupes a detail that only repeats the command and highlights JSON output", () => {
    const repeated = buildToolCallDisplaySections({
      command: "gh issue view 1 --json title",
      output: "gh issue view 1 --json title",
    });
    expect(repeated.map((section) => section.kind)).toEqual(["command"]);

    const withJson = buildToolCallDisplaySections({
      command: "gh issue view 1 --json title",
      output: `{"title":"Blocked"}`,
    });
    expect(withJson.map((section) => section.kind)).toEqual(["command", "json"]);
    expect(withJson[1]).toEqual({ kind: "json", text: `{"title":"Blocked"}` });
  });
});
