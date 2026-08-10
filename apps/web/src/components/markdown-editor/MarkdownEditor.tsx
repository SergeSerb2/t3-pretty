import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { createMarkdownEditorState } from "./markdownEditorSetup";
import "./markdownEditor.css";

export interface MarkdownEditorProps {
  /**
   * Identity of the document being edited. When it changes the editor is
   * rebuilt around `initialContents`; edits never flow back in from props, so
   * the view stays the single source of truth while typing.
   */
  readonly contentKey: string;
  readonly initialContents: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly autoFocus?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly onChange?: (contents: string) => void;
  readonly onSave?: () => void;
  readonly onBlur?: () => void;
  readonly onViewReady?: (view: EditorView | null) => void;
}

export function MarkdownEditor({
  contentKey,
  initialContents,
  placeholder,
  readOnly,
  autoFocus,
  ariaLabel,
  className,
  onChange,
  onSave,
  onBlur,
  onViewReady,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onChange, onSave, onBlur });
  callbacksRef.current = { onChange, onSave, onBlur };
  const initialContentsRef = useRef(initialContents);
  initialContentsRef.current = initialContents;
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const view = new EditorView({
      parent: container,
      state: createMarkdownEditorState({
        initialContents: initialContentsRef.current,
        placeholder,
        readOnly,
        ariaLabel,
        onChange: (contents) => callbacksRef.current.onChange?.(contents),
        onSave: () => callbacksRef.current.onSave?.(),
        onBlur: () => callbacksRef.current.onBlur?.(),
      }),
    });
    if (autoFocus === true) {
      view.focus();
    }
    onViewReadyRef.current?.(view);
    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
    };
    // Rebuild only when the document identity or static config changes;
    // callbacks are routed through refs to keep the view stable while typing.
  }, [contentKey, placeholder, readOnly, ariaLabel, autoFocus]);

  return (
    <div
      ref={containerRef}
      className={cn("t3-markdown-editor h-full min-h-0 overflow-hidden", className)}
    />
  );
}
