import { describe, expect, it } from "vite-plus/test";

import {
  buildCreatePullRequestMessageSuffix,
  CREATE_PULL_REQUEST_OPEN_MARKER,
} from "./createPullRequestPrompt.ts";
import {
  isNativeResumeSessionReady,
  parseNativeResumeCommand,
  restoreFailedNativeResumePrompt,
} from "./nativeResume.ts";

describe("parseNativeResumeCommand", () => {
  it("parses a native session id", () => {
    expect(parseNativeResumeCommand("/resume session-123")).toEqual({
      _tag: "Resume",
      sessionId: "session-123",
    });
  });

  it("ignores the generated auto-PR suffix", () => {
    expect(
      parseNativeResumeCommand(`/resume session-123${buildCreatePullRequestMessageSuffix()}`),
    ).toEqual({ _tag: "Resume", sessionId: "session-123" });
  });

  it("rejects missing or ambiguous session ids", () => {
    expect(parseNativeResumeCommand("/resume")).toEqual({ _tag: "Invalid" });
    expect(parseNativeResumeCommand("/resume one two")).toEqual({ _tag: "Invalid" });
  });

  it("leaves ordinary messages and user-authored markers alone", () => {
    expect(parseNativeResumeCommand("Please run /resume session-123")).toBeNull();
    expect(
      parseNativeResumeCommand(`/resume session-123\n${CREATE_PULL_REQUEST_OPEN_MARKER}`),
    ).toEqual({ _tag: "Invalid" });
  });
});

describe("isNativeResumeSessionReady", () => {
  it("only settles the optimistic command after a successful resume", () => {
    expect(isNativeResumeSessionReady("ready")).toBe(true);
    expect(isNativeResumeSessionReady("starting")).toBe(false);
    expect(isNativeResumeSessionReady("error")).toBe(false);
    expect(isNativeResumeSessionReady(null)).toBe(false);
  });
});

describe("restoreFailedNativeResumePrompt", () => {
  it("restores only the latest failed resume ahead of new draft text", () => {
    expect(
      restoreFailedNativeResumePrompt("new draft", [
        "/resume old-session",
        "ordinary prompt",
        "/resume corrected-session",
      ]),
    ).toBe("/resume corrected-session\n\nnew draft");
    expect(restoreFailedNativeResumePrompt("", ["ordinary prompt"])).toBeNull();
  });
});
