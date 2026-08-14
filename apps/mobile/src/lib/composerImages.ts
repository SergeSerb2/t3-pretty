import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import { estimateBase64ByteSize } from "./base64";
import { uuidv4 } from "./uuid";

export interface DraftComposerImageAttachment extends UploadChatImageAttachment {
  readonly id: string;
  readonly previewUri: string;
}

/** Wire shape for startTurn: pure uploads without client draft id / previewUri. */
export function toUploadChatImageAttachments(
  attachments: ReadonlyArray<DraftComposerImageAttachment>,
): ReadonlyArray<UploadChatImageAttachment> {
  return attachments.map((attachment) => ({
    type: attachment.type,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    dataUrl: attachment.dataUrl,
  }));
}

const OWNED_PASTED_IMAGE_DIRECTORY = "t3-composer-paste";
const COMPOSER_PREVIEW_DIRECTORY = "t3-composer-previews";

/**
 * Preview thumbnails live as app-owned files so the draft/preview atoms hold
 * short file URIs instead of multi-MB data URLs. Returns null when the write
 * fails; callers fall back to the data URL so previews keep working.
 */
async function writeComposerPreviewFile(input: {
  readonly base64: string;
  readonly extension: string;
}): Promise<string | null> {
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    const directory = new Directory(Paths.document, COMPOSER_PREVIEW_DIRECTORY);
    directory.create({ idempotent: true, intermediates: true });
    const file = new File(directory, `${uuidv4()}.${input.extension}`);
    file.write(input.base64, { encoding: "base64" });
    return file.uri;
  } catch (error) {
    console.warn("Failed to write composer image preview", error);
    return null;
  }
}

export function isOwnedComposerPreviewUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") {
      return false;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-2) === COMPOSER_PREVIEW_DIRECTORY;
  } catch {
    return false;
  }
}

/** Best-effort cleanup for evicted preview entries; only deletes files we created. */
export async function deleteComposerPreviewFiles(uris: ReadonlyArray<string>): Promise<void> {
  const ownedUris = uris.filter(isOwnedComposerPreviewUri);
  if (ownedUris.length === 0) {
    return;
  }
  try {
    const { File } = await import("expo-file-system");
    for (const uri of ownedUris) {
      try {
        const file = new File(uri);
        if (file.exists) {
          file.delete();
        }
      } catch (error) {
        console.warn("Failed to remove composer image preview", uri, error);
      }
    }
  } catch {
    // expo-file-system is unavailable outside the native runtime (e.g. tests).
  }
}

/**
 * Rebuilds an attachment's wire payload after a persisted draft is loaded.
 * Drafts persist without `dataUrl`; the bytes come back from the app-owned
 * preview file (a `data:` preview URI already is the payload). Returns null
 * when the bytes are gone, so the caller drops the broken attachment.
 */
export async function resolveComposerAttachmentDataUrl(
  attachment: DraftComposerImageAttachment,
): Promise<string | null> {
  if (attachment.dataUrl.length > 0) {
    return attachment.dataUrl;
  }
  if (attachment.previewUri.startsWith("data:")) {
    return attachment.previewUri;
  }
  try {
    const { File } = await import("expo-file-system");
    const file = new File(attachment.previewUri);
    if (!file.exists) {
      return null;
    }
    const base64 = await file.base64();
    return `data:${attachment.mimeType};base64,${base64}`;
  } catch (error) {
    console.warn("Failed to resolve composer attachment bytes", attachment.previewUri, error);
    return null;
  }
}

async function loadImagePicker() {
  try {
    return await import("expo-image-picker");
  } catch (error) {
    throw new Error("Image attachments are unavailable right now.", { cause: error });
  }
}

async function loadClipboard() {
  try {
    return await import("expo-clipboard");
  } catch (error) {
    throw new Error("Clipboard paste is unavailable right now.", { cause: error });
  }
}

export async function pickComposerImages(input: {
  readonly existingCount: number;
  /**
   * Fired after the picker returns assets, before those files are read into
   * data URLs. Callers use this to show in-place preparing thumbnails.
   */
  readonly onPicked?: (
    previews: ReadonlyArray<{ readonly id: string; readonly previewUri: string }>,
  ) => void;
}): Promise<{
  readonly images: ReadonlyArray<DraftComposerImageAttachment>;
  readonly error: string | null;
}> {
  const remainingSlots = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - input.existingCount;
  if (remainingSlots <= 0) {
    return {
      images: [],
      error: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`,
    };
  }

  let imagePicker: Awaited<ReturnType<typeof loadImagePicker>>;
  try {
    imagePicker = await loadImagePicker();
  } catch (error) {
    return {
      images: [],
      error:
        error instanceof Error ? error.message : "Image attachments are unavailable right now.",
    };
  }

  // Skip picker-side base64: it blocks the promise until every asset is
  // encoded, which left the composer with a dead send button and no
  // thumbnails. Previews come from the local URI; we read bytes ourselves.
  const result = await imagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: remainingSlots,
    quality: 1,
  });

  if (result.canceled) {
    return {
      images: [],
      error: null,
    };
  }

  input.onPicked?.(
    result.assets.map((asset, index) => ({
      id: `picking:${index}:${asset.uri}`,
      previewUri: asset.uri,
    })),
  );

  const { File } = await import("expo-file-system");
  const nextImages: DraftComposerImageAttachment[] = [];
  let error: string | null = null;

  for (const asset of result.assets) {
    const mimeType = (asset.mimeType ?? mimeTypeFromUri(asset.uri)).toLowerCase();
    if (!mimeType.startsWith("image/")) {
      error = `Unsupported file type for '${asset.fileName ?? "image"}'.`;
      continue;
    }

    try {
      const base64 = await new File(asset.uri).base64();
      const sizeBytes = asset.fileSize ?? estimateBase64ByteSize(base64);
      if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        error = `'${asset.fileName ?? "image"}' exceeds the 10 MB attachment limit.`;
        continue;
      }

      // Picker asset URIs are not guaranteed to outlive the app session, and
      // drafts persist without their dataUrl — keep an app-owned preview copy.
      const previewFileUri = await writeComposerPreviewFile({
        base64,
        extension: mimeType.split("/")[1] ?? "png",
      });

      nextImages.push({
        id: uuidv4(),
        type: "image",
        name: asset.fileName ?? "image",
        mimeType,
        sizeBytes,
        dataUrl: `data:${mimeType};base64,${base64}`,
        previewUri: previewFileUri ?? asset.uri,
      });
    } catch {
      error = `Failed to read '${asset.fileName ?? "image"}'.`;
    }
  }

  return {
    images: nextImages,
    error,
  };
}

export async function pasteComposerClipboard(input: { readonly existingCount: number }): Promise<{
  readonly images: ReadonlyArray<DraftComposerImageAttachment>;
  readonly text: string | null;
  readonly error: string | null;
}> {
  let clipboard: Awaited<ReturnType<typeof loadClipboard>>;
  try {
    clipboard = await loadClipboard();
  } catch (error) {
    return {
      images: [],
      text: null,
      error: error instanceof Error ? error.message : "Clipboard paste is unavailable right now.",
    };
  }

  const remainingSlots = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - input.existingCount;

  if (await clipboard.hasImageAsync()) {
    if (remainingSlots <= 0) {
      return {
        images: [],
        text: null,
        error: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`,
      };
    }
    const image = await clipboard.getImageAsync({ format: "png" });
    if (!image) {
      return {
        images: [],
        text: null,
        error: "Clipboard image is unavailable.",
      };
    }

    const base64 = image.data.split(",")[1] ?? "";
    const sizeBytes = estimateBase64ByteSize(base64);
    if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return {
        images: [],
        text: null,
        error: "Clipboard image exceeds the 10 MB attachment limit.",
      };
    }

    const previewFileUri = await writeComposerPreviewFile({ base64, extension: "png" });

    return {
      images: [
        {
          id: uuidv4(),
          type: "image",
          name: "pasted-image.png",
          mimeType: "image/png",
          sizeBytes,
          dataUrl: image.data,
          previewUri: previewFileUri ?? image.data,
        },
      ],
      text: null,
      error: null,
    };
  }

  if (await clipboard.hasStringAsync()) {
    const text = await clipboard.getStringAsync();
    return {
      images: [],
      text: text.length > 0 ? text : null,
      error: text.length > 0 ? null : "Clipboard is empty.",
    };
  }

  return {
    images: [],
    text: null,
    error: "Clipboard does not contain pasteable text or image content.",
  };
}

function mimeTypeFromUri(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/png";
  }
}

export function isOwnedPastedImageUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") {
      return false;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    return (
      segments.at(-2) === OWNED_PASTED_IMAGE_DIRECTORY && segments.at(-1)?.endsWith(".png") === true
    );
  } catch {
    return false;
  }
}

export async function convertPastedImagesToAttachments(input: {
  readonly uris: ReadonlyArray<string>;
  readonly existingCount: number;
}): Promise<ReadonlyArray<DraftComposerImageAttachment>> {
  const { File } = await import("expo-file-system");
  const remainingSlots = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - input.existingCount;
  const results: DraftComposerImageAttachment[] = [];

  for (const [index, uri] of input.uris.entries()) {
    const ownedTemporaryFile = isOwnedPastedImageUri(uri);
    try {
      if (index >= Math.max(0, remainingSlots)) {
        continue;
      }
      const file = new File(uri);
      const base64 = await file.base64();
      const sizeBytes = estimateBase64ByteSize(base64);
      if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        continue;
      }
      const mimeType = mimeTypeFromUri(uri);
      // Keep an app-owned copy for the preview: owned temp files are deleted
      // below, and drafts persist without their dataUrl.
      const previewFileUri = await writeComposerPreviewFile({
        base64,
        extension: mimeType.split("/")[1] ?? "png",
      });
      results.push({
        id: uuidv4(),
        type: "image",
        name: `pasted-image.${mimeType.split("/")[1] ?? "png"}`,
        mimeType,
        sizeBytes,
        dataUrl: `data:${mimeType};base64,${base64}`,
        previewUri:
          previewFileUri ?? (ownedTemporaryFile ? `data:${mimeType};base64,${base64}` : uri),
      });
    } catch (error) {
      console.warn("Failed to read pasted image", uri, error);
    } finally {
      if (ownedTemporaryFile) {
        try {
          const file = new File(uri);
          if (file.exists) {
            file.delete();
          }
        } catch (error) {
          console.warn("Failed to remove temporary pasted image", uri, error);
        }
      }
    }
  }

  return results;
}
