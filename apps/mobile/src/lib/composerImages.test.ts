import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";

const files = new Map<
  string,
  { base64: string; deleted: boolean; size?: number; type?: string; text?: string }
>();
let base64Barrier: Promise<void> | null = null;
const launchImageLibraryAsync = vi.fn();

const clipboard = vi.hoisted(() => ({
  hasImageAsync: vi.fn(),
  getImageAsync: vi.fn(),
  hasStringAsync: vi.fn(),
  getStringAsync: vi.fn(),
}));

vi.mock("expo-clipboard", () => clipboard);

vi.mock("expo-file-system", () => {
  class File {
    readonly uri: string;
    readonly name: string;
    readonly parentDirectory: { readonly uri: string };

    constructor(...uris: ReadonlyArray<string | { readonly uri: string }>) {
      this.uri = uris.map((uri) => (typeof uri === "string" ? uri : uri.uri)).join("/");
      this.name = this.uri.split("/").at(-1) ?? "file";
      this.parentDirectory = { uri: this.uri.slice(0, -(this.name.length + 1)) };
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

    write(content: string, options?: { encoding?: string }): void {
      if (options?.encoding === "base64") {
        files.set(this.uri, { base64: content, deleted: false });
        return;
      }
      files.set(this.uri, { base64: "", deleted: false, text: content });
    }

    delete(): void {
      const entry = files.get(this.uri);
      if (entry) {
        entry.deleted = true;
      }
    }
    create(): void {
      files.set(this.uri, { base64: "", deleted: false });
    }

    moveSync(destination: { readonly uri: string }): void {
      const entry = files.get(this.uri);
      if (!entry) throw new Error("missing staged file");
      files.set(destination.uri, entry);
      files.delete(this.uri);
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
  createPastedTextComposerAttachment,
  isOwnedPastedImageUri,
  pasteComposerClipboard,
  pickComposerImages,
  resolveComposerAttachmentDataUrl,
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

describe("composer clipboard paste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboard.hasImageAsync.mockResolvedValue(false);
    clipboard.hasStringAsync.mockResolvedValue(true);
    clipboard.getStringAsync.mockResolvedValue("clipboard text");
    clipboard.getImageAsync.mockResolvedValue({ data: "data:image/png;base64,aGVsbG8=" });
  });

  it("returns only the image when the clipboard contains both image and text", async () => {
    clipboard.hasImageAsync.mockResolvedValue(true);
    const result = await pasteComposerClipboard({ existingCount: 0 });
    expect(result).toEqual({
      images: [expect.objectContaining({ type: "image", name: "pasted-image.png" })],
      text: null,
      error: null,
    });
    expect(clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it("does not paste alternate text when the image cannot fit", async () => {
    clipboard.hasImageAsync.mockResolvedValue(true);
    expect(
      await pasteComposerClipboard({ existingCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }),
    ).toEqual({ images: [], text: null, error: expect.stringContaining("up to") });
    expect(clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it("returns plain text without image chips", async () => {
    expect(await pasteComposerClipboard({ existingCount: 0 })).toEqual({
      images: [],
      text: "clipboard text",
      error: null,
    });
  });

  it("reports an empty text clipboard", async () => {
    clipboard.getStringAsync.mockResolvedValue("");
    expect(await pasteComposerClipboard({ existingCount: 0 })).toEqual({
      images: [],
      text: null,
      error: "Clipboard is empty.",
    });
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

  it("persists folded text unchanged in the app-owned attachment directory", async () => {
    const text = "first line\nUnicode: 🙂\n";
    const attachment = await createPastedTextComposerAttachment({
      text,
      name: "pasted-text.txt",
      maxBytes: 1024,
    });

    expect(attachment).toEqual({
      id: "attachment-id",
      type: "file",
      name: "pasted-text.txt",
      mimeType: "text/plain;charset=utf-8",
      sizeBytes: new TextEncoder().encode(text).byteLength,
      fileUri: "file:///documents/t3-composer-attachments/attachment-id-pasted-text.txt",
      source: { _tag: "pasted-text" },
    });
    expect(files.get(attachment.fileUri)?.text).toBe(text);
  });
});
describe("pickComposerImages", () => {
  beforeEach(() => {
    files.clear();
    base64Barrier = null;
    launchImageLibraryAsync.mockReset();
  });

  it("requests native image conversion for formats providers cannot accept", async () => {
    launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });

    await pickComposerImages({ existingCount: 0 });

    expect(launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsMultipleSelection: true,
        quality: 1,
      }),
    );
    expect(launchImageLibraryAsync.mock.calls[0]?.[0]).toHaveProperty("base64", true);
  });

  it("turns a native picker failure into an actionable result", async () => {
    launchImageLibraryAsync.mockRejectedValue(new Error("picker unavailable"));

    await expect(pickComposerImages({ existingCount: 0 })).resolves.toEqual({
      images: [],
      error: "picker unavailable",
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

describe("composerStripAttachments", () => {
  const image = {
    id: "img-1",
    type: "image" as const,
    name: "shot.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    dataUrl: "",
  };
  const video = {
    id: "vid-1",
    type: "file" as const,
    name: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 20,
    fileUri: "file:///clip.mp4",
  };
  const doc = {
    id: "doc-1",
    type: "file" as const,
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    fileUri: "file:///notes.txt",
  };

  it("keeps media, because a thumbnail is the only way to see it", async () => {
    const { composerStripAttachments } = await import("./composerImages");
    const kept = composerStripAttachments([image, video] as never);
    expect(kept.map((a) => a.id)).toEqual(["img-1", "vid-1"]);
  });

  it("never shows a non-media file above the composer", async () => {
    const { composerStripAttachments } = await import("./composerImages");
    // A document reads as its inline chip. A tile with a generic glyph says less than the
    // chip does, so it is not a fallback worth having, chip present or not.
    expect(composerStripAttachments([doc] as never)).toEqual([]);
  });

  it("keeps media beside a document rather than dropping the whole strip", async () => {
    const { composerStripAttachments } = await import("./composerImages");
    expect(composerStripAttachments([doc, image, video] as never).map((a) => a.id)).toEqual([
      "img-1",
      "vid-1",
    ]);
  });

  it("treats a picture picked through the document picker as media", async () => {
    const { composerStripAttachments } = await import("./composerImages");
    // The document picker types every pick as a plain file; what it *is* decides the strip.
    const pickedImage = {
      id: "pick-1",
      type: "file" as const,
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 30,
      fileUri: "file:///photo.png",
    };
    expect(composerStripAttachments([pickedImage] as never).map((a) => a.id)).toEqual(["pick-1"]);
  });
});

describe("composerAttachmentInlineUri", () => {
  it("offers the inline bytes of a picture that owns no file", async () => {
    const { composerAttachmentInlineUri } = await import("./composerImages");
    // The photo library and the clipboard both produce this shape. Its `attachmentId` is a
    // local draft id, so a remote asset lookup for it can only fail.
    expect(
      composerAttachmentInlineUri({
        id: "img-1",
        type: "image",
        name: "IMG_0111.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 9_100_000,
        dataUrl: "data:image/jpeg;base64,AAAA",
        previewUri: "ph://asset",
      } as never),
    ).toBe("data:image/jpeg;base64,AAAA");
  });

  it("falls back to the preview when a picture kept only its asset uri", async () => {
    const { composerAttachmentInlineUri } = await import("./composerImages");
    expect(
      composerAttachmentInlineUri({
        id: "img-2",
        type: "image",
        name: "IMG_0112.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        previewUri: "ph://asset",
      } as never),
    ).toBe("ph://asset");
  });

  it("leaves a file-backed attachment to the retain-lease path", async () => {
    const { composerAttachmentInlineUri } = await import("./composerImages");
    expect(
      composerAttachmentInlineUri({
        id: "img-3",
        type: "image",
        name: "IMG_0113.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        fileUri: "file:///owned.jpg",
        previewUri: "file:///owned.jpg",
      } as never),
    ).toBeUndefined();
  });

  it("has nothing to offer for a plain file or a missing attachment", async () => {
    const { composerAttachmentInlineUri } = await import("./composerImages");
    expect(composerAttachmentInlineUri(undefined)).toBeUndefined();
    expect(
      composerAttachmentInlineUri({
        id: "doc-1",
        type: "file",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        fileUri: "file:///notes.txt",
      } as never),
    ).toBeUndefined();
  });
});
