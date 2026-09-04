import { describe, expect, it } from "vite-plus/test";

import {
  buildToolCallDisplaySections,
  detectStructuredTextLanguage,
  formatChangedFileDiffText,
  leftoverChangedFilePaths,
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
    expect(formatShellCommandForDisplay("echo hi;# ignore && echo DANGEROUS")).toBe(
      "echo hi;# ignore && echo DANGEROUS",
    );
    expect(formatShellCommandForDisplay("echo hi&&# ignore && echo DANGEROUS")).toBe(
      "echo hi&&# ignore && echo DANGEROUS",
    );
    expect(formatShellCommandForDisplay("echo one && echo two # keep this break")).toBe(
      "echo one &&\n  echo two # keep this break",
    );
    expect(formatShellCommandForDisplay("echo foo#not-a-comment && echo bar")).toBe(
      "echo foo#not-a-comment &&\n  echo bar",
    );
  });

  it("does not break case-pattern alternation pipes", () => {
    expect(formatShellCommandForDisplay("case b in a|b) echo yes;; esac")).toBe(
      "case b in a|b) echo yes;; esac",
    );
    expect(formatShellCommandForDisplay("case b in a|b) echo yes && echo no;; esac")).toBe(
      "case b in a|b) echo yes &&\n  echo no;; esac",
    );
  });

  it("does not break pipes inside ${} parameter expansions", () => {
    expect(formatShellCommandForDisplay("printf '<%s>\\n' ${x:-a|b}")).toBe(
      "printf '<%s>\\n' ${x:-a|b}",
    );
    expect(formatShellCommandForDisplay("echo ${x:-a|b} && echo done")).toBe(
      "echo ${x:-a|b} &&\n  echo done",
    );
    expect(formatShellCommandForDisplay("echo ${#name} && echo done")).toBe(
      "echo ${#name} &&\n  echo done",
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

  it("renders a compact file diff section and labels multi-file patches", () => {
    expect(formatChangedFileDiffText([{ path: "src/a.ts", diff: "-old\n+new" }])).toBe(
      "src/a.ts\n-old\n+new",
    );
    expect(
      formatChangedFileDiffText([
        { path: "src/a.ts", diff: "-old\n+new" },
        { path: "src/b.ts", diff: "+created" },
      ]),
    ).toBe("src/a.ts\n-old\n+new\n\nsrc/b.ts\n+created");

    const sections = buildToolCallDisplaySections({
      diffText: "-old\n+new",
      trailingText: "src/a.ts",
    });
    expect(sections.map((section) => section.kind)).toEqual(["diff", "text"]);
    expect(serializeToolCallDisplaySections(sections)).toBe("-old\n+new\n\nsrc/a.ts");
    expect(
      leftoverChangedFilePaths(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        [{ path: "src/a.ts", diff: "-old\n+new" }],
      ),
    ).toBe("src/b.ts\nsrc/c.ts");
  });
});
