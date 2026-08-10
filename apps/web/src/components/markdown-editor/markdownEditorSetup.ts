/**
 * CodeMirror 6 configuration for the live markdown editor: an
 * Obsidian-style hybrid where the document keeps its exact source text but
 * headings, emphasis, code, and links render styled inline, with the
 * formatting marks dimmed. Colors come from the app's semantic CSS variables
 * so every theme (and the scenery ink flips) restyles the editor for free.
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "0.9rem",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.7",
    padding: "16px 18px 28px",
    caretColor: "var(--primary)",
  },
  ".cm-line": {
    padding: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
    borderLeftWidth: "2px",
    borderRadius: "1px",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    {
      backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)",
    },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--accent) 36%, transparent)",
    borderRadius: "4px",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
});

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading1,
    fontSize: "1.5em",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    lineHeight: "1.3",
  },
  {
    tag: tags.heading2,
    fontSize: "1.3em",
    fontWeight: "700",
    letterSpacing: "-0.015em",
    lineHeight: "1.3",
  },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "650", lineHeight: "1.35" },
  { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600" },
  { tag: tags.heading5, fontSize: "1em", fontWeight: "600" },
  { tag: tags.heading6, fontSize: "1em", fontWeight: "600", color: "var(--muted-foreground)" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--muted-foreground)" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    backgroundColor: "color-mix(in oklab, var(--accent) 72%, transparent)",
    borderRadius: "4px",
  },
  { tag: tags.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--primary)" },
  { tag: tags.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.contentSeparator, color: "var(--border)", fontWeight: "700" },
  // Formatting marks (#, **, `, >, list bullets): keep them visible but
  // recede so the written words carry the visual weight.
  { tag: tags.processingInstruction, color: "var(--muted-foreground)", opacity: "0.62" },
  { tag: tags.meta, color: "var(--muted-foreground)", opacity: "0.62" },
  { tag: tags.labelName, color: "var(--muted-foreground)" },
]);

export interface MarkdownEditorOptions {
  readonly initialContents: string;
  readonly placeholder?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly onChange?: ((contents: string) => void) | undefined;
  readonly onSave?: (() => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
}

export function createMarkdownEditorState(options: MarkdownEditorOptions): EditorState {
  const extensions: Array<Extension> = [
    history(),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(markdownHighlightStyle),
    editorTheme,
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          options.onSave?.();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.contentAttributes.of({
      "aria-label": options.ariaLabel ?? "Markdown editor",
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onChange?.(update.state.doc.toString());
      }
      if (update.focusChanged && !update.view.hasFocus) {
        options.onBlur?.();
      }
    }),
  ];
  if (options.placeholder !== undefined && options.placeholder.length > 0) {
    extensions.push(placeholderExtension(options.placeholder));
  }
  if (options.readOnly === true) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  }
  return EditorState.create({ doc: options.initialContents, extensions });
}
