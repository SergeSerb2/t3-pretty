import { describe, expect, it } from "vite-plus/test";

import {
  hasCreatePullRequestSuffix,
  CREATE_PULL_REQUEST_MESSAGE_SUFFIX,
  stripCreatePullRequestSuffix,
} from "./createPullRequestPrompt.ts";
import { AUTOMATION_RUN_CLOSE_MARKER, AUTOMATION_RUN_OPEN_MARKER } from "./automationRunPrompt.ts";
import {
  hasHiddenInstructionSuffix,
  stripHiddenInstructionSuffixes,
} from "./hiddenInstructionBlocks.ts";

const RUN_SUFFIX = `\n\n${AUTOMATION_RUN_OPEN_MARKER}\nYou are running unattended.\n${AUTOMATION_RUN_CLOSE_MARKER}`;

describe("stripHiddenInstructionSuffixes", () => {
  it("strips a trailing PR block", () => {
    expect(stripHiddenInstructionSuffixes(`Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`)).toBe(
      "Fix it",
    );
  });

  it("strips a trailing run block", () => {
    expect(stripHiddenInstructionSuffixes(`Fix it${RUN_SUFFIX}`)).toBe("Fix it");
  });

  it("strips both blocks in either order", () => {
    expect(
      stripHiddenInstructionSuffixes(`Fix it${RUN_SUFFIX}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`),
    ).toBe("Fix it");
    expect(
      stripHiddenInstructionSuffixes(`Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}${RUN_SUFFIX}`),
    ).toBe("Fix it");
  });

  it("leaves non-trailing blocks and bare tags untouched", () => {
    const quoted = `What does ${AUTOMATION_RUN_OPEN_MARKER} mean?`;
    expect(stripHiddenInstructionSuffixes(quoted)).toBe(quoted);
    const middle = `Before${RUN_SUFFIX}\n\nAfter`;
    expect(stripHiddenInstructionSuffixes(middle)).toBe(middle);
  });

  it("is idempotent", () => {
    const once = stripHiddenInstructionSuffixes(
      `Fix it${RUN_SUFFIX}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`,
    );
    expect(stripHiddenInstructionSuffixes(once)).toBe(once);
  });
});

describe("hasHiddenInstructionSuffix", () => {
  it("finds a block anywhere in the trailing sequence", () => {
    const text = `Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}${RUN_SUFFIX}`;
    expect(hasHiddenInstructionSuffix(text, "create_pull_request_instructions")).toBe(true);
    expect(hasHiddenInstructionSuffix(text, "automation_run")).toBe(true);
    expect(hasHiddenInstructionSuffix("Fix it", "automation_run")).toBe(false);
  });
});

describe("createPullRequestPrompt delegation", () => {
  it("keeps PR-only behavior and now sees the PR block behind a run block", () => {
    expect(stripCreatePullRequestSuffix(`Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`)).toBe(
      "Fix it",
    );
    expect(hasCreatePullRequestSuffix(`Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`)).toBe(true);
    expect(
      hasCreatePullRequestSuffix(`Fix it${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}${RUN_SUFFIX}`),
    ).toBe(true);
    expect(hasCreatePullRequestSuffix("Fix it")).toBe(false);
  });
});
