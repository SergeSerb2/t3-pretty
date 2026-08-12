import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";

const files = new Map<string, { base64: string; deleted: boolean }>();
let base64Barrier: Promise<void> | null = null;
const launchImageLibraryAsync = vi.fn();

vi.mock("expo-file-system", () => ({
  File: class {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return files.has(this.uri) && files.get(this.uri)?.deleted === false;
    }

    async base64(): Promise<string> {
      if (base64Barrier) {
        await base64Barrier;
      }
      const entry = files.get(this.uri);
      if (!entry || entry.deleted) {
        throw new Error("missing file");
      }
      return entry.base64;
    }

    delete(): void {
      const entry = files.get(this.uri);
      if (entry) {
        entry.deleted = true;
      }
    }
  },
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => launchImageLibraryAsync(...args),
}));

vi.mock("./uuid", () => ({
  uuidv4: () => "attachment-id",
}));

import {
  convertPastedImagesToAttachments,
  isOwnedPastedImageUri,
  pickComposerImages,
  toUploadChatImageAttachments,
} from "./composerImages";

describe("toUploadChatImageAttachments", () => {
  it("strips client draft id and previewUri for the startTurn wire shape", () => {
    expect(
      toUploadChatImageAttachments([
        {
          id: "client-draft-id",
          type: "image",
          name: "pasted-image.png",
          mimeType: "image/png",
          sizeBytes: 12,
          dataUrl: "data:image/png;base64,AA==",
          previewUri: "file:///tmp/preview.png",
        },
      ]),
    ).toEqual([
      {
        type: "image",
        name: "pasted-image.png",
        mimeType: "image/png",
        sizeBytes: 12,
        dataUrl: "data:image/png;base64,AA==",
      },
    ]);
  });
});

describe("native pasted image cleanup", () => {
  beforeEach(() => {
    files.clear();
  });

  it("recognizes only files created in the native composer paste directory", () => {
    expect(
      isOwnedPastedImageUri(
        "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/id.png",
      ),
    ).toBe(true);
    expect(isOwnedPastedImageUri("file:///private/var/mobile/photos/id.png")).toBe(false);
    expect(isOwnedPastedImageUri("https://example.com/t3-composer-paste/id.png")).toBe(false);
  });

  it("converts owned files to data-backed previews and deletes the source", async () => {
    const uri =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/id.png";
    files.set(uri, { base64: "aGVsbG8=", deleted: false });

    const attachments = await convertPastedImagesToAttachments({
      uris: [uri],
      existingCount: 0,
    });

    expect(attachments).toEqual([
      expect.objectContaining({
        dataUrl: "data:image/png;base64,aGVsbG8=",
        previewUri: "data:image/png;base64,aGVsbG8=",
      }),
    ]);
    expect(files.get(uri)?.deleted).toBe(true);
  });

  it("deletes rejected and overflow owned files without deleting user-owned files", async () => {
    const rejected =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/bad.png";
    const overflow =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/overflow.png";
    const userOwned = "file:///private/var/mobile/photos/library.png";
    files.set(rejected, { base64: "", deleted: false });
    files.set(overflow, { base64: "aGVsbG8=", deleted: false });
    files.set(userOwned, { base64: "aGVsbG8=", deleted: false });

    await convertPastedImagesToAttachments({
      uris: [rejected, overflow, userOwned],
      existingCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
    });

    expect(files.get(rejected)?.deleted).toBe(true);
    expect(files.get(overflow)?.deleted).toBe(true);
    expect(files.get(userOwned)?.deleted).toBe(false);
  });
});

describe("pickComposerImages", () => {
  beforeEach(() => {
    files.clear();
    base64Barrier = null;
    launchImageLibraryAsync.mockReset();
  });

  it("does not ask the picker to encode base64 up front", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });

    await pickComposerImages({ existingCount: 0 });

    expect(launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsMultipleSelection: true,
        quality: 1,
      }),
    );
    expect(launchImageLibraryAsync.mock.calls[0]?.[0]).not.toHaveProperty("base64");
  });

  it("reports local previews before image bytes are encoded", async () => {
    const uri = "file:///tmp/photo.jpg";
    files.set(uri, { base64: "aGVsbG8=", deleted: false });
    let releaseBase64!: () => void;
    base64Barrier = new Promise<void>((resolve) => {
      releaseBase64 = resolve;
    });
    launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri, fileName: "photo.jpg", mimeType: "image/jpeg", fileSize: 6 }],
    });
    const onPicked = vi.fn();

    const pending = pickComposerImages({ existingCount: 0, onPicked });
    await vi.waitFor(() => {
      expect(onPicked).toHaveBeenCalledWith([{ id: `picking:0:${uri}`, previewUri: uri }]);
    });

    releaseBase64();
    await expect(pending).resolves.toEqual({
      images: [
        expect.objectContaining({
          name: "photo.jpg",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,aGVsbG8=",
          previewUri: uri,
        }),
      ],
      error: null,
    });
  });
});
