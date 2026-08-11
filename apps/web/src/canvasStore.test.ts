import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ThreadId,
  emptyCanvasDocument,
  type CanvasDocument,
  type CanvasNoteNode,
  type CanvasOp,
  type EnvironmentId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectRenderedDoc, selectThreadCanvasState, useCanvasStore } from "./canvasStore";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));

const note = (id: string, x = 0, y = 0): CanvasNoteNode => ({ id, type: "note", x, y, text: id });

const addOp = (id: string): CanvasOp => ({ _tag: "add", node: note(id) });

const snapshot = (document: CanvasDocument, revision: number, serverEpoch: string) => ({
  document,
  revision,
  serverEpoch,
  selectedNodeIds: [],
});

const state = () => selectThreadCanvasState(useCanvasStore.getState().byThreadKey, ref);

const renderedIds = () => selectRenderedDoc(state()).nodes.map((node) => node.id);

beforeEach(() => {
  useCanvasStore.setState({ byThreadKey: {} });
});

describe("canvasStore", () => {
  it("runs the commit -> flight -> ack cycle", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("n1")]);
    expect(renderedIds()).toEqual(["n1"]);
    expect(state().serverDoc?.nodes).toHaveLength(0);

    const flight = store.takeFlight(ref);
    expect(flight?.baseRevision).toBe(1);
    expect(flight?.ops).toHaveLength(1);
    expect(store.takeFlight(ref)).toBeNull();
    expect(state().pendingOps).toEqual([]);
    // Optimistic state stays visible while the flight is out.
    expect(renderedIds()).toEqual(["n1"]);

    store.flightSucceeded(ref, 2);
    expect(state().inFlightOps).toBeNull();
    // The ack records the revision without advancing serverDoc: the applied
    // event still has to deliver the ops, and must not be deduped away.
    expect(state().revision).toBe(1);
    expect(state().ackedRevision).toBe(2);
    // A follow-up apply bases on the acked revision, not the stale doc one.
    store.commitLocalOps(ref, [addOp("n2")]);
    expect(store.takeFlight(ref)?.baseRevision).toBe(2);
    store.flightFailed(ref, { conflict: true });

    store.applyServerDelta(ref, { ops: flight!.ops, revision: 2, origin: "client" });
    expect(state().serverDoc?.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(state().revision).toBe(2);
    // n2 is still queued from the conflict requeue above.
    expect(renderedIds()).toEqual(["n1", "n2"]);
  });

  it("returns failed flights to the head of pendingOps", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("a")]);
    store.takeFlight(ref);
    store.commitLocalOps(ref, [addOp("b")]);
    store.flightFailed(ref, { conflict: true });
    expect(state().inFlightOps).toBeNull();
    expect(state().pendingOps.map((op) => (op._tag === "add" ? op.node.id : op._tag))).toEqual([
      "a",
      "b",
    ]);
  });

  it("undoes and redoes committed ops through the pending pipeline", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("n1")]);
    expect(state().undoStack).toHaveLength(1);

    store.undo(ref);
    expect(renderedIds()).toEqual([]);
    expect(state().undoStack).toHaveLength(0);
    expect(state().redoStack).toHaveLength(1);

    store.redo(ref);
    expect(renderedIds()).toEqual(["n1"]);
    expect(state().undoStack).toHaveLength(1);
    expect(state().redoStack).toHaveLength(0);

    // A fresh commit clears the redo stack.
    store.undo(ref);
    store.commitLocalOps(ref, [addOp("n2")]);
    expect(state().redoStack).toHaveLength(0);
  });

  it("keeps pending ops on a same-epoch refetch and clears on epoch change", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("n1")]);

    const refetched: CanvasDocument = { schemaVersion: 1, nodes: [note("server-node")] };
    store.resetFromSnapshot(ref, snapshot(refetched, 5, "epoch-1"));
    expect(state().pendingOps).toHaveLength(1);
    expect(state().undoStack).toHaveLength(1);
    expect(renderedIds()).toEqual(["server-node", "n1"]);

    store.resetFromSnapshot(ref, snapshot(refetched, 1, "epoch-2"));
    expect(state().pendingOps).toEqual([]);
    expect(state().inFlightOps).toBeNull();
    expect(state().undoStack).toEqual([]);
    expect(state().redoStack).toEqual([]);
    expect(renderedIds()).toEqual(["server-node"]);
  });

  it("reports whether setSelection changed anything", () => {
    const store = useCanvasStore.getState();
    expect(store.setSelection(ref, ["a", "b"])).toBe(true);
    expect(store.setSelection(ref, ["a", "b"])).toBe(false);
    expect(store.setSelection(ref, ["b", "a"])).toBe(true);
    expect(state().selectedNodeIds).toEqual(["b", "a"]);
  });

  it("tracks remote adds for the jump pill and recent-remote highlights", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.applyServerDelta(ref, {
      ops: [{ _tag: "add", node: note("agent-note", 10, 20) }],
      revision: 2,
      origin: "agent",
    });
    expect(state().recentRemoteNodeIds.map((entry) => entry.id)).toEqual(["agent-note"]);
    expect(state().jumpPill?.count).toBe(1);
    expect(state().jumpPill?.bounds).toMatchObject({ x: 10, y: 20 });

    store.applyServerDelta(ref, {
      ops: [{ _tag: "add", node: note("own-note") }],
      revision: 3,
      origin: "client",
    });
    expect(state().recentRemoteNodeIds).toHaveLength(1);

    store.dismissJumpPill(ref);
    expect(state().jumpPill).toBeNull();
    store.clearRecentRemote(ref, 0);
    expect(state().recentRemoteNodeIds).toEqual([]);
  });

  it("stores and clears local image previews outside the document", () => {
    const store = useCanvasStore.getState();
    store.setLocalImagePreview(ref, "img-1", "data:image/png;base64,AAAA");
    expect(state().localImagePreviews).toEqual({ "img-1": "data:image/png;base64,AAAA" });
    store.clearLocalImagePreview(ref, "img-1");
    expect(state().localImagePreviews).toEqual({});
  });

  it("memoizes the rendered doc on input identities", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("n1")]);
    const first = selectRenderedDoc(state());
    store.setViewport(ref, { tx: 10, ty: 10, scale: 2 });
    expect(selectRenderedDoc(state())).toBe(first);
  });
});

describe("canvasStore failure and preview lifecycle", () => {
  const imageOp = (id: string): CanvasOp => ({
    _tag: "add-image",
    node: { id, type: "image", x: 0, y: 0, width: 10, height: 10 },
    image: { kind: "dataUrl", dataUrl: "data:image/png;base64,AAA" },
  });

  it("drops a rejected flight instead of wedging the queue behind it", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("poison")]);
    store.takeFlight(ref);
    store.commitLocalOps(ref, [addOp("later")]);

    const dropped = store.flightFailed(ref, { conflict: false });

    expect(dropped.map((op) => (op._tag === "add" ? op.node.id : op._tag))).toEqual(["poison"]);
    // The rejected op is gone; the edit queued behind it can still be sent.
    expect(state().pendingOps.map((op) => (op._tag === "add" ? op.node.id : op._tag))).toEqual([
      "later",
    ]);
    expect(renderedIds()).toEqual(["later"]);
    expect(store.takeFlight(ref)?.ops).toHaveLength(1);
  });

  it("keeps the local selection when a same-epoch snapshot arrives", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [addOp("n1")]);
    store.setSelection(ref, ["n1"]);

    // The server's shared presence copy must not clobber this window.
    store.resetFromSnapshot(ref, {
      ...snapshot(emptyCanvasDocument(), 2, "epoch-1"),
      selectedNodeIds: ["other"],
    });

    expect(state().selectedNodeIds).toEqual(["n1"]);
  });

  it("clears an image preview once the server resolves its attachment", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [imageOp("img")]);
    store.setLocalImagePreview(ref, "img", "data:image/png;base64,AAA");
    expect(state().localImagePreviews["img"]).toBeDefined();

    store.applyServerDelta(ref, {
      ops: [
        {
          _tag: "add",
          node: {
            id: "img",
            type: "image",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            attachmentId: "att-1",
          },
        },
      ],
      revision: 2,
      origin: "client",
    });

    expect(state().localImagePreviews["img"]).toBeUndefined();
  });

  it("never queues an add carrying the pending-attachment sentinel", () => {
    const store = useCanvasStore.getState();
    store.resetFromSnapshot(ref, snapshot(emptyCanvasDocument(), 1, "epoch-1"));
    store.commitLocalOps(ref, [imageOp("img")]);
    // Undo before the capture is acked, then redo: the redo op would carry
    // attachmentId "" and be rejected by the wire schema.
    store.undo(ref);
    store.redo(ref);

    for (const op of state().pendingOps) {
      if (op._tag === "add" && op.node.type === "image") {
        expect(op.node.attachmentId).not.toBe("");
      }
    }
  });
});
