import { describe, expect, it } from "vite-plus/test";
import { stripHiddenInstructionSuffixes } from "@t3tools/shared/hiddenInstructionBlocks";
import { responseStylePrompt } from "./ResponseStyleInstructions.ts";
import { threadInstructionsPrompt } from "./ThreadInstructions.ts";

describe("threadInstructionsPrompt", () => {
  it("adds global and project guidance without changing the displayed prompt", () => {
    const prompt = threadInstructionsPrompt(
      "Fix the bug.",
      "Use plain English.",
      "Run unit tests.",
    );
    expect(prompt).toContain("Global instructions:\nUse plain English.");
    expect(prompt).toContain("Project instructions:\nRun unit tests.");
    expect(stripHiddenInstructionSuffixes(responseStylePrompt(prompt, true))).toBe("Fix the bug.");
  });

  it("omits empty guidance and preserves native slash commands", () => {
    expect(threadInstructionsPrompt("Fix it.", " \n", "")).toBe("Fix it.");
    expect(threadInstructionsPrompt(" /compact", "Use plain English.", "Run tests.")).toBe(
      " /compact",
    );
    expect(threadInstructionsPrompt("Fix it.", "", "Run tests.")).not.toContain(
      "Global instructions:",
    );
  });
});
