import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyAttachedFilePathsSuffix,
  ATTACHED_FILE_PATHS_CLOSE_MARKER,
  ATTACHED_FILE_PATHS_OPEN_MARKER,
  classifyAttachment,
  createAttachedFileRef,
  fileExtension,
  hasAttachedFilePathsSuffix,
  looksBinary,
  resolvePickedFilePath,
  stripAttachedFilePathsSuffix,
  textAttachmentPayload,
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

function testWindow(): Window & typeof globalThis {
  return globalThis.window ?? (globalThis as unknown as Window & typeof globalThis);
}

function stubGetPathForFile(impl: ((file: object) => string) | undefined): void {
  if (impl === undefined) {
    Reflect.deleteProperty(testWindow(), "desktopBridge");
    return;
  }
  testWindow().desktopBridge = {
    getPathForFile: impl,
  } as DesktopBridge;
}

beforeEach(() => {
  if (globalThis.window === undefined) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
  }
  Reflect.deleteProperty(testWindow(), "desktopBridge");
});

afterEach(() => {
  Reflect.deleteProperty(testWindow(), "desktopBridge");
});

describe("classifyAttachment", () => {
  it("routes images to the composer's own drop pipeline", () => {
    expect(classifyAttachment({ name: "photo.png", type: "image/png", size: 10 })).toBe("image");
    expect(classifyAttachment({ name: "shot.HEIC", type: "image/heic", size: 10 })).toBe("image");
  });

  it("classifies readable text for prompt inlining when no absolute path exists", () => {
    expect(classifyAttachment({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("text");
    expect(classifyAttachment({ name: "data.json", type: "application/json", size: 10 })).toBe(
      "text",
    );
    expect(classifyAttachment({ name: "script.ts", type: "", size: 10 })).toBe("text");
  });

  it("treats non-text binaries as path-or-refuse files", () => {
    expect(classifyAttachment({ name: "app.zip", type: "application/zip", size: 10 })).toBe("file");
    expect(classifyAttachment({ name: "mystery.bin", type: "", size: 10 })).toBe("file");
    expect(classifyAttachment({ name: "huge.txt", type: "text/plain", size: 200 * 1024 })).toBe(
      "file",
    );
  });
});

describe("resolvePickedFilePath", () => {
  it("uses desktopBridge.getPathForFile when it returns an absolute path", () => {
    stubGetPathForFile(() => "/tmp/notes.pdf");
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(file)).toBe("/tmp/notes.pdf");
  });

  it("accepts Windows absolute paths from the bridge", () => {
    stubGetPathForFile(() => "C:\\Users\\serge\\notes.pdf");
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(file)).toBe("C:\\Users\\serge\\notes.pdf");
  });

  it("returns null when only a basename is available", () => {
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(file)).toBeNull();
  });

  it("returns null for relative or empty bridge paths", () => {
    stubGetPathForFile(() => "notes.pdf");
    const relative = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(relative)).toBeNull();

    stubGetPathForFile(() => "   ");
    const empty = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(resolvePickedFilePath(empty)).toBeNull();
  });

  it("ignores the removed Electron File.path property", () => {
    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "path", { value: "/tmp/notes.pdf" });
    expect(resolvePickedFilePath(file)).toBeNull();
  });
});

describe("createAttachedFileRef", () => {
  it("captures name, path, mime, and size when an absolute path exists", () => {
    stubGetPathForFile(() => "/repo/readme.md");
    const file = new File(["hello"], "readme.md", { type: "text/markdown" });
    const ref = createAttachedFileRef(file, "id-1");
    expect(ref).toEqual({
      id: "id-1",
      name: "readme.md",
      path: "/repo/readme.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
    });
  });

  it("returns null when the browser only exposes a basename", () => {
    const file = new File(["hello"], "readme.md", { type: "text/markdown" });
    expect(createAttachedFileRef(file, "id-1")).toBeNull();
  });
});

describe("textAttachmentPayload", () => {
  it("wraps content in a four-backtick fence keyed by extension", () => {
    expect(textAttachmentPayload("notes.md", "hello")).toBe(
      "Attached file `notes.md`:\n````md\nhello\n````\n",
    );
  });

  it("does not double a trailing newline already present", () => {
    expect(textAttachmentPayload("a.txt", "hi\n")).toBe(
      "Attached file `a.txt`:\n````txt\nhi\n````\n",
    );
  });
});

describe("looksBinary", () => {
  it("flags NUL bytes", () => {
    expect(looksBinary("plain")).toBe(false);
    expect(looksBinary("a\u0000b")).toBe(true);
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
