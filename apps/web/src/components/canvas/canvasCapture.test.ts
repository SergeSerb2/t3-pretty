import type { CanvasImageNode, DesktopCaptureSource } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCapturePlacement,
  buildRecaptureOps,
  captureWorldCenter,
  fitCaptureWorldSize,
  groupCaptureSources,
  isRecapturableImageNode,
  matchWindowCaptureSources,
  preferredCaptureTab,
  previewTabSourceRef,
  windowSourceRef,
  type CanvasCaptureTab,
} from "./canvasCapture";

const tab = (overrides: Partial<CanvasCaptureTab> = {}): CanvasCaptureTab => ({
  tabId: "tab-1",
  runtimeTabId: "runtime-1",
  title: "Dashboard",
  url: "https://example.test/app",
  active: false,
  ...overrides,
});

const source = (overrides: Partial<DesktopCaptureSource> = {}): DesktopCaptureSource =>
  ({
    sourceId: "window:1:0",
    kind: "window",
    name: "Preview",
    appName: "Safari",
    appIconDataUrl: null,
    thumbnailDataUrl: "data:image/png;base64,",
    thumbnailWidth: 320,
    thumbnailHeight: 180,
    displayId: null,
    ...overrides,
  }) as DesktopCaptureSource;

describe("fitCaptureWorldSize", () => {
  it("scales the longest side down to the budget", () => {
    expect(fitCaptureWorldSize({ width: 1280, height: 720 }, 640)).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("never upscales a small capture", () => {
    expect(fitCaptureWorldSize({ width: 100, height: 50 }, 640)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("falls back to the budget for degenerate dimensions", () => {
    expect(fitCaptureWorldSize({ width: 0, height: Number.NaN }, 640)).toEqual({
      width: 640,
      height: 640,
    });
  });
});

describe("captureWorldCenter", () => {
  const viewport = { tx: -100, ty: -50, scale: 2 };

  it("uses the world point under the viewport center when measured", () => {
    expect(captureWorldCenter(viewport, { width: 800, height: 600 }, null)).toEqual({
      x: (400 + 100) / 2,
      y: (300 + 50) / 2,
    });
  });

  it("places past the content edge when the viewport is unmeasured", () => {
    expect(captureWorldCenter(viewport, null, { x: 0, y: 0, width: 200, height: 100 })).toEqual({
      x: 248,
      y: 50,
    });
  });

  it("falls back to the origin on an empty canvas", () => {
    expect(captureWorldCenter(viewport, null, null)).toEqual({ x: 0, y: 0 });
  });
});

describe("preferredCaptureTab", () => {
  it("prefers the active tab", () => {
    const active = tab({ tabId: "tab-2", active: true });
    expect(preferredCaptureTab([tab(), active])?.tabId).toBe("tab-2");
  });

  it("falls back to the most recent tab", () => {
    expect(preferredCaptureTab([tab(), tab({ tabId: "tab-3" })])?.tabId).toBe("tab-3");
  });

  it("returns null without tabs", () => {
    expect(preferredCaptureTab([])).toBeNull();
  });
});

describe("buildCapturePlacement", () => {
  it("centers the scaled bitmap on the target point", () => {
    const { nodeId, op } = buildCapturePlacement({
      id: "node-1",
      image: { dataUrl: "data:image/png;base64,AAA", width: 1280, height: 720 },
      name: "  Dashboard  ",
      sourceRef: previewTabSourceRef(tab()),
      center: { x: 100, y: 100 },
    });
    expect(nodeId).toBe("node-1");
    expect(op._tag).toBe("add-image");
    if (op._tag !== "add-image") throw new Error("expected add-image");
    expect(op.node).toMatchObject({
      id: "node-1",
      type: "image",
      x: -220,
      y: -80,
      width: 640,
      height: 360,
      name: "Dashboard",
      naturalWidth: 1280,
      naturalHeight: 720,
    });
    expect(op.image).toEqual({ kind: "dataUrl", dataUrl: "data:image/png;base64,AAA" });
  });
});

describe("buildRecaptureOps", () => {
  const node: CanvasImageNode = {
    id: "node-1",
    type: "image",
    x: 10,
    y: 20,
    width: 400,
    height: 300,
    attachmentId: "att-1",
    name: "Window",
    sourceRef: { kind: "window", sourceId: "window:1:0", windowTitle: "Window" },
  } as CanvasImageNode;

  it("removes then re-adds the node so the id is free", () => {
    const ops = buildRecaptureOps({
      node,
      image: { dataUrl: "data:image/png;base64,BBB", width: 800, height: 800 },
      sourceRef: { kind: "window", sourceId: "window:9:0", windowTitle: "Window" },
    });
    expect(ops[0]).toEqual({ _tag: "remove", id: "node-1" });
    const add = ops[1];
    if (add === undefined || add._tag !== "add-image") throw new Error("expected add-image");
    // Placed width is preserved; height follows the new aspect ratio.
    expect(add.node).toMatchObject({ id: "node-1", x: 10, y: 20, width: 400, height: 400 });
  });
});

describe("matchWindowCaptureSources", () => {
  const sources = [
    source({ sourceId: "window:2:0", name: "Preview", appName: "Safari" }),
    source({ sourceId: "window:3:0", name: "Preview", appName: "Chrome" }),
    source({ sourceId: "window:4:0", name: "Notes", appName: "Notes" }),
  ];

  it("matches on title and app name together", () => {
    const matches = matchWindowCaptureSources(sources, {
      kind: "window",
      sourceId: "stale",
      appName: "Chrome",
      windowTitle: "preview",
    });
    expect(matches.map((entry) => entry.sourceId)).toEqual(["window:3:0"]);
  });

  it("returns every title match when no app name was recorded", () => {
    const matches = matchWindowCaptureSources(sources, {
      kind: "window",
      sourceId: "stale",
      windowTitle: "Preview",
    });
    expect(matches).toHaveLength(2);
  });

  it("matches nothing without any recorded identity", () => {
    expect(matchWindowCaptureSources(sources, { kind: "window", sourceId: "stale" })).toEqual([]);
  });
});

describe("groupCaptureSources", () => {
  it("splits windows from screens", () => {
    const grouped = groupCaptureSources([
      source(),
      source({ sourceId: "screen:0:0", kind: "screen", name: "Display 1" }),
    ]);
    expect(grouped.windows).toHaveLength(1);
    expect(grouped.screens).toHaveLength(1);
  });
});

describe("source refs", () => {
  it("omits an empty tab url", () => {
    expect(previewTabSourceRef({ tabId: "tab-1", url: null })).toEqual({
      kind: "preview-tab",
      tabId: "tab-1",
    });
  });

  it("keeps the window identity used for re-matching", () => {
    expect(
      windowSourceRef({ sourceId: "window:1:0", name: " Notes ", appName: " Notes " }),
    ).toEqual({ kind: "window", sourceId: "window:1:0", appName: "Notes", windowTitle: "Notes" });
  });
});

describe("isRecapturableImageNode", () => {
  it("accepts captured images and rejects agent or non-image nodes", () => {
    expect(
      isRecapturableImageNode({ type: "image", sourceRef: { kind: "window", sourceId: "a" } }),
    ).toBe(true);
    expect(isRecapturableImageNode({ type: "image", sourceRef: { kind: "agent" } })).toBe(false);
    expect(isRecapturableImageNode({ type: "image" })).toBe(false);
    expect(isRecapturableImageNode({ type: "note" })).toBe(false);
    expect(isRecapturableImageNode(null)).toBe(false);
  });
});
