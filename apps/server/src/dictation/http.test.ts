import { describe, expect, it } from "@effect/vitest";

import { normalizeCleanupResult, resolveDictationAvailability } from "./http.ts";

describe("dictation availability", () => {
  it("requires both an internal build and a host Groq key", () => {
    expect(resolveDictationAvailability("public", "key")).toEqual({
      available: false,
      reason: "internal_build_required",
    });
    expect(resolveDictationAvailability("internal", "   ")).toEqual({
      available: false,
      reason: "groq_api_key_missing",
    });
    expect(resolveDictationAvailability("internal", "key")).toEqual({
      available: true,
      reason: null,
    });
  });

  it("turns the cleanup model's empty sentinel into an empty insertion", () => {
    expect(normalizeCleanupResult("  EMPTY\n")).toBe("");
    expect(normalizeCleanupResult("  Keep this.\n")).toBe("Keep this.");
  });
});
