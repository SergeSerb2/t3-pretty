import { describe, expect, it, beforeEach } from "vite-plus/test";

import type { AttachedFileRef } from "./attachFiles";
import {
  addAttachedFiles,
  ATTACHED_FILE_PATH_MAX_COUNT,
  clearAttachedFilesForThread,
  getAttachedFilesForThread,
  removeAttachedFile,
  resetAttachedFilesStore,
  restoreAttachedFiles,
  takeAttachedFilesForThread,
} from "./attachedFileStore";

function fileRef(id: string, name = `${id}.pdf`): AttachedFileRef {
  return {
    id,
    name,
    path: `/tmp/${name}`,
    mimeType: "application/pdf",
    sizeBytes: 10,
  };
}

describe("attachedFileStore", () => {
  beforeEach(() => {
    resetAttachedFilesStore();
  });

  it("stores files per thread and dedupes by path+name+size", () => {
    addAttachedFiles("env:thread-a", [fileRef("a"), fileRef("a")]);
    addAttachedFiles("env:thread-a", [fileRef("a"), fileRef("b")]);
    expect(getAttachedFilesForThread("env:thread-a").map((file) => file.id)).toEqual(["a", "b"]);
    expect(getAttachedFilesForThread("env:thread-b")).toEqual([]);
  });

  it("removes a single file and clears the thread when empty", () => {
    addAttachedFiles("env:thread-a", [fileRef("a"), fileRef("b")]);
    removeAttachedFile("env:thread-a", "a");
    expect(getAttachedFilesForThread("env:thread-a").map((file) => file.id)).toEqual(["b"]);
    removeAttachedFile("env:thread-a", "b");
    expect(getAttachedFilesForThread("env:thread-a")).toEqual([]);
  });

  it("takes files for send and can restore them on failure", () => {
    addAttachedFiles("env:thread-a", [fileRef("a")]);
    const taken = takeAttachedFilesForThread("env:thread-a");
    expect(taken.map((file) => file.id)).toEqual(["a"]);
    expect(getAttachedFilesForThread("env:thread-a")).toEqual([]);
    restoreAttachedFiles("env:thread-a", taken);
    expect(getAttachedFilesForThread("env:thread-a").map((file) => file.id)).toEqual(["a"]);
  });

  it("merges a failed send with files added while it was in flight", () => {
    addAttachedFiles("env:thread-a", [fileRef("a")]);
    const taken = takeAttachedFilesForThread("env:thread-a");
    addAttachedFiles("env:thread-a", [fileRef("b")]);
    restoreAttachedFiles("env:thread-a", taken);
    expect(getAttachedFilesForThread("env:thread-a").map((file) => file.id)).toEqual(["b", "a"]);
  });

  it("caps pending path chips per thread and reports overflow", () => {
    const update = addAttachedFiles(
      "env:thread-a",
      Array.from({ length: ATTACHED_FILE_PATH_MAX_COUNT + 2 }, (_, index) =>
        fileRef(String(index)),
      ),
    );
    expect(update).toEqual({
      addedCount: ATTACHED_FILE_PATH_MAX_COUNT,
      droppedCount: 2,
    });
    expect(getAttachedFilesForThread("env:thread-a")).toHaveLength(ATTACHED_FILE_PATH_MAX_COUNT);
  });

  it("clears pending files when their thread is deleted", () => {
    addAttachedFiles("env:thread-a", [fileRef("a")]);
    addAttachedFiles("env:thread-b", [fileRef("b")]);

    clearAttachedFilesForThread("env:thread-a");

    expect(getAttachedFilesForThread("env:thread-a")).toEqual([]);
    expect(getAttachedFilesForThread("env:thread-b").map((file) => file.id)).toEqual(["b"]);
  });
});
