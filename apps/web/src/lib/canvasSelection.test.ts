import { describe, expect, it } from "vite-plus/test";

import {
  appendCanvasSelectionPrompt,
  buildCanvasSelectionPrompt,
  canvasSelectionImageName,
  extractTrailingCanvasSelection,
  type CanvasSelectionContext,
} from "./canvasSelection";

const selection: CanvasSelectionContext = {
  id: "selection_1",
  docRevision: 7,
  comment: "Tighten the hero spacing.",
  nodes: [
    {
      id: "node_frame",
      type: "frame",
      name: "Hero",
      width: 320,
      height: 200,
    },
    {
      id: "node_image",
      type: "image",
      width: 640.4,
      height: 480.6,
      source: "preview tab http://localhost:3000/",
    },
    { id: "node_ink", type: "ink" },
  ],
};

const bareSelection: CanvasSelectionContext = {
  id: "selection_2",
  docRevision: 8,
  nodes: [{ id: "node_note", type: "note" }],
};

describe("canvas selections", () => {
  it("describes the selection with per-node size and source detail", () => {
    const result = buildCanvasSelectionPrompt(selection);
    expect(result).toContain("Id: selection_1");
    expect(result).toContain("Doc revision: 7");
    expect(result).toContain("Comment: Tighten the hero spacing.");
    expect(result).toContain("Nodes: 3 selected");
    expect(result).toContain('- frame "Hero" (node_frame, 320x200)');
    expect(result).toContain("- image (node_image, 640x481) — source: preview tab");
    expect(result).toContain("- ink (node_ink)");
    expect(result).toContain("canvas-selection-selection_1.png");
  });

  it("omits the comment line and node detail parts when absent", () => {
    const result = buildCanvasSelectionPrompt(bareSelection);
    expect(result).not.toContain("Comment:");
    expect(result).toContain("Nodes: 1 selected");
    expect(result).toContain("- note (node_note)");
    expect(result).not.toContain("source:");
  });

  it("appends to an existing composer prompt", () => {
    expect(
      appendCanvasSelectionPrompt("Fix this", selection).startsWith(
        "Fix this\n\n<canvas_selection>",
      ),
    ).toBe(true);
    expect(appendCanvasSelectionPrompt("  ", selection).startsWith("<canvas_selection>")).toBe(
      true,
    );
  });

  it("round-trips a selection through append and extract", () => {
    const extracted = extractTrailingCanvasSelection(
      appendCanvasSelectionPrompt("Fix this", selection),
    );
    expect(extracted?.text).toBe("Fix this");
    expect(extracted?.selection).toMatchObject({
      id: "selection_1",
      docRevision: 7,
      comment: "Tighten the hero spacing.",
      nodeCount: 3,
    });
    expect(extracted?.selection.nodes).toEqual([
      { id: "node_frame", type: "frame", name: "Hero", width: 320, height: 200 },
      {
        id: "node_image",
        type: "image",
        width: 640,
        height: 481,
        source: "preview tab http://localhost:3000/",
      },
      { id: "node_ink", type: "ink" },
    ]);
  });

  it("extracts multiple trailing selections one at a time", () => {
    const first = appendCanvasSelectionPrompt("Fix this", selection);
    const second = appendCanvasSelectionPrompt(first, bareSelection);
    const extractedSecond = extractTrailingCanvasSelection(second);
    expect(extractedSecond?.selection.id).toBe("selection_2");
    expect(extractedSecond?.selection.comment).toBe("");
    const extractedFirst = extractTrailingCanvasSelection(extractedSecond?.text ?? "");
    expect(extractedFirst?.selection.id).toBe("selection_1");
    expect(extractedFirst?.text).toBe("Fix this");
  });

  it("returns null for prompts without a trailing selection block", () => {
    expect(extractTrailingCanvasSelection("Fix this")).toBeNull();
    expect(
      extractTrailingCanvasSelection(
        `${appendCanvasSelectionPrompt("Fix this", selection)}\n\nP.S.`,
      ),
    ).toBeNull();
  });

  it("names selection screenshots by selection id", () => {
    expect(canvasSelectionImageName("selection_1")).toBe("canvas-selection-selection_1.png");
  });
});
