import { describe, expect, it } from "vite-plus/test";

import {
  applyCreatePullRequestSuffix,
  CREATE_PULL_REQUEST_CLOSE_MARKER,
  CREATE_PULL_REQUEST_MESSAGE_SUFFIX,
  CREATE_PULL_REQUEST_OPEN_MARKER,
  hasCreatePullRequestSuffix,
  stripCreatePullRequestSuffix,
} from "./createPullRequestPrompt.ts";

describe("applyCreatePullRequestSuffix", () => {
  it("appends the suffix to a fresh thread's first message", () => {
    const result = applyCreatePullRequestSuffix({
      text: "Fix the login bug",
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(result).toBe(`Fix the login bug${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`);
  });

  it("leaves the text alone when the toggle is off", () => {
    expect(
      applyCreatePullRequestSuffix({
        text: "Fix the login bug",
        autoCreatePullRequest: false,
        threadHasStarted: false,
      }),
    ).toBe("Fix the login bug");
  });

  it("does not append to follow-ups in a started thread", () => {
    expect(
      applyCreatePullRequestSuffix({
        text: "Also fix logout",
        autoCreatePullRequest: true,
        threadHasStarted: true,
      }),
    ).toBe("Also fix logout");
  });

  it("never turns an empty draft into suffix-only text", () => {
    expect(
      applyCreatePullRequestSuffix({
        text: "   ",
        autoCreatePullRequest: true,
        threadHasStarted: false,
      }),
    ).toBe("   ");
  });

  it("is idempotent when the text already carries the suffix", () => {
    const once = applyCreatePullRequestSuffix({
      text: "Fix the login bug",
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    const twice = applyCreatePullRequestSuffix({
      text: once,
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(twice).toBe(once);
  });
});

describe("stripCreatePullRequestSuffix", () => {
  it("removes the suffix block for display", () => {
    const sent = applyCreatePullRequestSuffix({
      text: "Fix the login bug",
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(stripCreatePullRequestSuffix(sent)).toBe("Fix the login bug");
  });

  it("returns unmarked text unchanged", () => {
    expect(stripCreatePullRequestSuffix("Just a message")).toBe("Just a message");
  });

  it("strips historical blocks whose inner wording differs", () => {
    const sent = `Do the thing\n\n${CREATE_PULL_REQUEST_OPEN_MARKER}\nold wording\n${CREATE_PULL_REQUEST_CLOSE_MARKER}`;
    expect(stripCreatePullRequestSuffix(sent)).toBe("Do the thing");
  });

  it("preserves a user-authored trailing block that lacks the generated marker attribute", () => {
    const typed =
      "Please tweak this block:\n<create_pull_request_instructions>\ncustom wording\n</create_pull_request_instructions>";
    expect(hasCreatePullRequestSuffix(typed)).toBe(false);
    expect(stripCreatePullRequestSuffix(typed)).toBe(typed);
    const sent = applyCreatePullRequestSuffix({
      text: typed,
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(sent).toBe(`${typed}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`);
    expect(stripCreatePullRequestSuffix(sent)).toBe(typed);
  });

  it("preserves an inline marker pair even when it ends the text", () => {
    const typed = `Explain ${CREATE_PULL_REQUEST_OPEN_MARKER}VISIBLE${CREATE_PULL_REQUEST_CLOSE_MARKER}`;
    expect(hasCreatePullRequestSuffix(typed)).toBe(false);
    expect(stripCreatePullRequestSuffix(typed)).toBe(typed);
  });

  it("leaves an unterminated marker alone — only the exact trailing block is generated", () => {
    const sent = "Do the thing\n\n<create_pull_request_instructions>\ntruncated";
    expect(stripCreatePullRequestSuffix(sent)).toBe(sent);
  });

  it("leaves user-authored mid-text markers alone", () => {
    const sent =
      "How does <create_pull_request_instructions> get injected?\nExplain the mechanism.";
    expect(stripCreatePullRequestSuffix(sent)).toBe(sent);
    expect(hasCreatePullRequestSuffix(sent)).toBe(false);
  });

  it("strips only the trailing block when the user also quotes the marker", () => {
    const typed = "Discuss <create_pull_request_instructions> markup handling";
    const sent = applyCreatePullRequestSuffix({
      text: typed,
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(sent).not.toBe(typed);
    expect(stripCreatePullRequestSuffix(sent)).toBe(typed);
  });

  it("anchors on the last opening marker when the user quotes a newline-delimited block", () => {
    const typed =
      "Here is the markup:\n<create_pull_request_instructions>\nquoted example\n</create_pull_request_instructions>\nIs that right?";
    const sent = applyCreatePullRequestSuffix({
      text: typed,
      autoCreatePullRequest: true,
      threadHasStarted: false,
    });
    expect(sent).toBe(`${typed}${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`);
    expect(stripCreatePullRequestSuffix(sent)).toBe(typed);
  });
});

describe("hasCreatePullRequestSuffix", () => {
  it("detects the applied suffix", () => {
    expect(hasCreatePullRequestSuffix(`x${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`)).toBe(true);
    expect(hasCreatePullRequestSuffix("x")).toBe(false);
  });
});
