import { describe, expect, it } from "vite-plus/test";

import { normalizePersistedMotionState } from "./motionStore";

describe("normalizePersistedMotionState", () => {
  it("preserves a persisted boolean preference", () => {
    expect(normalizePersistedMotionState({ enabled: false })).toEqual({ enabled: false });
  });

  it("falls back for malformed state without carrying unknown fields", () => {
    expect(normalizePersistedMotionState({ enabled: "false", setEnabled: null })).toEqual({
      enabled: true,
    });
  });
});
