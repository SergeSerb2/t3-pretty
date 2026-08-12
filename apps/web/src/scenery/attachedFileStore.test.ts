import { describe, expect, it, beforeEach } from "vite-plus/test";

import type { AttachedFileRef } from "./attachFiles";
import {
  addAttachedFiles,
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
});
