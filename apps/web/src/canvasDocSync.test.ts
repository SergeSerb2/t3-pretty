import type {
  CanvasDocument,
  CanvasFrameNode,
  CanvasImageNode,
  CanvasInkNode,
  CanvasNode,
  CanvasNoteNode,
  CanvasOp,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyOps,
  bringToFront,
  canvasImageAttachmentResources,
  childrenOf,
  contentBounds,
  descendantIds,
  getNode,
  invertOps,
  isPendingImageNode,
  pruneDescendantIds,
  sendToBack,
  worldRectOf,
} from "./canvasDocSync";

const frame = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): CanvasFrameNode => ({
  id,
  type: "frame",
  x,
  y,
  width,
  height,
  ...(parentId === undefined ? {} : { parentId }),
});

const image = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): CanvasImageNode => ({
  id,
  type: "image",
  x,
  y,
  width,
  height,
  attachmentId: "att-1",
  ...(parentId === undefined ? {} : { parentId }),
});

const note = (
  id: string,
  x: number,
  y: number,
  text = "note",
  parentId?: string,
): CanvasNoteNode => ({
  id,
  type: "note",
  x,
  y,
  text,
  ...(parentId === undefined ? {} : { parentId }),
});

const ink = (
  id: string,
  x: number,
  y: number,
  points: { x: number; y: number }[],
  strokeWidth = 2,
  parentId?: string,
): CanvasInkNode => ({
  id,
  type: "ink",
  x,
  y,
  points,
  color: "#f00",
  strokeWidth,
  ...(parentId === undefined ? {} : { parentId }),
});

const doc = (...nodes: CanvasNode[]): CanvasDocument => ({ schemaVersion: 1, nodes });

const ids = (document: CanvasDocument): string[] => document.nodes.map((node) => node.id);

describe("applyOps", () => {
  it("appends a new root node without touching existing node identities", () => {
    const a = note("a", 0, 0);
    const before = doc(a);
    const b = note("b", 10, 10);
    const after = applyOps(before, [{ _tag: "add", node: b }]);
    expect(ids(after)).toEqual(["a", "b"]);
    expect(after.nodes[0]).toBe(a);
    expect(before.nodes).toHaveLength(1);
  });

  it("inserts at the requested sibling index", () => {
    const before = doc(note("a", 0, 0), note("b", 0, 0));
    const after = applyOps(before, [{ _tag: "add", node: note("c", 0, 0), index: 0 }]);
    expect(ids(after)).toEqual(["c", "a", "b"]);
  });

  it("appends a frame child after the parent's subtree", () => {
    const before = doc(
      frame("f1", 0, 0, 100, 100),
      image("i1", 0, 0, 10, 10, "f1"),
      note("r1", 0, 0),
    );
    const after = applyOps(before, [{ _tag: "add", node: note("n2", 0, 0, "hi", "f1") }]);
    expect(ids(after)).toEqual(["f1", "i1", "n2", "r1"]);
  });

  it("replaces an existing id in place and double-apply keeps the doc reference", () => {
    const before = doc(note("a", 0, 0), note("b", 0, 0));
    const replacement = note("a", 42, 0);
    const ops: CanvasOp[] = [{ _tag: "add", node: replacement }];
    const once = applyOps(before, ops);
    expect(ids(once)).toEqual(["a", "b"]);
    expect(once.nodes[0]).toBe(replacement);
    expect(once.nodes[1]).toBe(before.nodes[1]);
    expect(applyOps(once, ops)).toBe(once);
  });

  it("materializes add-image with an empty attachmentId sentinel", () => {
    const after = applyOps(doc(), [
      {
        _tag: "add-image",
        node: { id: "img-1", type: "image", x: 5, y: 6, width: 40, height: 30 },
        image: { kind: "dataUrl", dataUrl: "data:image/png;base64,AAAA" },
      },
    ]);
    expect(after.nodes[0]).toEqual({
      id: "img-1",
      type: "image",
      x: 5,
      y: 6,
      width: 40,
      height: 30,
      attachmentId: "",
    });
    expect(isPendingImageNode(after.nodes[0]!)).toBe(true);
    expect(
      canvasImageAttachmentResources(
        after.nodes.filter((node): node is CanvasImageNode => node.type === "image"),
      ),
    ).toEqual([]);
    expect(
      applyOps(after, [
        {
          _tag: "add-image",
          node: { id: "img-1", type: "image", x: 5, y: 6, width: 40, height: 30 },
          image: { kind: "dataUrl", dataUrl: "data:image/png;base64,AAAA" },
        },
      ]),
    ).toBe(after);
  });

  it("shallow-merges update patches and ignores missing ids", () => {
    const before = doc(note("a", 0, 0, "hello"));
    const after = applyOps(before, [{ _tag: "update", id: "a", patch: { x: 7, color: "#0f0" } }]);
    expect(after.nodes[0]).toEqual({
      id: "a",
      type: "note",
      x: 7,
      y: 0,
      text: "hello",
      color: "#0f0",
    });
    expect(applyOps(after, [{ _tag: "update", id: "missing", patch: { x: 1 } }])).toBe(after);
  });

  it("treats a same-value update as a no-op returning the same doc reference", () => {
    const before = doc(note("a", 3, 4));
    expect(applyOps(before, [{ _tag: "update", id: "a", patch: { x: 3, y: 4 } }])).toBe(before);
  });

  it("removes parentId when the patch sets it to null", () => {
    const before = doc(frame("f1", 0, 0, 10, 10), note("a", 1, 2, "n", "f1"));
    const after = applyOps(before, [{ _tag: "update", id: "a", patch: { parentId: null } }]);
    expect(after.nodes[1]).toStrictEqual(note("a", 1, 2, "n"));
  });

  it("cascades remove through nested descendants and ignores missing ids", () => {
    const before = doc(
      frame("f1", 0, 0, 100, 100),
      frame("f2", 0, 0, 50, 50, "f1"),
      image("i1", 0, 0, 10, 10, "f2"),
      note("r1", 0, 0),
    );
    const after = applyOps(before, [{ _tag: "remove", id: "f1" }]);
    expect(ids(after)).toEqual(["r1"]);
    expect(applyOps(after, [{ _tag: "remove", id: "f1" }])).toBe(after);
  });

  it("reorders tolerantly: missing ids ignored, unmentioned children keep order after mentioned", () => {
    const before = doc(note("a", 0, 0), note("b", 0, 0), note("c", 0, 0));
    const after = applyOps(before, [
      { _tag: "reorder", parentId: null, childIds: ["c", "ghost", "a"] },
    ]);
    expect(ids(after)).toEqual(["c", "a", "b"]);
    expect(applyOps(after, [{ _tag: "reorder", parentId: null, childIds: ["c", "a", "b"] }])).toBe(
      after,
    );
  });

  it("ignores unknown op tags", () => {
    const before = doc(note("a", 0, 0));
    expect(applyOps(before, [{ _tag: "sparkle" } as unknown as CanvasOp])).toBe(before);
  });

  it("returns the same doc reference for an empty batch", () => {
    const before = doc(note("a", 0, 0));
    expect(applyOps(before, [])).toBe(before);
  });
});

describe("invertOps", () => {
  const fixtures: { name: string; document: CanvasDocument; ops: CanvasOp[] }[] = [
    {
      name: "root add",
      document: doc(note("a", 0, 0)),
      ops: [{ _tag: "add", node: note("b", 5, 5) }],
    },
    {
      name: "replace-add of an existing id",
      document: doc(note("a", 0, 0, "old"), note("b", 1, 1)),
      ops: [{ _tag: "add", node: note("a", 9, 9, "new") }],
    },
    {
      name: "add-image of a new node",
      document: doc(note("a", 0, 0)),
      ops: [
        {
          _tag: "add-image",
          node: { id: "img-1", type: "image", x: 0, y: 0, width: 10, height: 10 },
          image: { kind: "attachment", attachmentId: "att-9" },
        },
      ],
    },
    {
      name: "update introducing keys the node lacked",
      document: doc(note("a", 0, 0)),
      ops: [{ _tag: "update", id: "a", patch: { x: 5, name: "Named", color: "#00f" } }],
    },
    {
      name: "reparent into a sibling frame",
      document: doc(
        frame("f1", 0, 0, 100, 100),
        frame("f2", 200, 0, 100, 100),
        note("n", 1, 2, "n", "f1"),
      ),
      ops: [{ _tag: "update", id: "n", patch: { parentId: "f2", x: 0 } }],
    },
    {
      name: "reparent to the root",
      document: doc(frame("f1", 0, 0, 100, 100), note("n", 1, 2, "n", "f1")),
      ops: [{ _tag: "update", id: "n", patch: { parentId: null } }],
    },
    {
      name: "remove cascading through nested frames",
      document: doc(
        frame("f1", 0, 0, 100, 100),
        frame("f2", 10, 10, 50, 50, "f1"),
        image("i1", 0, 0, 10, 10, "f2"),
        note("n1", 5, 5, "n", "f1"),
        note("r1", 300, 0),
      ),
      ops: [{ _tag: "remove", id: "f1" }],
    },
    {
      name: "reorder",
      document: doc(note("a", 0, 0), note("b", 0, 0), note("c", 0, 0)),
      ops: [{ _tag: "reorder", parentId: null, childIds: ["c", "b", "a"] }],
    },
    {
      name: "mixed batch",
      document: doc(
        frame("f1", 0, 0, 100, 100),
        ink(
          "s1",
          5,
          5,
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          2,
          "f1",
        ),
        note("a", 0, 0),
        note("b", 0, 0),
      ),
      ops: [
        { _tag: "add", node: note("n2", 50, 50) },
        { _tag: "update", id: "a", patch: { x: 99, name: "moved" } },
        { _tag: "remove", id: "f1" },
      ],
    },
  ];

  for (const fixture of fixtures) {
    it(`round-trips ${fixture.name}`, () => {
      const applied = applyOps(fixture.document, fixture.ops);
      const inverse = invertOps(fixture.document, fixture.ops);
      expect(applyOps(applied, inverse)).toStrictEqual(fixture.document);
    });
  }

  it("restores an absent optional key instead of leaving the patched value", () => {
    const document = doc(note("a", 0, 0));
    const ops: CanvasOp[] = [{ _tag: "update", id: "a", patch: { name: "Named" } }];
    const applied = applyOps(document, ops);
    expect((applied.nodes[0] as CanvasNoteNode).name).toBe("Named");
    const restored = applyOps(applied, invertOps(document, ops));
    expect(Object.keys(restored.nodes[0]!)).not.toContain("name");
  });

  it("inverts a reorder to the prior full child order", () => {
    const document = doc(note("a", 0, 0), note("b", 0, 0), note("c", 0, 0));
    expect(invertOps(document, [{ _tag: "reorder", parentId: null, childIds: ["b"] }])).toEqual([
      { _tag: "reorder", parentId: null, childIds: ["a", "b", "c"] },
    ]);
  });
});

describe("helpers", () => {
  const nested = doc(
    frame("f1", 100, 50, 300, 200),
    image("i1", 10, 20, 30, 40, "f1"),
    ink(
      "s1",
      5,
      5,
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      2,
      "f1",
    ),
    note("n1", 400, 0),
  );

  it("getNode and childrenOf preserve document order", () => {
    expect(getNode(nested, "i1")?.type).toBe("image");
    expect(getNode(nested, "ghost")).toBeNull();
    expect(childrenOf(nested, "f1").map((node) => node.id)).toEqual(["i1", "s1"]);
    expect(childrenOf(nested, null).map((node) => node.id)).toEqual(["f1", "n1"]);
  });

  it("descendantIds walks nested subtrees", () => {
    const deep = doc(
      frame("f1", 0, 0, 10, 10),
      frame("f2", 0, 0, 5, 5, "f1"),
      note("n", 0, 0, "n", "f2"),
      note("r", 0, 0),
    );
    expect(descendantIds(deep, "f1")).toEqual(["f2", "n"]);
    expect(descendantIds(deep, "r")).toEqual([]);
  });

  it("worldRectOf accumulates parent offsets", () => {
    expect(worldRectOf(nested, "i1")).toEqual({ x: 110, y: 70, width: 30, height: 40 });
  });

  it("worldRectOf derives ink bounds from stroke points and width", () => {
    // strokeBounds pads by strokeWidth + 3 = 5 around the 10x10 point extent.
    expect(worldRectOf(nested, "s1")).toEqual({ x: 100, y: 50, width: 20, height: 20 });
  });

  it("worldRectOf sizes notes from defaults or measured overlay", () => {
    expect(worldRectOf(nested, "n1")).toEqual({ x: 400, y: 0, width: 160, height: 100 });
    const measured = new Map([["n1", { width: 220, height: 64 }]]);
    expect(worldRectOf(nested, "n1", measured)).toEqual({ x: 400, y: 0, width: 220, height: 64 });
  });

  it("contentBounds unions world rects", () => {
    // f1 spans (100,50)-(400,250); n1 spans (400,0)-(560,100).
    const bounds = contentBounds(nested);
    expect(bounds).toEqual({ x: 100, y: 0, width: 460, height: 250 });
    expect(contentBounds(doc())).toBeNull();
  });

  it("bringToFront emits per-parent reorder ops and applies to the top", () => {
    const document = doc(
      note("a", 0, 0),
      note("b", 0, 0),
      frame("f1", 0, 0, 10, 10),
      note("c1", 0, 0, "c1", "f1"),
      note("c2", 0, 0, "c2", "f1"),
    );
    const ops = bringToFront(document, ["a", "c1"]);
    expect(ops).toEqual([
      { _tag: "reorder", parentId: null, childIds: ["b", "f1", "a"] },
      { _tag: "reorder", parentId: "f1", childIds: ["c2", "c1"] },
    ]);
    const after = applyOps(document, ops);
    expect(childrenOf(after, null).map((node) => node.id)).toEqual(["b", "f1", "a"]);
    expect(childrenOf(after, "f1").map((node) => node.id)).toEqual(["c2", "c1"]);
  });

  it("sendToBack moves ids below their siblings and skips no-op parents", () => {
    const document = doc(note("a", 0, 0), note("b", 0, 0), note("c", 0, 0));
    expect(sendToBack(document, ["c"])).toEqual([
      { _tag: "reorder", parentId: null, childIds: ["c", "a", "b"] },
    ]);
    expect(sendToBack(document, ["a"])).toEqual([]);
  });
});

describe("pruneDescendantIds", () => {
  it("drops ids whose ancestor is also listed, keeping order", () => {
    const document = doc(
      frame("outer", 0, 0, 400, 400),
      frame("inner", 10, 10, 100, 100, "outer"),
      note("child", 5, 5, "child", "inner"),
      note("free", 300, 300, "free"),
    );
    expect(pruneDescendantIds(document, ["child", "outer", "free"])).toEqual(["outer", "free"]);
    expect(pruneDescendantIds(document, ["inner", "child"])).toEqual(["inner"]);
    expect(pruneDescendantIds(document, ["child", "free"])).toEqual(["child", "free"]);
  });

  it("drops duplicates and unknown ids", () => {
    const document = doc(note("a", 0, 0, "a"));
    expect(pruneDescendantIds(document, ["a", "a", "missing"])).toEqual(["a"]);
    expect(pruneDescendantIds(document, [])).toEqual([]);
  });
});

describe("canvasImageAttachmentResources", () => {
  it("omits pending captures whose attachmentId is still the empty sentinel", () => {
    const pending: CanvasImageNode = { ...image("pending", 0, 0, 10, 10), attachmentId: "" };
    const ready = image("ready", 0, 0, 10, 10);
    expect(isPendingImageNode(pending)).toBe(true);
    expect(isPendingImageNode(ready)).toBe(false);
    expect(canvasImageAttachmentResources([pending, ready])).toEqual([
      { _tag: "attachment", attachmentId: "att-1" },
    ]);
  });
});
