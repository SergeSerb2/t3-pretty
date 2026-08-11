"use client";

import type { CanvasNoteNode } from "@t3tools/contracts";
import { use, useEffect, useRef } from "react";

import { CanvasMeasuredSizesContext } from "../canvasMeasuredSizes";

/**
 * Sticky note. Width comes from the document (or the default); height follows
 * the text, so the rendered layout size is reported into the measured-sizes
 * store for hit-testing and selection accuracy. Double-clicking (handled by
 * the viewport) swaps the body for an autosizing textarea.
 */
export function CanvasNoteNodeView(props: {
  node: CanvasNoteNode;
  width: number;
  editing: boolean;
  onEditCommit: (nodeId: string, text: string) => void;
  onEditCancel: (nodeId: string) => void;
}) {
  const { node } = props;
  const sizes = use(CanvasMeasuredSizesContext);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null || sizes === null) return;
    // offsetWidth/offsetHeight are unscaled layout px, i.e. world units.
    const report = () =>
      sizes.report(node.id, { width: element.offsetWidth, height: element.offsetHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      sizes.clear(node.id);
    };
  }, [sizes, node.id]);

  return (
    <div
      ref={rootRef}
      className="absolute top-0 left-0 min-h-10 rounded-md bg-amber-100 p-2 text-amber-950 text-sm leading-snug shadow-sm ring-1 ring-black/5 dark:bg-amber-200/15 dark:text-amber-100 dark:ring-white/10"
      style={{
        width: props.width,
        ...(node.color !== undefined && node.color !== "" ? { backgroundColor: node.color } : {}),
      }}
    >
      {props.editing ? (
        <CanvasNoteEditor
          nodeId={node.id}
          initialText={node.text}
          onCommit={props.onEditCommit}
          onCancel={props.onEditCancel}
        />
      ) : node.text !== "" ? (
        <div className="whitespace-pre-wrap break-words">{node.text}</div>
      ) : (
        <div className="select-none opacity-40">Empty note</div>
      )}
    </div>
  );
}

function CanvasNoteEditor(props: {
  nodeId: string;
  initialText: string;
  onCommit: (nodeId: string, text: string) => void;
  onCancel: (nodeId: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Blur after Escape (the editor unmounts) must not double-fire a commit.
  const settledRef = useRef(false);

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  const autosize = (element: HTMLTextAreaElement): void => {
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  };
  const settle = (action: () => void): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    action();
  };

  return (
    <textarea
      ref={textareaRef}
      defaultValue={props.initialText}
      rows={1}
      placeholder="Type a note"
      className="pointer-events-auto block w-full resize-none overflow-hidden bg-transparent text-inherit leading-snug outline-none placeholder:text-current placeholder:opacity-40"
      onInput={(event) => autosize(event.currentTarget)}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const text = event.currentTarget.value;
        settle(() => props.onCommit(props.nodeId, text));
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          settle(() => props.onCancel(props.nodeId));
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const text = event.currentTarget.value;
          settle(() => props.onCommit(props.nodeId, text));
        }
      }}
    />
  );
}
