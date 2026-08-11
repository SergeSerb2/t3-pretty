/**
 * Per-thread canvas UI and sync state.
 *
 * Owns the optimistic op pipeline (pending -> in-flight -> server ack), undo/
 * redo, tool and selection state, and the viewport transform. The rendered
 * document is derived - `applyOps(serverDoc, [...inFlightOps, ...pendingOps])`
 * - through the memoized `selectRenderedDoc` helper, never stored. Document
 * math lives in canvasDocSync; this store stays thin. Not persisted.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  CANVAS_MAX_OPS_PER_APPLY,
  emptyCanvasDocument,
  type CanvasDocument,
  type CanvasOp,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { create } from "zustand";

import {
  applyOps,
  getNode,
  invertOps,
  unionRects,
  worldRectOf,
  type CanvasRect,
} from "./canvasDocSync";
import type { CanvasPoint, CanvasViewportTransform } from "./canvasViewport";

export type CanvasTool = "select" | "pan" | "ink" | "region" | "note";

/** In-progress pointer interaction; interaction hooks own the field contents. */
export type CanvasGesture =
  | { kind: "pan"; startScreen: CanvasPoint; startViewport: CanvasViewportTransform }
  | {
      kind: "move";
      nodeIds: string[];
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startPositions: Record<string, CanvasPoint>;
    }
  | {
      kind: "resize";
      nodeId: string;
      handle: "nw" | "ne" | "sw" | "se";
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startRect: CanvasRect;
      /** Preserve the start rect's aspect ratio (images without shift held). */
      aspectLocked: boolean;
    }
  | { kind: "marquee"; startWorld: CanvasPoint; currentWorld: CanvasPoint; additive: boolean }
  | { kind: "ink"; points: CanvasPoint[]; color: string; strokeWidth: number }
  | { kind: "region"; startWorld: CanvasPoint; currentWorld: CanvasPoint };

export interface CanvasJumpPill {
  bounds: CanvasRect;
  count: number;
  at: number;
}

export interface ThreadCanvasState {
  serverDoc: CanvasDocument | null;
  /** Revision `serverDoc` actually reflects; drives event dedupe and gaps. */
  revision: number;
  /**
   * Highest revision the server has confirmed, which may run ahead of
   * `revision` between an apply ack and the `applied` event that carries the
   * same ops. Applies must base on this, or the server sees a stale base.
   */
  ackedRevision: number;
  /** Server epoch the document/revision belong to; resets invalidate both. */
  docEpoch: string | null;
  /** Local ops not yet handed to an apply RPC. */
  pendingOps: CanvasOp[];
  /** Ops currently inside an apply RPC; null when no flight is out. */
  inFlightOps: CanvasOp[] | null;
  /** dataUrl previews for image nodes awaiting server attachment resolution. */
  localImagePreviews: Record<string, string>;
  undoStack: CanvasOp[][];
  redoStack: CanvasOp[][];
  tool: CanvasTool;
  selectedNodeIds: string[];
  viewport: CanvasViewportTransform;
  gesture: CanvasGesture | null;
  /** Nodes recently added by remote (agent) ops, for highlight effects. */
  recentRemoteNodeIds: { id: string; at: number }[];
  jumpPill: CanvasJumpPill | null;
}

export const CANVAS_UNDO_LIMIT = 100;

const EMPTY_THREAD_CANVAS_STATE: ThreadCanvasState = Object.freeze({
  serverDoc: null,
  revision: 0,
  ackedRevision: 0,
  docEpoch: null,
  pendingOps: [],
  inFlightOps: null,
  localImagePreviews: {},
  undoStack: [],
  redoStack: [],
  tool: "select",
  selectedNodeIds: [],
  viewport: { tx: 0, ty: 0, scale: 1 },
  gesture: null,
  recentRemoteNodeIds: [],
  jumpPill: null,
}) as ThreadCanvasState;

const EMPTY_CANVAS_DOCUMENT = emptyCanvasDocument();

interface CanvasStoreState {
  byThreadKey: Record<string, ThreadCanvasState>;
  /**
   * Adopt an authoritative snapshot. An epoch change discards pending,
   * in-flight, and undo/redo state; a same-epoch refetch (conflict recovery)
   * keeps pendingOps so local edits replay over the fresh document.
   */
  resetFromSnapshot: (
    ref: ScopedThreadRef,
    snapshot: {
      document: CanvasDocument;
      revision: number;
      serverEpoch: string;
      selectedNodeIds: readonly string[];
    },
  ) => void;
  /** Advance serverDoc by a server-applied delta; agent ops feed the jump pill. */
  applyServerDelta: (
    ref: ScopedThreadRef,
    delta: { ops: readonly CanvasOp[]; revision: number; origin: "client" | "agent" },
  ) => void;
  commitLocalOps: (
    ref: ScopedThreadRef,
    ops: readonly CanvasOp[],
    options?: { undoable?: boolean },
  ) => void;
  /** Move pendingOps into flight; null when a flight is out or nothing pends. */
  takeFlight: (ref: ScopedThreadRef) => { ops: CanvasOp[]; baseRevision: number } | null;
  /**
   * Record the acked revision. `serverDoc` is deliberately left alone: the
   * matching `applied` event carries the ops and is idempotent.
   */
  flightSucceeded: (ref: ScopedThreadRef, revision: number) => void;
  /**
   * A conflict returns the ops to the head of pendingOps so they replay over
   * the refetched document. Any other rejection DROPS them: the server has
   * refused them once and requeueing would wedge the queue behind an op it
   * will never accept, silently stranding every later edit.
   */
  flightFailed: (ref: ScopedThreadRef, outcome: { conflict: boolean }) => CanvasOp[];
  undo: (ref: ScopedThreadRef) => void;
  redo: (ref: ScopedThreadRef) => void;
  setTool: (ref: ScopedThreadRef, tool: CanvasTool) => void;
  /** Returns whether the selection actually changed (callers debounce the RPC). */
  setSelection: (ref: ScopedThreadRef, ids: readonly string[]) => boolean;
  setViewport: (ref: ScopedThreadRef, viewport: CanvasViewportTransform) => void;
  setGesture: (ref: ScopedThreadRef, gesture: CanvasGesture | null) => void;
  setLocalImagePreview: (ref: ScopedThreadRef, nodeId: string, dataUrl: string) => void;
  clearLocalImagePreview: (ref: ScopedThreadRef, nodeId: string) => void;
  dismissJumpPill: (ref: ScopedThreadRef) => void;
  clearRecentRemote: (ref: ScopedThreadRef, olderThanMs: number) => void;
}

/**
 * Local dataUrl previews only matter until the server resolves the payload:
 * keep the ones whose node still exists and still carries the pending
 * `attachmentId` sentinel. Without this they accumulate whole PNGs, and a
 * re-capture's stale preview would outrank the real bitmap in the crop.
 */
const pruneLocalImagePreviews = (
  previews: Record<string, string>,
  doc: CanvasDocument,
): Record<string, string> => {
  const entries = Object.entries(previews);
  if (entries.length === 0) return previews;
  const kept = entries.filter(([nodeId]) => {
    const node = getNode(doc, nodeId);
    return node !== null && node.type === "image" && node.attachmentId === "";
  });
  if (kept.length === entries.length) return previews;
  return Object.fromEntries(kept);
};

const updateThread = (
  byThreadKey: Record<string, ThreadCanvasState>,
  threadKey: string,
  updater: (current: ThreadCanvasState) => ThreadCanvasState,
): Record<string, ThreadCanvasState> => {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_CANVAS_STATE;
  const next = updater(current);
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

export const useCanvasStore = create<CanvasStoreState>()((set, get) => {
  const updateState = (
    ref: ScopedThreadRef,
    updater: (current: ThreadCanvasState) => ThreadCanvasState,
  ): void =>
    set((state) => ({
      byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), updater),
    }));

  return {
    byThreadKey: {},
    resetFromSnapshot: (ref, snapshot) =>
      updateState(ref, (current) => {
        const epochChanged = current.docEpoch !== snapshot.serverEpoch;
        // The server keeps one shared selection per thread; adopting it here
        // would wipe this window's selection on every refetch, including the
        // refetch a capture's own ack triggers.
        return {
          ...current,
          serverDoc: snapshot.document,
          revision: snapshot.revision,
          ackedRevision: Math.max(current.ackedRevision, snapshot.revision),
          docEpoch: snapshot.serverEpoch,
          localImagePreviews: pruneLocalImagePreviews(
            current.localImagePreviews,
            snapshot.document,
          ),
          ...(epochChanged
            ? {
                pendingOps: [],
                inFlightOps: null,
                undoStack: [],
                redoStack: [],
                selectedNodeIds: [],
              }
            : {}),
        };
      }),
    applyServerDelta: (ref, delta) =>
      updateState(ref, (current) => {
        const baseDoc = current.serverDoc ?? EMPTY_CANVAS_DOCUMENT;
        const serverDoc = applyOps(baseDoc, delta.ops);
        const localImagePreviews = pruneLocalImagePreviews(current.localImagePreviews, serverDoc);
        let recentRemoteNodeIds = current.recentRemoteNodeIds;
        let jumpPill = current.jumpPill;
        if (delta.origin === "agent") {
          const addedIds = delta.ops
            .flatMap((op) => (op._tag === "add" || op._tag === "add-image" ? [op.node.id] : []))
            .filter((id) => !getNode(baseDoc, id));
          if (addedIds.length > 0) {
            const at = Date.now();
            recentRemoteNodeIds = [...recentRemoteNodeIds, ...addedIds.map((id) => ({ id, at }))];
            const bounds = addedIds.reduce<CanvasRect | null>(
              (union, id) => unionRects(union, worldRectOf(serverDoc, id)),
              null,
            );
            if (bounds) jumpPill = { bounds, count: addedIds.length, at };
          }
        }
        return {
          ...current,
          serverDoc,
          revision: delta.revision,
          ackedRevision: Math.max(current.ackedRevision, delta.revision),
          localImagePreviews,
          recentRemoteNodeIds,
          jumpPill,
        };
      }),
    commitLocalOps: (ref, ops, options) =>
      updateState(ref, (current) => {
        if (ops.length === 0) return current;
        const undoable = options?.undoable ?? true;
        const inverse = invertOps(selectRenderedDoc(current), ops);
        return {
          ...current,
          pendingOps: [...current.pendingOps, ...ops],
          ...(undoable
            ? {
                undoStack: [...current.undoStack, inverse].slice(-CANVAS_UNDO_LIMIT),
                redoStack: [],
              }
            : {}),
        };
      }),
    takeFlight: (ref) => {
      const current = get().byThreadKey[scopedThreadKey(ref)];
      if (!current || current.inFlightOps !== null || current.pendingOps.length === 0) return null;
      const ops = current.pendingOps.slice(0, CANVAS_MAX_OPS_PER_APPLY);
      updateState(ref, (state) =>
        state.inFlightOps !== null || state.pendingOps.length === 0
          ? state
          : {
              ...state,
              inFlightOps: state.pendingOps.slice(0, CANVAS_MAX_OPS_PER_APPLY),
              pendingOps: state.pendingOps.slice(CANVAS_MAX_OPS_PER_APPLY),
            },
      );
      return { ops, baseRevision: Math.max(current.revision, current.ackedRevision) };
    },
    flightSucceeded: (ref, revision) =>
      updateState(ref, (current) =>
        current.inFlightOps === null
          ? current
          : {
              ...current,
              inFlightOps: null,
              ackedRevision: Math.max(current.ackedRevision, revision),
            },
      ),
    flightFailed: (ref, outcome) => {
      const current = get().byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_CANVAS_STATE;
      const inFlight = current.inFlightOps;
      if (inFlight === null) return [];
      updateState(ref, (state) => ({
        ...state,
        pendingOps: outcome.conflict ? [...inFlight, ...state.pendingOps] : state.pendingOps,
        inFlightOps: null,
      }));
      return outcome.conflict ? [] : inFlight;
    },
    undo: (ref) =>
      updateState(ref, (current) => {
        const entry = current.undoStack.at(-1);
        if (!entry) return current;
        const redoEntry = invertOps(selectRenderedDoc(current), entry);
        return {
          ...current,
          undoStack: current.undoStack.slice(0, -1),
          redoStack: [...current.redoStack, redoEntry],
          pendingOps: [...current.pendingOps, ...entry],
        };
      }),
    redo: (ref) =>
      updateState(ref, (current) => {
        const entry = current.redoStack.at(-1);
        if (!entry) return current;
        const undoEntry = invertOps(selectRenderedDoc(current), entry);
        return {
          ...current,
          redoStack: current.redoStack.slice(0, -1),
          undoStack: [...current.undoStack, undoEntry].slice(-CANVAS_UNDO_LIMIT),
          pendingOps: [...current.pendingOps, ...entry],
        };
      }),
    setTool: (ref, tool) =>
      updateState(ref, (current) => (current.tool === tool ? current : { ...current, tool })),
    setSelection: (ref, ids) => {
      const current = get().byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_CANVAS_STATE;
      const changed =
        ids.length !== current.selectedNodeIds.length ||
        ids.some((id, index) => id !== current.selectedNodeIds[index]);
      if (!changed) return false;
      updateState(ref, (state) => ({ ...state, selectedNodeIds: [...ids] }));
      return true;
    },
    setViewport: (ref, viewport) =>
      updateState(ref, (current) =>
        current.viewport === viewport ? current : { ...current, viewport },
      ),
    setGesture: (ref, gesture) =>
      updateState(ref, (current) =>
        current.gesture === gesture ? current : { ...current, gesture },
      ),
    setLocalImagePreview: (ref, nodeId, dataUrl) =>
      updateState(ref, (current) => ({
        ...current,
        localImagePreviews: { ...current.localImagePreviews, [nodeId]: dataUrl },
      })),
    clearLocalImagePreview: (ref, nodeId) =>
      updateState(ref, (current) => {
        if (!(nodeId in current.localImagePreviews)) return current;
        const { [nodeId]: _removed, ...localImagePreviews } = current.localImagePreviews;
        return { ...current, localImagePreviews };
      }),
    dismissJumpPill: (ref) =>
      updateState(ref, (current) =>
        current.jumpPill === null ? current : { ...current, jumpPill: null },
      ),
    clearRecentRemote: (ref, olderThanMs) =>
      updateState(ref, (current) => {
        const cutoff = Date.now() - olderThanMs;
        const recentRemoteNodeIds = current.recentRemoteNodeIds.filter(
          (entry) => entry.at > cutoff,
        );
        if (recentRemoteNodeIds.length === current.recentRemoteNodeIds.length) return current;
        return { ...current, recentRemoteNodeIds };
      }),
  };
});

export function selectThreadCanvasState(
  byThreadKey: Record<string, ThreadCanvasState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadCanvasState {
  if (!ref) return EMPTY_THREAD_CANVAS_STATE;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_CANVAS_STATE;
}

interface RenderedDocMemoEntry {
  inFlightOps: readonly CanvasOp[] | null;
  pendingOps: readonly CanvasOp[];
  doc: CanvasDocument;
}

// Keyed by serverDoc identity with a short per-doc entry list, so repeated
// selector calls (and unrelated state changes such as viewport pans) reuse the
// last applyOps result instead of recomputing per call.
const renderedDocMemo = new WeakMap<CanvasDocument, RenderedDocMemoEntry[]>();
const RENDERED_DOC_MEMO_LIMIT = 8;

/**
 * The document as the user sees it: serverDoc with in-flight and pending ops
 * replayed on top. Memoized on the identities of its three inputs.
 */
export function selectRenderedDoc(state: ThreadCanvasState): CanvasDocument {
  const base = state.serverDoc ?? EMPTY_CANVAS_DOCUMENT;
  const inFlightOps = state.inFlightOps;
  const pendingOps = state.pendingOps;
  if ((inFlightOps === null || inFlightOps.length === 0) && pendingOps.length === 0) return base;
  let entries = renderedDocMemo.get(base);
  const hit = entries?.find(
    (entry) => entry.inFlightOps === inFlightOps && entry.pendingOps === pendingOps,
  );
  if (hit) return hit.doc;
  const doc = applyOps(base, [...(inFlightOps ?? []), ...pendingOps]);
  if (!entries) {
    entries = [];
    renderedDocMemo.set(base, entries);
  }
  entries.push({ inFlightOps, pendingOps, doc });
  if (entries.length > RENDERED_DOC_MEMO_LIMIT) entries.shift();
  return doc;
}

export const __testing = {
  EMPTY_THREAD_CANVAS_STATE,
};
