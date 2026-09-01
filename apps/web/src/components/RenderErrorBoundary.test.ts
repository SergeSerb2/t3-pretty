import { describe, expect, it } from "vite-plus/test";

import { renderErrorBoundaryResetKeysChanged } from "./RenderErrorBoundary";

describe("RenderErrorBoundary reset keys", () => {
  it("keeps the fallback stable for value-equivalent keys", () => {
    expect(renderErrorBoundaryResetKeysChanged(["line", "dark"], ["line", "dark"])).toBe(false);
  });

  it("allows a failed renderer to retry when its content changes", () => {
    expect(renderErrorBoundaryResetKeysChanged(["old", "dark"], ["new", "dark"])).toBe(true);
    expect(renderErrorBoundaryResetKeysChanged(undefined, ["new"])).toBe(true);
  });
});
