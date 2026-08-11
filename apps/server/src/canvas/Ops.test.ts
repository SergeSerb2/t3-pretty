import {
  CANVAS_MAX_NODES,
  CANVAS_SCHEMA_VERSION,
  type CanvasDocument,
  type CanvasFrameNode,
  type CanvasNode,
  type CanvasNoteNode,
  ThreadId,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  applyCanvasOps,
  type CanvasOpsError,
  type CanvasOpsSuccess,
  type ResolvedCanvasOp,
} from "./Ops.ts";

const threadId = ThreadId.make("thread-canvas-ops");

const doc = (...nodes: ReadonlyArray<CanvasNode>): CanvasDocument => ({
  schemaVersion: CANVAS_SCHEMA_VERSION,
  nodes,
});

const frame = (id: string, overrides: Partial<CanvasFrameNode> = {}): CanvasNode => ({
  id,
  type: "frame",
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  ...overrides,
});

const note = (id: string, overrides: Partial<CanvasNoteNode> = {}): CanvasNode => ({
  id,
  type: "note",
  x: 0,
  y: 0,
  text: "note",
  ...overrides,
});

const ink = (id: string): CanvasNode => ({
  id,
  type: "ink",
  x: 0,
  y: 0,
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
  color: "#000",
  strokeWidth: 2,
});

const image = (id: string): CanvasNode => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  attachmentId: "att-1",
});

const region = (id: string): CanvasNode => ({
  id,
  type: "region",
  x: 0,
  y: 0,
  width: 50,
  height: 50,
});

const add = (node: CanvasNode, index?: number): ResolvedCanvasOp =>
  index === undefined ? { _tag: "add", node } : { _tag: "add", node, index };

const unwrapSuccess = (result: ReturnType<typeof applyCanvasOps>): CanvasOpsSuccess => {
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got failure: ${String(result.failure)}`);
  }
  return result.success;
};

const unwrapFailure = (result: ReturnType<typeof applyCanvasOps>): CanvasOpsError => {
  if (Result.isSuccess(result)) {
    throw new Error("expected failure, got success");
  }
  return result.failure;
};

describe("applyCanvasOps", () => {
  it("adds nodes and reports their ids in appliedNodeIds", () => {
    const { document, appliedNodeIds } = unwrapSuccess(
      applyCanvasOps(threadId, doc(), [add(note("n1")), add(ink("n2"))]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(appliedNodeIds).toEqual(["n1", "n2"]);
  });

  it("updates a node in place and reports null in appliedNodeIds", () => {
    const { document, appliedNodeIds } = unwrapSuccess(
      applyCanvasOps(threadId, doc(note("n1")), [
        { _tag: "update", id: "n1", patch: { x: 10, y: 20, text: "edited" } },
      ]),
    );
    expect(document.nodes[0]).toMatchObject({ id: "n1", x: 10, y: 20, text: "edited" });
    expect(appliedNodeIds).toEqual([null]);
  });

  it("removes a node", () => {
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, doc(note("n1"), note("n2")), [{ _tag: "remove", id: "n1" }]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["n2"]);
  });

  it("reorders root siblings", () => {
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, doc(note("a"), note("b"), note("c")), [
        { _tag: "reorder", parentId: null, childIds: ["c", "a", "b"] },
      ]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["c", "a", "b"]);
  });

  it("rejects a duplicate node id with the failing op index", () => {
    const error = unwrapFailure(
      applyCanvasOps(threadId, doc(note("n1")), [add(note("n2")), add(note("n1"))]),
    );
    expect(error._tag).toBe("CanvasInvalidOpError");
    if (error._tag === "CanvasInvalidOpError") {
      expect(error.opIndex).toBe(1);
    }
  });

  it("rejects adding under a parent that is not a frame", () => {
    const error = unwrapFailure(
      applyCanvasOps(threadId, doc(note("n1")), [add(note("n2", { parentId: "n1" }))]),
    );
    expect(error._tag).toBe("CanvasInvalidOpError");
  });

  it("rejects adding under a missing parent", () => {
    const error = unwrapFailure(
      applyCanvasOps(threadId, doc(), [add(note("n1", { parentId: "ghost" }))]),
    );
    expect(error._tag).toBe("CanvasInvalidOpError");
  });

  it("inserts at the requested index among the parent's children", () => {
    const base = doc(frame("f"), note("a", { parentId: "f" }), note("b", { parentId: "f" }));
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, base, [add(note("c", { parentId: "f" }), 1)]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["f", "a", "c", "b"]);
  });

  it("appends when the index is past the end", () => {
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, doc(note("a")), [add(note("b"), 99)]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });

  it("enforces the node cap", () => {
    const nodes = Array.from({ length: CANVAS_MAX_NODES }, (_, index) => note(`n${index}`));
    const error = unwrapFailure(applyCanvasOps(threadId, doc(...nodes), [add(note("overflow"))]));
    expect(error._tag).toBe("CanvasLimitExceededError");
    if (error._tag === "CanvasLimitExceededError") {
      expect(error.limit).toBe("nodes");
    }
  });

  it("fails update and remove for missing nodes", () => {
    const updateError = unwrapFailure(
      applyCanvasOps(threadId, doc(), [{ _tag: "update", id: "ghost", patch: { x: 1 } }]),
    );
    expect(updateError._tag).toBe("CanvasNodeNotFoundError");

    const removeError = unwrapFailure(
      applyCanvasOps(threadId, doc(), [{ _tag: "remove", id: "ghost" }]),
    );
    expect(removeError._tag).toBe("CanvasNodeNotFoundError");
  });

  it("rejects patch keys the node type does not carry", () => {
    const rejected: ReadonlyArray<readonly [CanvasNode, Record<string, unknown>]> = [
      [image("target"), { text: "nope" }],
      [ink("target"), { width: 10 }],
      [ink("target"), { height: 10 }],
      [note("target"), { label: "nope" }],
      [region("target"), { strokeWidth: 3 }],
      [frame("target"), { color: "#fff" }],
    ];
    for (const [node, patch] of rejected) {
      const error = unwrapFailure(
        applyCanvasOps(threadId, doc(node), [{ _tag: "update", id: "target", patch }]),
      );
      expect(error._tag).toBe("CanvasInvalidOpError");
    }
  });

  it("re-parents into a frame and back to the root", () => {
    const base = doc(frame("f"), note("n1"));
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, base, [{ _tag: "update", id: "n1", patch: { parentId: "f" } }]),
    );
    expect(document.nodes[1]?.parentId).toBe("f");

    const { document: rootedBack } = unwrapSuccess(
      applyCanvasOps(threadId, document, [{ _tag: "update", id: "n1", patch: { parentId: null } }]),
    );
    expect(rootedBack.nodes[1]?.parentId).toBeUndefined();
  });

  it("rejects re-parenting onto a non-frame", () => {
    const error = unwrapFailure(
      applyCanvasOps(threadId, doc(note("n1"), note("n2")), [
        { _tag: "update", id: "n1", patch: { parentId: "n2" } },
      ]),
    );
    expect(error._tag).toBe("CanvasInvalidOpError");
  });

  it("rejects parentId cycles", () => {
    const base = doc(frame("a"), frame("b", { parentId: "a" }), frame("c", { parentId: "b" }));
    for (const parentId of ["c", "a"] as const) {
      const error = unwrapFailure(
        applyCanvasOps(threadId, base, [{ _tag: "update", id: "a", patch: { parentId } }]),
      );
      expect(error._tag).toBe("CanvasInvalidOpError");
    }
  });

  it("cascades remove through frame descendants", () => {
    const base = doc(
      frame("root-frame"),
      frame("inner", { parentId: "root-frame" }),
      note("leaf", { parentId: "inner" }),
      note("bystander"),
    );
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, base, [{ _tag: "remove", id: "root-frame" }]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["bystander"]);
  });

  it("rejects reorders that are not an exact permutation", () => {
    const base = doc(note("a"), note("b"));
    const badChildIds: ReadonlyArray<ReadonlyArray<string>> = [
      ["a"],
      ["a", "b", "c"],
      ["a", "ghost"],
      ["a", "a"],
    ];
    for (const childIds of badChildIds) {
      const error = unwrapFailure(
        applyCanvasOps(threadId, base, [{ _tag: "reorder", parentId: null, childIds }]),
      );
      expect(error._tag).toBe("CanvasInvalidOpError");
    }
  });

  it("reorders a frame's children without moving other nodes", () => {
    const base = doc(
      note("before"),
      frame("f"),
      note("a", { parentId: "f" }),
      note("between"),
      note("b", { parentId: "f" }),
    );
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, base, [{ _tag: "reorder", parentId: "f", childIds: ["b", "a"] }]),
    );
    expect(document.nodes.map((node) => node.id)).toEqual(["before", "f", "b", "between", "a"]);
  });

  it("keeps referential identity for untouched nodes", () => {
    const untouched = note("untouched");
    const edited = note("edited");
    const base = doc(untouched, edited);
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, base, [{ _tag: "update", id: "edited", patch: { x: 5 } }]),
    );
    expect(document.nodes[0]).toBe(untouched);
    expect(document.nodes[1]).not.toBe(edited);
  });

  it("aborts on the first failing op", () => {
    const result = applyCanvasOps(threadId, doc(), [
      add(note("n1")),
      { _tag: "remove", id: "ghost" },
      add(note("n2")),
    ]);
    const error = unwrapFailure(result);
    expect(error._tag).toBe("CanvasNodeNotFoundError");
  });

  it("clears an optional key when the patch sends null", () => {
    // The inverse of "set a name on a node that had none" must actually undo
    // it; undefined cannot survive JSON, so null is the clear sentinel.
    const named = note("n1", { name: "Hero" });
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, doc(named), [{ _tag: "update", id: "n1", patch: { name: null } }]),
    );
    expect(document.nodes[0]).not.toHaveProperty("name");
  });

  it("clears an optional note width but rejects clearing a required width", () => {
    const { document } = unwrapSuccess(
      applyCanvasOps(threadId, doc(note("n1", { width: 200 })), [
        { _tag: "update", id: "n1", patch: { width: null } },
      ]),
    );
    expect(document.nodes[0]).not.toHaveProperty("width");

    const error = unwrapFailure(
      applyCanvasOps(threadId, doc(image("i1")), [
        { _tag: "update", id: "i1", patch: { width: null } },
      ]),
    );
    expect(error._tag).toBe("CanvasInvalidOpError");
  });
});
