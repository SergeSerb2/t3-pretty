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

  it("includes default TypeScript validation without custom instructions", () => {
    const prompt = threadInstructionsPrompt("Fix it.", " \n", "");
    expect(prompt).toContain("If the project uses TypeScript, always typecheck and compile");
    expect(prompt).toContain("https://github.com/pingdotgg/ts-rust");
    expect(prompt).toContain("tsc-rs --noEmit -p <tsconfig>");
    expect(prompt).toContain("tsc-rs -b <build-tsconfig>");
    expect(prompt).not.toContain("Global instructions:");
    expect(prompt).not.toContain("Project instructions:");
    expect(stripHiddenInstructionSuffixes(prompt)).toBe("Fix it.");
    expect(stripHiddenInstructionSuffixes(responseStylePrompt(prompt, false))).toBe("Fix it.");
  });

  it("preserves native slash commands", () => {
    expect(threadInstructionsPrompt(" /compact", "Use plain English.", "Run tests.")).toBe(
      " /compact",
    );
    expect(threadInstructionsPrompt("/model next", "", "")).toBe("/model next");
  });
});
