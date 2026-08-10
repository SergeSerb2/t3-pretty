/**
 * Toolbar commands for the markdown editor. All operate on the current
 * selection (or cursor word/line), keep the document as plain markdown
 * source, and restore a sensible selection afterwards.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

function toggleInlineMark(view: EditorView, mark: string): boolean {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const before = view.state.sliceDoc(Math.max(0, range.from - mark.length), range.from);
    const after = view.state.sliceDoc(range.to, range.to + mark.length);

    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - mark.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + mark.length, insert: "" },
        ],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    if (
      selected.startsWith(mark) &&
      selected.endsWith(mark) &&
      selected.length >= mark.length * 2
    ) {
      return {
        changes: {
          from: range.from,
          to: range.to,
          insert: selected.slice(mark.length, -mark.length),
        },
        range: EditorSelection.range(range.from, range.to - mark.length * 2),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    };
  });
  view.dispatch(changes, { userEvent: "input" });
  view.focus();
  return true;
}

function setLinePrefix(view: EditorView, prefix: string | ((index: number) => string)): boolean {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let position = range.from; position <= range.to; ) {
      const line = state.doc.lineAt(position);
      lines.add(line.number);
      if (line.to >= range.to) break;
      position = line.to + 1;
    }
  }
  const orderedLines = [...lines].sort((left, right) => left - right);
  const prefixFor = (index: number): string =>
    typeof prefix === "string" ? prefix : prefix(index);
  const existingPrefixPattern = /^(\s*)((?:[-*+]|\d+[.)])\s+|#{1,6}\s+|>\s+)?/;

  const allAlreadyPrefixed = orderedLines.every((lineNumber, index) => {
    const line = state.doc.line(lineNumber);
    return line.text.trimStart().startsWith(prefixFor(index).trimStart());
  });

  const changes = orderedLines.map((lineNumber, index) => {
    const line = state.doc.line(lineNumber);
    const match = existingPrefixPattern.exec(line.text);
    const leadLength = match === null ? 0 : match[0].length;
    const replacement = allAlreadyPrefixed
      ? (match?.[1] ?? "")
      : (match?.[1] ?? "") + prefixFor(index).trimStart();
    return { from: line.from, to: line.from + leadLength, insert: replacement };
  });
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
  return true;
}

export const markdownEditorActions = {
  bold: (view: EditorView) => toggleInlineMark(view, "**"),
  italic: (view: EditorView) => toggleInlineMark(view, "*"),
  strikethrough: (view: EditorView) => toggleInlineMark(view, "~~"),
  inlineCode: (view: EditorView) => toggleInlineMark(view, "`"),
  heading: (level: 1 | 2 | 3) => (view: EditorView) => setLinePrefix(view, `${"#".repeat(level)} `),
  bulletList: (view: EditorView) => setLinePrefix(view, "- "),
  numberedList: (view: EditorView) => setLinePrefix(view, (index) => `${index + 1}. `),
  quote: (view: EditorView) => setLinePrefix(view, "> "),
  link: (view: EditorView): boolean => {
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    const label = selected.length > 0 ? selected : "link text";
    const insert = `[${label}](url)`;
    const urlStart = range.from + label.length + 3;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.range(urlStart, urlStart + 3),
      userEvent: "input",
    });
    view.focus();
    return true;
  },
} as const;
