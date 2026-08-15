/**
 * Canvas document sync - pure client-side reducer over the shared canvas
 * document.
 *
 * `applyOps` is the single reducer used both for optimistic pending ops and
 * for authoritative server deltas, so it is idempotent and tolerant: replaying
 * an op the server already applied (or one that no longer applies) converges
 * instead of throwing. It structure-shares aggressively - untouched nodes keep
 * their identity and a no-op batch returns the same document reference -
 * because React Compiler memoization keys off references.
 *
 * No React, zustand, or DOM in this module.
 */
import type {
  CanvasDocument,
  CanvasImageNode,
  CanvasNode,
  CanvasNodePatch,
  CanvasOp,
} from "@t3tools/contracts";

import { strokeBounds } from "./components/canvas/canvasStroke";

export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Client-measured sizes for nodes whose height the document cannot describe
 * (notes size to their text). Purely an overlay; the document stays
 * authoritative for everything it does carry.
 */
export type CanvasMeasuredSizes = ReadonlyMap<string, { width: number; height: number }>;

export const CANVAS_DEFAULT_NOTE_WIDTH = 160;
export const CANVAS_DEFAULT_NOTE_HEIGHT = 100;

type CanvasNodes = readonly CanvasNode[];

const parentKeyOf = (node: CanvasNode): string | null => node.parentId ?? null;

export function getNode(doc: CanvasDocument, id: string): CanvasNode | null {
  return doc.nodes.find((node) => node.id === id) ?? null;
}

/** Direct children of a frame (or root when `parentId` is null), in z-order. */
export function childrenOf(doc: CanvasDocument, parentId: string | null): CanvasNode[] {
  return doc.nodes.filter((node) => parentKeyOf(node) === parentId);
}

/** Ids of every node in the subtree below `id`, excluding `id` itself. */
export function descendantIds(doc: CanvasDocument, id: string): string[] {
  const subtree = collectSubtreeIds(doc.nodes, id);
  subtree.delete(id);
  return doc.nodes.filter((node) => subtree.has(node.id)).map((node) => node.id);
}

/** Subtree ids including the root, or an empty set when the root is missing. */
function collectSubtreeIds(nodes: CanvasNodes, id: string): Set<string> {
  if (!nodes.some((node) => node.id === id)) return new Set();
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      const parentId = node.parentId;
      if (parentId !== undefined && ids.has(parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Node-local footprint expressed in the parent's coordinate space. */
export function localRectOf(node: CanvasNode, measuredSizes?: CanvasMeasuredSizes): CanvasRect {
  switch (node.type) {
    case "frame":
    case "image":
    case "region":
      return { x: node.x, y: node.y, width: node.width, height: node.height };
    case "ink": {
      const bounds = strokeBounds(node.points, node.strokeWidth);
      return {
        x: node.x + bounds.x,
        y: node.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }
    case "note": {
      const measured = measuredSizes?.get(node.id);
      return {
        x: node.x,
        y: node.y,
        width: node.width ?? measured?.width ?? CANVAS_DEFAULT_NOTE_WIDTH,
        height: measured?.height ?? CANVAS_DEFAULT_NOTE_HEIGHT,
      };
    }
  }
}

/** Accumulated offset of the node's parent chain, cycle- and orphan-tolerant. */
export function parentWorldOffset(doc: CanvasDocument, node: CanvasNode): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const seen = new Set([node.id]);
  let parentId = node.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = getNode(doc, parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId ?? null;
  }
  return { x, y };
}

export function worldRectOf(
  doc: CanvasDocument,
  id: string,
  measuredSizes?: CanvasMeasuredSizes,
): CanvasRect | null {
  const node = getNode(doc, id);
  if (!node) return null;
  const local = localRectOf(node, measuredSizes);
  const offset = parentWorldOffset(doc, node);
  return { x: local.x + offset.x, y: local.y + offset.y, width: local.width, height: local.height };
}

export function unionRects(a: CanvasRect | null, b: CanvasRect | null): CanvasRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Union of every node's world rect, or null for an empty document. */
export function contentBounds(
  doc: CanvasDocument,
  measuredSizes?: CanvasMeasuredSizes,
): CanvasRect | null {
  let bounds: CanvasRect | null = null;
  for (const node of doc.nodes) {
    bounds = unionRects(bounds, worldRectOf(doc, node.id, measuredSizes));
  }
  return bounds;
}

/**
 * `ids` without duplicates, unknown nodes, and nodes whose ancestor is itself
 * in `ids`, preserving input order. Move and remove interactions use this so a
 * frame and its descendants never receive the same operation twice (children
 * follow their frame through the DOM / the remove cascade).
 */
export function pruneDescendantIds(doc: CanvasDocument, ids: readonly string[]): string[] {
  const idSet = new Set(ids);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = getNode(doc, id);
    if (!node) continue;
    let ancestorSelected = false;
    const visited = new Set([id]);
    let parentId = node.parentId ?? null;
    while (parentId !== null && !visited.has(parentId)) {
      if (idSet.has(parentId)) {
        ancestorSelected = true;
        break;
      }
      visited.add(parentId);
      parentId = getNode(doc, parentId)?.parentId ?? null;
    }
    if (!ancestorSelected) result.push(id);
  }
  return result;
}

/** Compare own enumerable defined values; shared nested references count as equal. */
function shallowEqualNode(a: CanvasNode, b: CanvasNode): boolean {
  if (a === b) return true;
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(aRecord[key], bRecord[key]));
}

/**
 * Flat-array position for inserting a new child of `parentId`.
 *
 * `index` addresses the slot among the parent's current children; when it is
 * omitted or out of range the node appends after the parent's entire subtree
 * (or the array end for root nodes). Keeping subtrees contiguous this way lets
 * `invertOps` restore removed subtrees to their original flat layout.
 */
function insertionFlatIndex(
  nodes: CanvasNodes,
  parentId: string | null,
  index: number | undefined,
): number {
  const childFlatIndexes: number[] = [];
  nodes.forEach((node, flatIndex) => {
    if (parentKeyOf(node) === parentId) childFlatIndexes.push(flatIndex);
  });
  if (index !== undefined && index >= 0 && index < childFlatIndexes.length) {
    return childFlatIndexes[index]!;
  }
  if (parentId === null) return nodes.length;
  const parentFlatIndex = nodes.findIndex((node) => node.id === parentId);
  if (parentFlatIndex < 0) return nodes.length;
  const subtree = collectSubtreeIds(nodes, parentId);
  let last = parentFlatIndex;
  nodes.forEach((node, flatIndex) => {
    if (subtree.has(node.id)) last = Math.max(last, flatIndex);
  });
  return last + 1;
}

function upsertNode(nodes: CanvasNodes, node: CanvasNode, index: number | undefined): CanvasNodes {
  const existingIndex = nodes.findIndex((entry) => entry.id === node.id);
  if (existingIndex >= 0) {
    if (shallowEqualNode(nodes[existingIndex]!, node)) return nodes;
    const next = nodes.slice();
    next[existingIndex] = node;
    return next;
  }
  const next = nodes.slice();
  next.splice(insertionFlatIndex(nodes, node.parentId ?? null, index), 0, node);
  return next;
}

function applyUpdate(nodes: CanvasNodes, op: Extract<CanvasOp, { _tag: "update" }>): CanvasNodes {
  const index = nodes.findIndex((node) => node.id === op.id);
  if (index < 0) return nodes;
  const current = nodes[index]! as unknown as Record<string, unknown>;
  const patch = op.patch as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  const ensure = (): Record<string, unknown> => (next ??= { ...current });
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    // Null is the wire sentinel for "clear this key" (parentId's null means
    // the canvas root, which is the same key removal); undefined can only come
    // from a locally built patch and is treated the same way.
    const removes = value === null || value === undefined;
    if (removes) {
      if (current[key] !== undefined) delete ensure()[key];
      continue;
    }
    if (!Object.is(current[key], value)) ensure()[key] = value;
  }
  if (next === null) return nodes;
  const result = nodes.slice();
  result[index] = next as unknown as CanvasNode;
  return result;
}

function applyRemove(nodes: CanvasNodes, id: string): CanvasNodes {
  const removed = collectSubtreeIds(nodes, id);
  if (removed.size === 0) return nodes;
  return nodes.filter((node) => !removed.has(node.id));
}

function applyReorder(nodes: CanvasNodes, op: Extract<CanvasOp, { _tag: "reorder" }>): CanvasNodes {
  const childFlatIndexes: number[] = [];
  const children: CanvasNode[] = [];
  nodes.forEach((node, flatIndex) => {
    if (parentKeyOf(node) === op.parentId) {
      childFlatIndexes.push(flatIndex);
      children.push(node);
    }
  });
  if (children.length === 0) return nodes;
  const byId = new Map(children.map((node) => [node.id, node] as const));
  const mentioned: CanvasNode[] = [];
  const mentionedIds = new Set<string>();
  for (const id of op.childIds) {
    const node = byId.get(id);
    if (node && !mentionedIds.has(id)) {
      mentionedIds.add(id);
      mentioned.push(node);
    }
  }
  const order = [...mentioned, ...children.filter((node) => !mentionedIds.has(node.id))];
  if (order.every((node, index) => node === children[index])) return nodes;
  const next = nodes.slice();
  order.forEach((node, index) => {
    next[childFlatIndexes[index]!] = node;
  });
  return next;
}

/**
 * Idempotent, tolerant reducer. Adds of an existing id replace the node in
 * place; updates and removes of missing ids are no-ops; reorders are filtered
 * to the parent's actual children with unmentioned children keeping their
 * relative order after the mentioned ones. Never throws. Returns the same
 * document reference when nothing changed.
 */
export function applyOps(doc: CanvasDocument, ops: readonly CanvasOp[]): CanvasDocument {
  if (ops.length === 0) return doc;
  let nodes = doc.nodes;
  for (const op of ops) {
    switch (op._tag) {
      case "add":
        nodes = upsertNode(nodes, op.node, op.index);
        break;
      case "add-image": {
        // Materialize the image with an empty attachmentId sentinel; the store
        // keeps any local dataUrl preview outside the document.
        const node: CanvasImageNode = { ...op.node, attachmentId: "" };
        nodes = upsertNode(nodes, node, op.index);
        break;
      }
      case "update":
        nodes = applyUpdate(nodes, op);
        break;
      case "remove":
        nodes = applyRemove(nodes, op.id);
        break;
      case "reorder":
        nodes = applyReorder(nodes, op);
        break;
      default:
        // Unknown op tags from newer servers are ignored.
        break;
    }
  }
  return nodes === doc.nodes ? doc : { schemaVersion: doc.schemaVersion, nodes };
}

function siblingIndexOf(doc: CanvasDocument, node: CanvasNode): number {
  return childrenOf(doc, node.parentId ?? null).findIndex((entry) => entry.id === node.id);
}

/**
 * An image whose payload the server has not resolved yet carries the empty
 * `attachmentId` sentinel, which the wire schema rejects. Such a node can
 * never be re-added by an inverse op, so inverses skip it (the capture itself
 * is still in flight and will land on its own). The same sentinel must not be
 * passed to `assets.createUrls`: an empty attachment id is not a valid
 * `AssetResource` and throws `InvalidAssetCollectionKeyError` during render.
 */
export const isPendingImageNode = (node: CanvasNode): boolean =>
  node.type === "image" && node.attachmentId === "";

/** Signed-URL resources for images that already have a server attachment. */
export function canvasImageAttachmentResources(
  nodes: readonly CanvasImageNode[],
): Array<{ readonly _tag: "attachment"; readonly attachmentId: string }> {
  return nodes.flatMap((node) =>
    isPendingImageNode(node)
      ? []
      : [{ _tag: "attachment" as const, attachmentId: node.attachmentId }],
  );
}

function invertOne(doc: CanvasDocument, op: CanvasOp): CanvasOp[] {
  switch (op._tag) {
    case "add":
    case "add-image": {
      const existing = getNode(doc, op.node.id);
      // Adding an existing id replaces it, so the inverse restores the prior
      // node (another in-place replace); a genuinely new node inverts to a
      // remove.
      if (existing) return isPendingImageNode(existing) ? [] : [{ _tag: "add", node: existing }];
      return [{ _tag: "remove", id: op.node.id }];
    }
    case "update": {
      const node = getNode(doc, op.id);
      if (!node) return [];
      const nodeRecord = node as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) {
        // Restore the prior value of every patched key. An absent optional key
        // restores through null, the wire sentinel for clearing: undefined
        // would be dropped by JSON and the undo would silently no-op.
        patch[key] = key === "parentId" ? (node.parentId ?? null) : (nodeRecord[key] ?? null);
      }
      return [{ _tag: "update", id: op.id, patch: patch as CanvasNodePatch }];
    }
    case "remove": {
      const node = getNode(doc, op.id);
      if (!node) return [];
      const adds: CanvasOp[] = [];
      // Preorder: parents before children so each add's parent exists, with
      // sibling indexes captured against the pre-remove document. Replaying
      // adds in ascending sibling order rebuilds each parent's child order.
      const visit = (entry: CanvasNode): void => {
        if (!isPendingImageNode(entry)) {
          adds.push({ _tag: "add", node: entry, index: siblingIndexOf(doc, entry) });
        }
        for (const child of childrenOf(doc, entry.id)) visit(child);
      };
      visit(node);
      return adds;
    }
    case "reorder":
      return [
        {
          _tag: "reorder",
          parentId: op.parentId,
          childIds: childrenOf(doc, op.parentId).map((node) => node.id),
        },
      ];
  }
}

/**
 * Inverse of `ops` against the pre-apply document. Applying `ops` and then the
 * result through the normal `applyOps` path restores the original document.
 */
export function invertOps(doc: CanvasDocument, ops: readonly CanvasOp[]): CanvasOp[] {
  const inverted: CanvasOp[] = [];
  let current = doc;
  for (const op of ops) {
    inverted.unshift(...invertOne(current, op));
    current = applyOps(current, [op]);
  }
  return inverted;
}

function reorderToEdge(
  doc: CanvasDocument,
  ids: readonly string[],
  edge: "front" | "back",
): CanvasOp[] {
  const idSet = new Set(ids);
  const parents: (string | null)[] = [];
  const seenParents = new Set<string | null>();
  for (const node of doc.nodes) {
    const parentKey = parentKeyOf(node);
    if (idSet.has(node.id) && !seenParents.has(parentKey)) {
      seenParents.add(parentKey);
      parents.push(parentKey);
    }
  }
  const ops: CanvasOp[] = [];
  for (const parentKey of parents) {
    const siblings = childrenOf(doc, parentKey);
    const mentioned = siblings.filter((node) => idSet.has(node.id));
    if (mentioned.length === 0) continue;
    const others = siblings.filter((node) => !idSet.has(node.id));
    const order = edge === "front" ? [...others, ...mentioned] : [...mentioned, ...others];
    if (order.every((node, index) => node === siblings[index])) continue;
    ops.push({ _tag: "reorder", parentId: parentKey, childIds: order.map((node) => node.id) });
  }
  return ops;
}

/** Reorder ops (one per affected parent) moving `ids` above their siblings. */
export function bringToFront(doc: CanvasDocument, ids: readonly string[]): CanvasOp[] {
  return reorderToEdge(doc, ids, "front");
}

/** Reorder ops (one per affected parent) moving `ids` below their siblings. */
export function sendToBack(doc: CanvasDocument, ids: readonly string[]): CanvasOp[] {
  return reorderToEdge(doc, ids, "back");
}
