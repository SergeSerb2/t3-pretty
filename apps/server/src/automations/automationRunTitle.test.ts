import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { automationRunBranchName, automationRunTitle } from "./automationRunTitle.ts";

const AT = DateTime.makeUnsafe("2026-09-06T07:05:00.000Z");

describe("automationRunTitle", () => {
  it("renders the clock in the schedule's zone", () => {
    expect(automationRunTitle("Nightly review", AT, "Europe/Berlin")).toBe(
      "Nightly review · Sep 6, 09:05",
    );
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    expect(automationRunTitle("Nightly review", AT, null)).toBe("Nightly review · Sep 6, 07:05");
    expect(automationRunTitle("Nightly review", AT, "Mars/Olympus")).toBe(
      "Nightly review · Sep 6, 07:05",
    );
  });
});

describe("automationRunBranchName", () => {
  it("slugs the name and stamps the UTC minute", () => {
    expect(automationRunBranchName("Nightly  Review!", AT)).toBe(
      "automation/nightly-review/20260906-0705",
    );
    expect(automationRunBranchName("???", AT)).toBe("automation/run/20260906-0705");
  });

  it("never looks like a temporary worktree branch", () => {
    expect(isTemporaryWorktreeBranch(automationRunBranchName("deadbeef", AT))).toBe(false);
  });
});
