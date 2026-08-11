import { describe, expect, it } from "vite-plus/test";

import {
  applyAttachedFilePathsSuffix,
  ATTACHED_FILE_PATHS_CLOSE_MARKER,
  ATTACHED_FILE_PATHS_OPEN_MARKER,
  classifyAttachment,
  createAttachedFileRef,
  fileExtension,
  hasAttachedFilePathsSuffix,
  resolvePickedFilePath,
  stripAttachedFilePathsSuffix,
  type AttachedFileRef,
} from "./attachFiles";

function fileRef(overrides: Partial<AttachedFileRef> = {}): AttachedFileRef {
  return {
    id: "file-1",
    name: "notes.pdf",
    path: "/Users/serge/Desktop/notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    ...overrides,
  };
}

describe("classifyAttachment", () => {
  it("routes images to the composer's own drop pipeline", () => {
    expect(classifyAttachment({ name: "photo.png", type: "image/png" })).toBe("image");
    expect(classifyAttachment({ name: "shot.HEIC", type: "image/heic" })).toBe("image");
  });

  it("treats every non-image as a path attachment", () => {
    expect(classifyAttachment({ name: "notes.txt", type: "text/plain" })).toBe("file");
    expect(classifyAttachment({ name: "app.zip", type: "application/zip" })).toBe("file");
    expect(classifyAttachment({ name: "mystery.bin", type: "" })).toBe("file");
  });
});

describe("resolvePickedFilePath", () => {
  it("prefers Electron's File.path when present", () => {
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "path", { value: "/tmp/notes.pdf" });
    expect(resolvePickedFilePath(file)).toBe("/tmp/notes.pdf");
  });

  it("falls back to the basename when no absolute path is available", () => {
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(file)).toBe("notes.pdf");
  });
});

describe("createAttachedFileRef", () => {
  it("captures name, path, mime, and size", () => {
    const file = new File(["hello"], "readme.md", { type: "text/markdown" });
    Object.defineProperty(file, "path", { value: "/repo/readme.md" });
    const ref = createAttachedFileRef(file, "id-1");
    expect(ref).toEqual({
      id: "id-1",
      name: "readme.md",
      path: "/repo/readme.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
    });
  });
});

describe("attached file path suffix", () => {
  it("appends a visible summary and a hidden path marker block", () => {
    const result = applyAttachedFilePathsSuffix("Please review", [fileRef()]);
    expect(result.startsWith("Please review")).toBe(true);
    expect(result).toContain("Attached `notes.pdf`.");
    expect(result).toContain(ATTACHED_FILE_PATHS_OPEN_MARKER);
    expect(result).toContain("- `/Users/serge/Desktop/notes.pdf`");
    expect(result.trimEnd().endsWith(ATTACHED_FILE_PATHS_CLOSE_MARKER)).toBe(true);
  });

  it("can stand alone when the prompt is empty", () => {
    const result = applyAttachedFilePathsSuffix("", [fileRef()]);
    expect(result.startsWith("Attached `notes.pdf`.")).toBe(true);
    expect(hasAttachedFilePathsSuffix(result)).toBe(true);
  });

  it("is idempotent when the marker is already present", () => {
    const once = applyAttachedFilePathsSuffix("Hi", [fileRef()]);
    expect(applyAttachedFilePathsSuffix(once, [fileRef({ id: "file-2" })])).toBe(once);
  });

  it("strips only the agent-facing path block from display", () => {
    const sent = applyAttachedFilePathsSuffix("Please review", [fileRef()]);
    expect(stripAttachedFilePathsSuffix(sent)).toBe("Please review\n\nAttached `notes.pdf`.");
  });

  it("leaves user-authored marker quotes alone", () => {
    const typed = `Discuss ${ATTACHED_FILE_PATHS_OPEN_MARKER} in docs`;
    expect(stripAttachedFilePathsSuffix(typed)).toBe(typed);
  });
});

describe("fileExtension", () => {
  it("lowercases and handles dotless or dotfile names", () => {
    expect(fileExtension("Main.RS")).toBe("rs");
    expect(fileExtension("Makefile")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});
