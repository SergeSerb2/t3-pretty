import { describe, expect, it } from "vite-plus/test";

import { rememberExploreProjectId, resolveExploreProjectId } from "./HomeScreen.logic";

describe("resolveExploreProjectId", () => {
  it("keeps the remembered project when it still exists", () => {
    expect(resolveExploreProjectId("beta", ["alpha", "beta", "gamma"])).toBe("beta");
  });

  it("falls back to the first project when nothing is remembered or the id is gone", () => {
    expect(resolveExploreProjectId(null, ["alpha", "beta"])).toBe("alpha");
    expect(resolveExploreProjectId("missing", ["alpha", "beta"])).toBe("alpha");
    expect(resolveExploreProjectId("alpha", [])).toBeNull();
  });
});

describe("rememberExploreProjectId", () => {
  it("stores the choice per environment without dropping the others", () => {
    expect(rememberExploreProjectId({ "env-a": "alpha" }, "env-b", "beta")).toEqual({
      "env-a": "alpha",
      "env-b": "beta",
    });
  });
});
