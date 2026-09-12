import { describe, expect, it } from "vite-plus/test";

import { limitMobileSearchQuery, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH } from "./searchQuery";

describe("limitMobileSearchQuery", () => {
  it("retains ordinary searches and clamps oversized pasted text", () => {
    expect(limitMobileSearchQuery("needle", MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH)).toBe("needle");
    expect(
      limitMobileSearchQuery("x".repeat(400), MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH),
    ).toHaveLength(MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH);
  });
});
