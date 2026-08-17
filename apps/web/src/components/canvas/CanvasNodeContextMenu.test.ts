import { describe, expect, it } from "vite-plus/test";

import { canvasNodeContextMenuItems } from "./CanvasNodeContextMenu";

describe("canvasNodeContextMenuItems", () => {
  it("always offers z-order and delete", () => {
    expect(canvasNodeContextMenuItems({ nodeType: "ink", canRecapture: false })).toEqual([
      { id: "bring-to-front", label: "Bring to front" },
      { id: "send-to-back", label: "Send to back" },
      { id: "delete", label: "Delete", destructive: true, icon: "trash" },
    ]);
  });

  it("offers rename on named node types and recapture when the origin can refresh", () => {
    expect(
      canvasNodeContextMenuItems({ nodeType: "image", canRecapture: true }).map((item) => item.id),
    ).toEqual(["bring-to-front", "send-to-back", "recapture", "rename", "delete"]);
    expect(
      canvasNodeContextMenuItems({ nodeType: "region", canRecapture: false }).map(
        (item) => item.id,
      ),
    ).toEqual(["bring-to-front", "send-to-back", "delete"]);
  });
});
