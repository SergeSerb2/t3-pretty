import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";

const files = new Map<string, { base64: string; deleted: boolean; size?: number; type?: string }>();
let base64Barrier: Promise<void> | null = null;
const launchImageLibraryAsync = vi.fn();

vi.mock("expo-file-system", () => {
  class File {
    readonly uri: string;

    constructor(...uris: ReadonlyArray<string | { readonly uri: string }>) {
      this.uri = uris.map((uri) => (typeof uri === "string" ? uri : uri.uri)).join("/");
    }

    get exists(): boolean {
      return files.has(this.uri) && files.get(this.uri)?.deleted === false;
    }

    get size(): number | null {
      const entry = files.get(this.uri);
      return entry ? (entry.size ?? 0) : null;
    }

    get type(): string {
      return files.get(this.uri)?.type ?? "";
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

    write(content: string, _options?: { encoding?: string }): void {
      files.set(this.uri, { base64: content, deleted: false });
    }

    delete(): void {
      const entry = files.get(this.uri);
      if (entry) {
        entry.deleted = true;
      }
    }
  }

  class Directory {
    readonly uri: string;

    constructor(...uris: ReadonlyArray<string | { readonly uri: string }>) {
      this.uri = uris.map((uri) => (typeof uri === "string" ? uri : uri.uri)).join("/");
    }

    create(): void {}
  }

  return {
    File,
    Directory,
    Paths: { document: "file:///documents", cache: "file:///cache" },
  };
});

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => launchImageLibraryAsync(...args),
}));

vi.mock("./uuid", () => ({
  uuidv4: () => "attachment-id",
}));

import {
  appendComposerImagesWithinLimit,
  convertPastedImagesToAttachments,
  isOwnedPastedImageUri,
  pickComposerImages,
  resolveComposerAttachmentDataUrl,
  toUploadChatImageAttachments,
} from "./composerImages";

function attachment(id: string) {
  return {
    id,
    type: "image" as const,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 1,
    dataUrl: "data:image/png;base64,AA==",
    previewUri: `file:///documents/t3-composer-previews/${id}.png`,
  };
}

describe("appendComposerImagesWithinLimit", () => {
  it("applies the wire attachment cap to the latest committed state", () => {
    const existing = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1 }, (_, index) =>
      attachment(`existing-${index}`),
    );
    const accepted = attachment("accepted");
    const rejected = attachment("rejected");

    expect(appendComposerImagesWithinLimit(existing, [accepted, rejected])).toEqual({
      attachments: [...existing, accepted],
      rejected: [rejected],
    });
  });
});

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

  it("converts owned files to file-backed previews and deletes the source", async () => {
    const uri =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/id.png";
    files.set(uri, { base64: "aGVsbG8=", deleted: false });

    const result = await convertPastedImagesToAttachments({
      uris: [uri],
      existingCount: 0,
    });

    const previewUri = "file:///documents/t3-composer-previews/attachment-id.png";
    expect(result).toEqual({
      images: [
        expect.objectContaining({
          dataUrl: "data:image/png;base64,aGVsbG8=",
          previewUri,
        }),
      ],
      error: null,
    });
    expect(files.get(uri)?.deleted).toBe(true);
    expect(files.get(previewUri)?.base64).toBe("aGVsbG8=");
  });

  it("uses the native MIME type for opaque Android content URIs", async () => {
    const uri = "content://media/picker/0/com.android.providers.media.photopicker/media/42";
    files.set(uri, {
      base64: "aGVsbG8=",
      deleted: false,
      type: "image/jpeg",
    });

    const result = await convertPastedImagesToAttachments({ uris: [uri], existingCount: 0 });

    expect(result.images[0]).toMatchObject({
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
    });
    expect(result.error).toBeNull();
  });

  it("does not mislabel unsupported native image types as PNG", async () => {
    const uri = "content://media/picker/opaque-heic";
    files.set(uri, {
      base64: "aGVsbG8=",
      deleted: false,
      type: "image/heic",
    });

    await expect(
      convertPastedImagesToAttachments({ uris: [uri], existingCount: 0 }),
    ).resolves.toEqual({
      images: [],
      error: "One pasted image is not a supported GIF, JPEG, PNG, or WebP file.",
    });
  });

  it("does not let a rejected image consume a slot and cleans owned overflow", async () => {
    const rejected =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/bad.png";
    const accepted =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/accepted.png";
    const ownedOverflow =
      "file:///private/var/mobile/Containers/Data/Application/app/tmp/t3-composer-paste/overflow.png";
    const userOwned = "file:///private/var/mobile/photos/library.png";
    files.set(rejected, { base64: "", deleted: false });
    files.set(accepted, { base64: "aGVsbG8=", deleted: false });
    files.set(ownedOverflow, { base64: "aGVsbG8=", deleted: false });
    files.set(userOwned, { base64: "aGVsbG8=", deleted: false });

    const result = await convertPastedImagesToAttachments({
      uris: [rejected, accepted, ownedOverflow, userOwned],
      existingCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
    });

    expect(result.images).toHaveLength(1);
    expect(files.get(rejected)?.deleted).toBe(true);
    expect(files.get(accepted)?.deleted).toBe(true);
    expect(files.get(ownedOverflow)?.deleted).toBe(true);
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

  it("turns a native picker failure into an actionable result", async () => {
    launchImageLibraryAsync.mockRejectedValue(new Error("picker unavailable"));

    await expect(pickComposerImages({ existingCount: 0 })).resolves.toEqual({
      images: [],
      error: "The photo library could not be opened. Try again.",
    });
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
          previewUri: "file:///documents/t3-composer-previews/attachment-id.jpeg",
        }),
      ],
      error: null,
    });
  });
});

describe("resolveComposerAttachmentDataUrl", () => {
  beforeEach(() => {
    files.clear();
  });

  const attachment = (overrides: { dataUrl: string; previewUri: string }) => ({
    id: "a",
    type: "image" as const,
    name: "one.png",
    mimeType: "image/png",
    sizeBytes: 5,
    ...overrides,
  });

  it("keeps populated payloads and data-backed previews untouched", async () => {
    await expect(
      resolveComposerAttachmentDataUrl(
        attachment({ dataUrl: "data:image/png;base64,AA==", previewUri: "file:///tmp/one.png" }),
      ),
    ).resolves.toBe("data:image/png;base64,AA==");
    await expect(
      resolveComposerAttachmentDataUrl(
        attachment({ dataUrl: "", previewUri: "data:image/png;base64,BB==" }),
      ),
    ).resolves.toBe("data:image/png;base64,BB==");
  });

  it("rehydrates stripped payloads from the preview file", async () => {
    const previewUri = "file:///documents/t3-composer-previews/id.png";
    files.set(previewUri, { base64: "aGVsbG8=", deleted: false });

    await expect(
      resolveComposerAttachmentDataUrl(attachment({ dataUrl: "", previewUri })),
    ).resolves.toBe("data:image/png;base64,aGVsbG8=");
  });

  it("returns null when the preview bytes are gone", async () => {
    await expect(
      resolveComposerAttachmentDataUrl(
        attachment({ dataUrl: "", previewUri: "file:///documents/t3-composer-previews/gone.png" }),
      ),
    ).resolves.toBeNull();
  });
});
