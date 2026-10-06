import { describe, expect, it } from "vite-plus/test";
import { stripHiddenInstructionSuffixes } from "@t3tools/shared/hiddenInstructionBlocks";
import { CREATE_PULL_REQUEST_MESSAGE_SUFFIX } from "@t3tools/shared/createPullRequestPrompt";

import { responseStylePrompt } from "./ResponseStyleInstructions.ts";

describe("response style prompts", () => {
  it.each([true, false])("keeps native slash commands intact with guidance %s", (enabled) => {
    for (const command of ["/compact", "  /model gpt-6.1-sol", "/review this branch"]) {
      expect(responseStylePrompt(command, enabled)).toBe(command);
    }
  });

  it("adds guidance to attachment-only prompts", () => {
    expect(responseStylePrompt("", true)).toContain("ASD-STE100");
  });

  it.each([true, false])("hides guidance %s with other generated blocks", (enabled) => {
    const text = "Explain this code.";
    const delivered = responseStylePrompt(`${text}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`, enabled);
    expect(stripHiddenInstructionSuffixes(delivered)).toBe(text);
    expect(
      stripHiddenInstructionSuffixes(`${delivered}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`),
    ).toBe(text);
  });

  it("keeps a user discussion of the bare instruction tag visible", () => {
    const text =
      "Explain <t3_pretty_response_style>\nsome instructions\n</t3_pretty_response_style>";
    expect(stripHiddenInstructionSuffixes(responseStylePrompt(text, true))).toBe(text);
  });
});
