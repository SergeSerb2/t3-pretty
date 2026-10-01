import { describe, expect, it } from "vite-plus/test";

import { isAtomicWriteTempFileName } from "./atomic-file";

describe("atomic write staging files", () => {
  it("matches only numbered sibling staging files", () => {
    expect(isAtomicWriteTempFileName("drafts.json.1.tmp", "drafts.json")).toBe(true);
    expect(isAtomicWriteTempFileName("drafts.json.42.tmp", "drafts.json")).toBe(true);
    expect(isAtomicWriteTempFileName("other.json.1.tmp", "drafts.json")).toBe(false);
    expect(isAtomicWriteTempFileName("drafts.json.tmp", "drafts.json")).toBe(false);
    expect(isAtomicWriteTempFileName("drafts.json.0.tmp", "drafts.json")).toBe(false);
    expect(isAtomicWriteTempFileName("drafts.json")).toBe(false);
  });
});
