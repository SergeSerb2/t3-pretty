import { describe, expect, it } from "@effect/vitest";

import { resolveDictationAvailability } from "./availability.ts";

describe("Groq speech availability", () => {
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
});
