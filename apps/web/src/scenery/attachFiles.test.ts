import { describe, expect, it } from "vite-plus/test";

import {
  classifyAttachment,
  fileExtension,
  looksBinary,
  TEXT_ATTACHMENT_MAX_BYTES,
  textAttachmentPayload,
} from "./attachFiles";

describe("classifyAttachment", () => {
  it("routes images to the composer's own drop pipeline", () => {
    expect(classifyAttachment({ name: "photo.png", type: "image/png", size: 5_000_000 })).toBe(
      "image",
    );
    expect(classifyAttachment({ name: "shot.HEIC", type: "image/heic", size: 100 })).toBe("image");
  });

  it("recognizes text by MIME and by extension when the MIME is empty", () => {
    expect(classifyAttachment({ name: "notes.txt", type: "text/plain", size: 100 })).toBe("text");
    expect(classifyAttachment({ name: "data.json", type: "application/json", size: 100 })).toBe(
      "text",
    );
    expect(classifyAttachment({ name: "main.rs", type: "", size: 100 })).toBe("text");
    expect(classifyAttachment({ name: "build.log", type: "", size: 100 })).toBe("text");
  });

  it("treats oversized or unknown files as binary", () => {
    expect(
      classifyAttachment({
        name: "big.txt",
        type: "text/plain",
        size: TEXT_ATTACHMENT_MAX_BYTES + 1,
      }),
    ).toBe("binary");
    expect(classifyAttachment({ name: "app.zip", type: "application/zip", size: 100 })).toBe(
      "binary",
    );
    expect(classifyAttachment({ name: "mystery.bin", type: "", size: 100 })).toBe("binary");
  });
});

describe("looksBinary", () => {
  it("flags NUL bytes and passes ordinary unicode", () => {
    expect(looksBinary("plain text 🌍\n")).toBe(false);
    expect(looksBinary("PK\u0000\u0000zipdata")).toBe(true);
  });
});

describe("textAttachmentPayload", () => {
  it("wraps content in a four-backtick fence with the extension as language", () => {
    const payload = textAttachmentPayload("notes.md", "# Title\n```js\ncode\n```");
    expect(payload).toContain("Attached file `notes.md`:");
    expect(payload).toContain("````md\n");
    expect(payload.endsWith("````\n")).toBe(true);
    // The inner ``` fence must not close the outer ```` fence.
    expect(payload).toContain("```js\ncode\n```\n````");
  });

  it("normalizes a missing trailing newline", () => {
    expect(textAttachmentPayload("a.txt", "x")).toContain("x\n````");
  });
});

describe("fileExtension", () => {
  it("lowercases and handles dotless or dotfile names", () => {
    expect(fileExtension("Main.RS")).toBe("rs");
    expect(fileExtension("Makefile")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});
