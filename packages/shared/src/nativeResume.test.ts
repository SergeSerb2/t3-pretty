import { describe, expect, it } from "vite-plus/test";

import {
  buildCreatePullRequestMessageSuffix,
  CREATE_PULL_REQUEST_OPEN_MARKER,
} from "./createPullRequestPrompt.ts";
import { parseNativeResumeCommand } from "./nativeResume.ts";

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
