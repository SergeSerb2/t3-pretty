import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  anyEnvironmentSupportsCanvas,
  canvasFirstSendNodeIds,
  canvasFirstTitleSeed,
  environmentSupportsCanvas,
} from "./canvasFirst";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

describe("canvasFirstSendNodeIds", () => {
  const doc = {
    schemaVersion: 1 as const,
    nodes: [
      { id: "a", type: "note" as const, x: 0, y: 0, text: "one" },
      { id: "b", type: "note" as const, x: 10, y: 10, text: "two" },
    ],
  };

  it("uses the current selection when it still exists in the document", () => {
    expect(canvasFirstSendNodeIds(doc, ["b", "missing"])).toEqual(["b"]);
  });

  it("falls back to every node when nothing is selected", () => {
    expect(canvasFirstSendNodeIds(doc, [])).toEqual(["a", "b"]);
  });
});

describe("canvasFirstTitleSeed", () => {
  it("prefers the first line of the note", () => {
    expect(
      canvasFirstTitleSeed({
        note: "Tighten the hero\nmore detail",
        nodes: [{ id: "n", type: "image", name: "Landing" }],
      }),
    ).toBe("Tighten the hero");
  });

  it("uses the first named node when there is no note", () => {
    expect(
      canvasFirstTitleSeed({
        note: "  ",
        nodes: [
          { id: "ink", type: "ink" },
          { id: "shot", type: "image", name: "Settings" },
        ],
      }),
    ).toBe("Settings");
  });

  it("falls back to Canvas", () => {
    expect(canvasFirstTitleSeed({ note: "", nodes: [{ id: "n", type: "ink" }] })).toBe("Canvas");
  });
});

describe("environmentSupportsCanvas", () => {
  it("is true only when the environment advertises the canvas capability", () => {
    const configs = new Map([
      [ENVIRONMENT_ID, { environment: { capabilities: { canvas: true } } } as never],
    ]);
    expect(environmentSupportsCanvas(configs, ENVIRONMENT_ID)).toBe(true);
    expect(environmentSupportsCanvas(new Map(), ENVIRONMENT_ID)).toBe(false);
    expect(anyEnvironmentSupportsCanvas(configs)).toBe(true);
    expect(anyEnvironmentSupportsCanvas(new Map())).toBe(false);
  });
});
