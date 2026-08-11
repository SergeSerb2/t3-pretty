/**
 * Pure canvas op engine.
 *
 * Applies a batch of already-resolved ops to a `CanvasDocument`. `add-image`
 * ops never reach this module: the caller (CanvasStore) resolves the image
 * payload into a complete image node and rewrites the op to a plain `add`.
 *
 * Application is sequential and all-or-nothing — the first invalid op fails
 * the whole batch and the caller discards the partially updated document.
 * Nodes untouched by the batch keep referential identity so consumers can
 * diff documents cheaply.
 */
import {
  CANVAS_MAX_NODES,
  type CanvasDocument,
  CanvasInvalidOpError,
  CanvasLimitExceededError,
  type CanvasNode,
  type CanvasNodeId,
  CanvasNodeNotFoundError,
  type CanvasNodePatch,
  type CanvasOp,
  type ThreadId,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

/** CanvasOp with `add-image` already rewritten to a complete `add`. */
export type ResolvedCanvasOp = Exclude<CanvasOp, { readonly _tag: "add-image" }>;

export type CanvasOpsError =
  | CanvasInvalidOpError
  | CanvasNodeNotFoundError
  | CanvasLimitExceededError;

export interface CanvasOpsSuccess {
  readonly document: CanvasDocument;
  /** Aligned with the input ops; null for ops that don't create a node. */
  readonly appliedNodeIds: ReadonlyArray<CanvasNodeId | null>;
}

const COMMON_PATCH_KEYS = ["x", "y", "name", "parentId"] as const;

/**
 * Patchable keys per node type. Anything outside the node's set is rejected —
 * a patch that silently dropped `text` on an image would hide caller bugs.
 * Ink strokes exclude width/height (their geometry lives in immutable
 * `points`), and note height always follows the text.
 */
const PATCH_KEYS_BY_NODE_TYPE: Record<CanvasNode["type"], ReadonlySet<string>> = {
  frame: new Set([...COMMON_PATCH_KEYS, "width", "height"]),
  image: new Set([
    ...COMMON_PATCH_KEYS,
    "width",
    "height",
    "attachmentId",
    "naturalWidth",
    "naturalHeight",
    "sourceRef",
  ]),
  ink: new Set([...COMMON_PATCH_KEYS, "color", "strokeWidth"]),
  region: new Set([...COMMON_PATCH_KEYS, "width", "height", "label", "color"]),
  note: new Set([...COMMON_PATCH_KEYS, "text", "color", "width"]),
};

const invalidOp = (threadId: ThreadId, opIndex: number, reason: string): CanvasInvalidOpError =>
  new CanvasInvalidOpError({ threadId, opIndex, reason });

const findNodeIndex = (nodes: ReadonlyArray<CanvasNode>, id: CanvasNodeId): number =>
  nodes.findIndex((node) => node.id === id);

/** Flat-array indices of the nodes parented to `parentId` (null = root). */
const childIndices = (
  nodes: ReadonlyArray<CanvasNode>,
  parentId: CanvasNodeId | null,
): Array<number> => {
  const indices: Array<number> = [];
  for (const [index, node] of nodes.entries()) {
    if ((node.parentId ?? null) === parentId) indices.push(index);
  }
  return indices;
};

/**
 * Whether re-parenting `nodeId` under `newParentId` would make the node its
 * own ancestor. Walks the parent chain upward from the new parent; the seen
 * set guards against pre-existing malformed chains.
 */
const wouldCreateCycle = (
  nodes: ReadonlyArray<CanvasNode>,
  nodeId: CanvasNodeId,
  newParentId: CanvasNodeId,
): boolean => {
  const seen = new Set<CanvasNodeId>();
  let currentId: CanvasNodeId | undefined = newParentId;
  while (currentId !== undefined) {
    if (currentId === nodeId || seen.has(currentId)) return true;
    seen.add(currentId);
    const index = findNodeIndex(nodes, currentId);
    currentId = index === -1 ? undefined : nodes[index]?.parentId;
  }
  return false;
};

/** Mutates `nodes` in place; the caller owns the array copy. */
const applyAdd = (
  threadId: ThreadId,
  nodes: Array<CanvasNode>,
  op: Extract<ResolvedCanvasOp, { readonly _tag: "add" }>,
  opIndex: number,
): CanvasOpsError | null => {
  if (findNodeIndex(nodes, op.node.id) !== -1) {
    return invalidOp(threadId, opIndex, `a node with id "${op.node.id}" already exists`);
  }
  if (nodes.length >= CANVAS_MAX_NODES) {
    return new CanvasLimitExceededError({ threadId, limit: "nodes" });
  }
  const parentId = op.node.parentId;
  if (parentId !== undefined) {
    const parentIndex = findNodeIndex(nodes, parentId);
    const parent = parentIndex === -1 ? undefined : nodes[parentIndex];
    if (parent === undefined || parent.type !== "frame") {
      return invalidOp(
        threadId,
        opIndex,
        `parentId "${parentId}" does not reference an existing frame`,
      );
    }
  }
  const siblings = childIndices(nodes, parentId ?? null);
  const insertBefore = op.index !== undefined ? siblings[op.index] : undefined;
  if (insertBefore !== undefined) {
    nodes.splice(insertBefore, 0, op.node);
  } else {
    // Absent or past-the-end index appends, keeping the new node topmost.
    nodes.push(op.node);
  }
  return null;
};

/**
 * Keys an update may clear with an explicit null. They are optional on every
 * node type that accepts them; `width` is optional on notes alone.
 */
const CLEARABLE_PATCH_KEYS = new Set<keyof CanvasNodePatch>([
  "name",
  "color",
  "label",
  "sourceRef",
  "naturalWidth",
  "naturalHeight",
]);

const isClearablePatchKey = (key: keyof CanvasNodePatch, nodeType: CanvasNode["type"]): boolean =>
  CLEARABLE_PATCH_KEYS.has(key) || (key === "width" && nodeType === "note");

/** Mutates `nodes` in place; the caller owns the array copy. */
const applyUpdate = (
  threadId: ThreadId,
  nodes: Array<CanvasNode>,
  op: Extract<ResolvedCanvasOp, { readonly _tag: "update" }>,
  opIndex: number,
): CanvasOpsError | null => {
  const index = findNodeIndex(nodes, op.id);
  const node = index === -1 ? undefined : nodes[index];
  if (node === undefined) {
    return new CanvasNodeNotFoundError({ threadId, nodeId: op.id });
  }

  const allowedKeys = PATCH_KEYS_BY_NODE_TYPE[node.type];
  const presentKeys = (Object.keys(op.patch) as Array<keyof CanvasNodePatch>).filter(
    (key) => op.patch[key] !== undefined,
  );
  for (const key of presentKeys) {
    if (!allowedKeys.has(key)) {
      return invalidOp(
        threadId,
        opIndex,
        `patch key "${key}" is not valid for a ${node.type} node`,
      );
    }
    if (op.patch[key] === null && key !== "parentId" && !isClearablePatchKey(key, node.type)) {
      return invalidOp(threadId, opIndex, `patch key "${key}" is required for a ${node.type} node`);
    }
  }

  const nextParentId = op.patch.parentId;
  if (nextParentId !== undefined && nextParentId !== null) {
    const parentIndex = findNodeIndex(nodes, nextParentId);
    const parent = parentIndex === -1 ? undefined : nodes[parentIndex];
    if (parent === undefined || parent.type !== "frame") {
      return invalidOp(
        threadId,
        opIndex,
        `parentId "${nextParentId}" does not reference an existing frame`,
      );
    }
    if (wouldCreateCycle(nodes, node.id, nextParentId)) {
      return invalidOp(
        threadId,
        opIndex,
        `parentId "${nextParentId}" would make node "${node.id}" its own ancestor`,
      );
    }
  }

  const next: Record<string, unknown> = { ...node };
  for (const key of presentKeys) {
    if (key === "parentId") continue;
    // Null clears an optional key; every other value is written through.
    if (op.patch[key] === null) delete next[key];
    else next[key] = op.patch[key];
  }
  if (nextParentId === null) {
    delete next["parentId"];
  } else if (nextParentId !== undefined) {
    next["parentId"] = nextParentId;
  }
  nodes[index] = next as CanvasNode;
  return null;
};

/** Returns the surviving nodes, or an error when the target is missing. */
const applyRemove = (
  threadId: ThreadId,
  nodes: Array<CanvasNode>,
  op: Extract<ResolvedCanvasOp, { readonly _tag: "remove" }>,
): Result.Result<Array<CanvasNode>, CanvasOpsError> => {
  if (findNodeIndex(nodes, op.id) === -1) {
    return Result.fail(new CanvasNodeNotFoundError({ threadId, nodeId: op.id }));
  }
  // Cascade through descendants: repeatedly absorb nodes whose parent is
  // already marked. Depth is bounded by the frame-nesting depth.
  const removed = new Set<CanvasNodeId>([op.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId !== undefined && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  return Result.succeed(nodes.filter((node) => !removed.has(node.id)));
};

/** Mutates `nodes` in place; the caller owns the array copy. */
const applyReorder = (
  threadId: ThreadId,
  nodes: Array<CanvasNode>,
  op: Extract<ResolvedCanvasOp, { readonly _tag: "reorder" }>,
  opIndex: number,
): CanvasOpsError | null => {
  if (op.parentId !== null) {
    const parentIndex = findNodeIndex(nodes, op.parentId);
    const parent = parentIndex === -1 ? undefined : nodes[parentIndex];
    if (parent === undefined) {
      return new CanvasNodeNotFoundError({ threadId, nodeId: op.parentId });
    }
    if (parent.type !== "frame") {
      return invalidOp(threadId, opIndex, `parentId "${op.parentId}" does not reference a frame`);
    }
  }

  const indices = childIndices(nodes, op.parentId);
  const currentIds = new Set(indices.map((index) => nodes[index]!.id));
  const isPermutation =
    op.childIds.length === indices.length &&
    new Set(op.childIds).size === op.childIds.length &&
    op.childIds.every((id) => currentIds.has(id));
  if (!isPermutation) {
    return invalidOp(
      threadId,
      opIndex,
      "childIds must be an exact permutation of the parent's current children",
    );
  }

  // Reassign the children's existing flat-array slots in the new order so
  // every other node keeps its position.
  const childById = new Map(indices.map((index) => [nodes[index]!.id, nodes[index]!] as const));
  indices.forEach((nodeIndex, position) => {
    nodes[nodeIndex] = childById.get(op.childIds[position]!)!;
  });
  return null;
};

export const applyCanvasOps = (
  threadId: ThreadId,
  document: CanvasDocument,
  ops: ReadonlyArray<ResolvedCanvasOp>,
): Result.Result<CanvasOpsSuccess, CanvasOpsError> => {
  // Shallow copy: op handlers own this array, node objects stay shared with
  // the input document unless an op replaces them.
  let nodes: Array<CanvasNode> = [...document.nodes];
  const appliedNodeIds: Array<CanvasNodeId | null> = [];

  for (const [opIndex, op] of ops.entries()) {
    switch (op._tag) {
      case "add": {
        const error = applyAdd(threadId, nodes, op, opIndex);
        if (error !== null) return Result.fail(error);
        appliedNodeIds.push(op.node.id);
        break;
      }
      case "update": {
        const error = applyUpdate(threadId, nodes, op, opIndex);
        if (error !== null) return Result.fail(error);
        appliedNodeIds.push(null);
        break;
      }
      case "remove": {
        const outcome = applyRemove(threadId, nodes, op);
        if (Result.isFailure(outcome)) return Result.fail(outcome.failure);
        nodes = outcome.success;
        appliedNodeIds.push(null);
        break;
      }
      case "reorder": {
        const error = applyReorder(threadId, nodes, op, opIndex);
        if (error !== null) return Result.fail(error);
        appliedNodeIds.push(null);
        break;
      }
    }
  }

  return Result.succeed({
    document: { schemaVersion: document.schemaVersion, nodes },
    appliedNodeIds,
  });
};
