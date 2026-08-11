import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  CANVAS_MAX_INK_POINTS,
  CANVAS_MAX_NOTE_TEXT_LENGTH,
  CANVAS_MAX_OPS_PER_APPLY,
  CanvasApplyInput,
  CanvasDocument,
  CanvasError,
  CanvasEvent,
  CanvasNode,
  CanvasOp,
  emptyCanvasDocument,
  isCanvasError,
} from "./canvas.ts";

const decodeNode = Schema.decodeUnknownSync(CanvasNode);
const encodeNode = Schema.encodeSync(CanvasNode);
const decodeDocument = Schema.decodeUnknownSync(CanvasDocument);
const decodeOp = Schema.decodeUnknownSync(CanvasOp);
const decodeApplyInput = Schema.decodeUnknownSync(CanvasApplyInput);
const decodeEvent = Schema.decodeUnknownSync(CanvasEvent);
const decodeError = Schema.decodeUnknownSync(CanvasError);

describe("CanvasNode", () => {
  it("round-trips a frame", () => {
    const frame = {
      id: "frame-1",
      name: "Hero",
      type: "frame",
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    };
    expect(encodeNode(decodeNode(frame))).toEqual(frame);
  });

  it("round-trips an image with a window source ref", () => {
    const image = {
      id: "image-1",
      parentId: "frame-1",
      type: "image",
      x: 24,
      y: 24,
      width: 640,
      height: 400,
      attachmentId: "attachment-1",
      naturalWidth: 1280,
      naturalHeight: 800,
      sourceRef: {
        kind: "window",
        sourceId: "window:123:0",
        appName: "Safari",
        windowTitle: "Docs",
      },
    };
    expect(encodeNode(decodeNode(image))).toEqual(image);
  });

  it("round-trips an ink stroke with node-relative points", () => {
    const ink = {
      id: "ink-1",
      type: "ink",
      x: 100,
      y: 100,
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 8 },
        { x: 20, y: 30 },
      ],
      color: "#ff3b30",
      strokeWidth: 3,
    };
    expect(encodeNode(decodeNode(ink))).toEqual(ink);
  });

  it("round-trips a region with label and color", () => {
    const region = {
      id: "region-1",
      parentId: "frame-1",
      type: "region",
      x: 10,
      y: 20,
      width: 320,
      height: 200,
      label: "Fix this button",
      color: "#0a84ff",
    };
    expect(encodeNode(decodeNode(region))).toEqual(region);
  });

  it("round-trips a note", () => {
    const note = {
      id: "note-1",
      type: "note",
      x: -40,
      y: 640,
      text: "Try a warmer background here.",
      color: "#ffd60a",
      width: 240,
    };
    expect(encodeNode(decodeNode(note))).toEqual(note);
  });

  it("rejects ink strokes with more points than the cap", () => {
    expect(() =>
      decodeNode({
        id: "ink-2",
        type: "ink",
        x: 0,
        y: 0,
        points: Array.from({ length: CANVAS_MAX_INK_POINTS + 1 }, (_, index) => ({
          x: index,
          y: index,
        })),
        color: "#000000",
        strokeWidth: 1,
      }),
    ).toThrow();
  });

  it("rejects notes with text over the cap", () => {
    expect(() =>
      decodeNode({
        id: "note-2",
        type: "note",
        x: 0,
        y: 0,
        text: "a".repeat(CANVAS_MAX_NOTE_TEXT_LENGTH + 1),
      }),
    ).toThrow();
  });
});

describe("CanvasOp", () => {
  it("decodes each op kind", () => {
    expect(
      decodeOp({
        _tag: "add",
        node: { id: "note-1", type: "note", x: 0, y: 0, text: "hi" },
        index: 0,
      })._tag,
    ).toBe("add");
    expect(
      decodeOp({
        _tag: "add-image",
        node: { id: "image-1", type: "image", x: 0, y: 0, width: 100, height: 100 },
        image: { kind: "workspace-file", path: "assets/logo.png" },
      })._tag,
    ).toBe("add-image");
    expect(decodeOp({ _tag: "update", id: "note-1", patch: { x: 10, parentId: null } })).toEqual({
      _tag: "update",
      id: "note-1",
      patch: { x: 10, parentId: null },
    });
    expect(decodeOp({ _tag: "remove", id: "note-1" })._tag).toBe("remove");
    expect(decodeOp({ _tag: "reorder", parentId: null, childIds: ["note-1", "frame-1"] })).toEqual({
      _tag: "reorder",
      parentId: null,
      childIds: ["note-1", "frame-1"],
    });
  });

  it("rejects an unknown op tag", () => {
    expect(() => decodeOp({ _tag: "explode", id: "note-1" })).toThrow();
  });

  it("rejects apply batches with more ops than the cap", () => {
    expect(() =>
      decodeApplyInput({
        threadId: "thread-1",
        baseRevision: 0,
        ops: Array.from({ length: CANVAS_MAX_OPS_PER_APPLY + 1 }, (_, index) => ({
          _tag: "remove",
          id: `node-${index}`,
        })),
      }),
    ).toThrow();
  });
});

describe("CanvasEvent", () => {
  it("decodes snapshot", () => {
    const event = decodeEvent({
      type: "snapshot",
      threadId: "thread-1",
      serverEpoch: "server-a",
      revision: 0,
      document: { schemaVersion: 1, nodes: [] },
      selectedNodeIds: [],
    });
    expect(event.type).toBe("snapshot");
  });

  it("decodes applied with origin", () => {
    const event = decodeEvent({
      type: "applied",
      threadId: "thread-1",
      serverEpoch: "server-a",
      revision: 3,
      ops: [{ _tag: "remove", id: "note-1" }],
      origin: "agent",
    });
    expect(event.type).toBe("applied");
    if (event.type === "applied") {
      expect(event.origin).toBe("agent");
    }
  });

  it("decodes selection", () => {
    const event = decodeEvent({
      type: "selection",
      threadId: "thread-1",
      serverEpoch: "server-a",
      revision: 3,
      selectedNodeIds: ["note-1"],
    });
    expect(event.type).toBe("selection");
    if (event.type === "selection") {
      expect(event.selectedNodeIds).toEqual(["note-1"]);
    }
  });
});

describe("CanvasError", () => {
  it("guards decoded canvas errors and exposes typed messages", () => {
    const error = decodeError({
      _tag: "CanvasRevisionConflictError",
      threadId: "thread-1",
      baseRevision: 3,
      currentRevision: 5,
    });
    expect(isCanvasError(error)).toBe(true);
    expect(error._tag).toBe("CanvasRevisionConflictError");
    if (error._tag === "CanvasRevisionConflictError") {
      expect(error.message).toBe(
        "Canvas apply was based on revision 3, but the current revision is 5.",
      );
    }
  });

  it("rejects non-canvas values", () => {
    expect(isCanvasError(new Error("boom"))).toBe(false);
    expect(isCanvasError({ _tag: "CanvasRevisionConflictError" })).toBe(false);
  });
});

describe("emptyCanvasDocument", () => {
  it("produces a valid document", () => {
    expect(decodeDocument(emptyCanvasDocument())).toEqual({ schemaVersion: 1, nodes: [] });
  });
});
