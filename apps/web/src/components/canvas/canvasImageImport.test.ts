import { describe, expect, it } from "vite-plus/test";

import { canvasImportableImageFiles } from "./canvasImageImport";

describe("canvasImportableImageFiles", () => {
  it("keeps provider-supported raster images", () => {
    const png = new File([""], "shot.png", { type: "image/png" });
    const jpeg = new File([""], "shot.jpg", { type: "image/jpeg" });
    const svg = new File([""], "icon.svg", { type: "image/svg+xml" });
    const text = new File([""], "notes.txt", { type: "text/plain" });
    expect(canvasImportableImageFiles([png, jpeg, svg, text]).map((file) => file.name)).toEqual([
      "shot.png",
      "shot.jpg",
    ]);
  });
});
