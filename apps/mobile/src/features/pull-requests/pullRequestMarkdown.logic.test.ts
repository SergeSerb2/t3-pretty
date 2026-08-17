import { describe, expect, it } from "vite-plus/test";

import {
  convertHtmlImagesToMarkdown,
  hasVisiblePullRequestBody,
  preparePullRequestMarkdown,
  pullRequestBodySegments,
  relabelSuggestionFences,
  splitPullRequestBody,
  stripHtmlComments,
} from "./pullRequestMarkdown.logic";

describe("preparePullRequestMarkdown", () => {
  it("drops HTML comments that hosts hide review templates behind", () => {
    expect(stripHtmlComments("Visible\n<!--\nsecret\n-->\nAfter")).toBe("Visible\n\nAfter");
  });

  it("turns a GitHub dropped-image tag into markdown so native text can render it", () => {
    expect(
      convertHtmlImagesToMarkdown(
        '<img width="1414" alt="screenshot" src="https://github.com/user-attachments/assets/7195f963-51a9-4331-be74-3e06be760422" />',
      ),
    ).toBe(
      "![screenshot](https://github.com/user-attachments/assets/7195f963-51a9-4331-be74-3e06be760422)",
    );
  });

  it("leaves a non-http image tag alone rather than making a link out of it", () => {
    const tag = '<img src="javascript:alert(1)" alt="x">';
    expect(convertHtmlImagesToMarkdown(tag)).toBe(tag);
  });

  it("labels a suggestion fence so it is not an unknown language", () => {
    expect(relabelSuggestionFences("```suggestion\nreturn 1;\n```")).toBe(
      "Suggested change\n\n```\nreturn 1;\n```",
    );
  });

  it("prepares a host body before it is split for rendering", () => {
    const prepared = preparePullRequestMarkdown(
      '<!-- template -->\n```suggestion\nfix\n```\n<img alt="shot" src="https://example.com/a.png">',
    );
    expect(prepared).not.toContain("<!--");
    expect(prepared).toContain("Suggested change");
    expect(prepared).toContain("```\nfix\n```");
    expect(prepared).toContain("![shot](https://example.com/a.png)");
    expect(prepared).not.toContain("```suggestion");
  });
});

describe("splitPullRequestBody", () => {
  it("keeps a plain body as a single markdown run", () => {
    expect(splitPullRequestBody("## What changed\n\nSome prose.")).toEqual([
      { id: "markdown:0", kind: "markdown", text: "## What changed\n\nSome prose." },
    ]);
  });

  it("lifts a dropped video out and keeps the prose around it", () => {
    expect(
      splitPullRequestBody(
        "Before\n\nhttps://github.com/user-attachments/assets/2f8c1a90-1b2c-4d5e-8f90-abcdef123456\n\nAfter",
      ),
    ).toEqual([
      { id: "markdown:0", kind: "markdown", text: "Before" },
      {
        id: "attachment:1",
        kind: "attachment",
        url: "https://github.com/user-attachments/assets/2f8c1a90-1b2c-4d5e-8f90-abcdef123456",
        media: "video",
      },
      { id: "markdown:2", kind: "markdown", text: "After" },
    ]);
  });

  it("never lifts a link inside fenced code out of it", () => {
    const body = "```\nhttps://example.com/demo.mp4\n```";
    expect(splitPullRequestBody(body)).toEqual([
      { id: "markdown:0", kind: "markdown", text: body },
    ]);
  });

  it("applies preparation before splitting so comments do not survive as empty runs", () => {
    expect(pullRequestBodySegments("<!-- only a template -->\nLooks good.")).toEqual([
      { id: "markdown:0", kind: "markdown", text: "Looks good." },
    ]);
  });
});

describe("hasVisiblePullRequestBody", () => {
  it("treats a template-only body as empty", () => {
    expect(hasVisiblePullRequestBody("<!-- only a template -->\n")).toBe(false);
    expect(hasVisiblePullRequestBody("Looks good.")).toBe(true);
  });
});
