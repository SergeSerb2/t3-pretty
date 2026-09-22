import { describe, expect, it } from "vite-plus/test";

import {
  formatNextRun,
  rememberExploreProjectId,
  resolveExploreProjectId,
} from "./HomeScreen.logic";

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

describe("formatNextRun", () => {
  // 09:00 America/Los_Angeles on 22 Sep 2026. In UTC that is 16:00 the same
  // calendar day; in the Pacific zone the previous evening is still the 21st.
  const next = "2026-09-22T16:00:00.000Z";
  const eveningBeforeInPacific = Date.parse("2026-09-22T03:00:00.000Z");

  it("labels the clock in the environment timezone, not the browser's", () => {
    expect(formatNextRun(next, "America/Los_Angeles", eveningBeforeInPacific)).toBe(
      "tomorrow at 9:00 AM",
    );
    expect(formatNextRun(next, "UTC", eveningBeforeInPacific)).toBe("today at 4:00 PM");
  });

  it("falls back to the weekday when the run is later than tomorrow", () => {
    expect(formatNextRun("2026-09-25T16:00:00.000Z", "America/Los_Angeles", eveningBeforeInPacific)).toBe(
      "Fri, Sep 25 at 9:00 AM",
    );
  });

  it("says any moment now for a past instant", () => {
    expect(formatNextRun("2026-09-21T16:00:00.000Z", "UTC", eveningBeforeInPacific)).toBe(
      "any moment now",
    );
  });
});
