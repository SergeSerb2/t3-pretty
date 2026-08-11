import type { CanvasImageSourceRef, CanvasNode } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const CANVAS_SELECTION_IMAGE_PREFIX = "canvas-selection-";

export function canvasSelectionImageName(selectionId: string): string {
  return `${CANVAS_SELECTION_IMAGE_PREFIX}${selectionId}.png`;
}

/**
 * Compact per-node description carried by a canvas selection. `source` is the
 * humanized capture origin of image nodes (see `humanizeCanvasImageSource`);
 * the full node payload stays on the canvas document, reachable through
 * `canvas_get_state`.
 */
export const CanvasSelectionNodeSummarySchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  name: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
});

export interface CanvasSelectionNodeSummary {
  readonly id: string;
  readonly type: string;
  readonly name?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly source?: string | undefined;
}

/**
 * A "canvas selection" attached to the composer: a set of selected canvas
 * nodes (plus an optional user comment) pinned to the document revision the
 * selection was made against. Persisted inline with the composer draft; the
 * rendered crop travels separately as an image attachment whose id matches
 * the selection id.
 */
export const CanvasSelectionContextSchema = Schema.Struct({
  id: Schema.String,
  docRevision: Schema.Number,
  comment: Schema.optional(Schema.String),
  nodes: Schema.Array(CanvasSelectionNodeSummarySchema),
});

export interface CanvasSelectionContext {
  readonly id: string;
  readonly docRevision: number;
  readonly comment?: string | undefined;
  readonly nodes: ReadonlyArray<CanvasSelectionNodeSummary>;
}

export interface ParsedCanvasSelection {
  id: string;
  docRevision: number;
  comment: string;
  nodeCount: number;
  nodes: CanvasSelectionNodeSummary[];
}

export interface ExtractedCanvasSelection {
  text: string;
  selection: ParsedCanvasSelection;
}

const TRAILING_CANVAS_SELECTION_BLOCK_PATTERN =
  /\n*<canvas_selection>\n((?:(?!<canvas_selection>)[\s\S])*)\n<\/canvas_selection>\s*$/;

const CANVAS_SELECTION_NODE_LINE_PATTERN =
  /^- (\S+)(?: "(.*)")? \(([^,()]+)(?:, (\d+)x(\d+))?\)(?: — source: (.*))?$/;

export function humanizeCanvasImageSource(sourceRef: CanvasImageSourceRef): string {
  switch (sourceRef.kind) {
    case "preview-tab": {
      const url = sourceRef.url?.trim();
      return url ? `preview tab ${url}` : "preview tab";
    }
    case "window": {
      const appName = sourceRef.appName?.trim();
      const windowTitle = sourceRef.windowTitle?.trim();
      return ["window", appName, windowTitle ? `"${windowTitle}"` : null]
        .filter((part) => part)
        .join(" ");
    }
    case "agent":
      return "agent";
  }
}

/**
 * Project a full canvas node down to the summary carried by a selection.
 * Size is included only for node types that carry both dimensions; note
 * nodes (auto-height) and ink strokes summarize without one.
 */
export function canvasSelectionNodeSummary(node: CanvasNode): CanvasSelectionNodeSummary {
  const name = node.name?.trim();
  return {
    id: node.id,
    type: node.type,
    ...(name ? { name } : {}),
    ...("width" in node && node.width !== undefined && "height" in node
      ? { width: node.width, height: node.height }
      : {}),
    ...(node.type === "image" && node.sourceRef
      ? { source: humanizeCanvasImageSource(node.sourceRef) }
      : {}),
  };
}

function formatCanvasSelectionNodeLine(node: CanvasSelectionNodeSummary): string {
  const size =
    node.width !== undefined && node.height !== undefined
      ? `, ${Math.round(node.width)}x${Math.round(node.height)}`
      : "";
  return [
    `- ${node.type}`,
    node.name ? ` "${node.name}"` : "",
    ` (${node.id}${size})`,
    node.source ? ` — source: ${node.source}` : "",
  ].join("");
}

export function buildCanvasSelectionPrompt(selection: CanvasSelectionContext): string {
  const lines = ["Canvas selection:"];
  lines.push(`Id: ${selection.id}`);
  lines.push(`Doc revision: ${selection.docRevision}`);
  const comment = selection.comment?.trim();
  if (comment) lines.push(`Comment: ${comment}`);
  lines.push(`Nodes: ${selection.nodes.length} selected`);
  for (const node of selection.nodes) {
    lines.push(formatCanvasSelectionNodeLine(node));
  }
  lines.push(
    `The attached screenshot titled ${canvasSelectionImageName(selection.id)} is a rendering of the selected canvas region. Use canvas_get_state for full structure.`,
  );
  return ["<canvas_selection>", ...lines, "</canvas_selection>"].join("\n");
}

export function appendCanvasSelectionPrompt(
  prompt: string,
  selection: CanvasSelectionContext,
): string {
  const selectionText = buildCanvasSelectionPrompt(selection);
  const trimmed = prompt.trim();
  return trimmed ? `${trimmed}\n\n${selectionText}` : selectionText;
}

function parseCanvasSelectionNodeLine(line: string): CanvasSelectionNodeSummary | null {
  const match = CANVAS_SELECTION_NODE_LINE_PATTERN.exec(line);
  if (!match) return null;
  const [, type, name, id, width, height, source] = match;
  if (!type || !id) return null;
  return {
    id,
    type,
    ...(name !== undefined ? { name } : {}),
    ...(width !== undefined && height !== undefined
      ? { width: Number(width), height: Number(height) }
      : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

/**
 * Pull one trailing `<canvas_selection>` block off a sent prompt for display.
 * Call repeatedly (like `extractTrailingPreviewAnnotation`) to unwind several
 * sequentially appended selections; returns null once the text no longer ends
 * with a block.
 */
export function extractTrailingCanvasSelection(prompt: string): ExtractedCanvasSelection | null {
  const match = TRAILING_CANVAS_SELECTION_BLOCK_PATTERN.exec(prompt);
  if (!match) return null;
  const body = match[1] ?? "";
  const lines = body.split("\n");
  const idLine = lines.find((line) => line.startsWith("Id: "));
  const revisionLine = lines.find((line) => line.startsWith("Doc revision: "));
  const commentLine = lines.find((line) => line.startsWith("Comment: "));
  const nodesLine = lines.find((line) => line.startsWith("Nodes: "));
  const nodeCountMatch = /^Nodes: (\d+) selected$/.exec(nodesLine ?? "");
  const nodes = lines.flatMap((line) => {
    const node = parseCanvasSelectionNodeLine(line);
    return node ? [node] : [];
  });
  const parsedRevision = Number(revisionLine?.slice("Doc revision: ".length).trim());
  return {
    text: prompt.slice(0, match.index).replace(/\n+$/, ""),
    selection: {
      id: idLine?.slice("Id: ".length).trim() || `${match.index}`,
      docRevision: Number.isFinite(parsedRevision) ? parsedRevision : 0,
      comment: commentLine?.slice("Comment: ".length).trim() || "",
      nodeCount: nodeCountMatch ? Number(nodeCountMatch[1]) : nodes.length,
      nodes,
    },
  };
}
