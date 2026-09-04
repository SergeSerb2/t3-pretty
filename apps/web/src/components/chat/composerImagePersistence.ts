import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../../composerDraftStore";

interface SerializeComposerImageAttachmentsOptions {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly existingAttachments: ReadonlyArray<PersistedComposerImageAttachment>;
  readonly readDataUrl: (file: File) => Promise<string>;
  readonly isCancelled: () => boolean;
}

function persistedAttachmentMatchesImage(
  attachment: PersistedComposerImageAttachment,
  image: ComposerImageAttachment,
): boolean {
  return (
    attachment.id === image.id &&
    attachment.name === image.name &&
    attachment.mimeType === image.mimeType &&
    attachment.sizeBytes === image.sizeBytes
  );
}

/**
 * Builds one persistence snapshot without repeatedly base64-encoding images
 * that are already durable. New files are read serially so a full composer
 * cannot allocate every multi-megabyte source and data URL at the same time.
 * A superseded effect stops before starting its next read.
 */
export async function serializeComposerImageAttachments({
  images,
  existingAttachments,
  readDataUrl,
  isCancelled,
}: SerializeComposerImageAttachmentsOptions): Promise<PersistedComposerImageAttachment[] | null> {
  const existingById = new Map(
    existingAttachments.map((attachment) => [attachment.id, attachment]),
  );
  const serialized: PersistedComposerImageAttachment[] = [];

  for (const image of images) {
    if (isCancelled()) return null;
    const existing = existingById.get(image.id);
    if (existing && persistedAttachmentMatchesImage(existing, image)) {
      serialized.push(existing);
      continue;
    }

    try {
      const dataUrl = await readDataUrl(image.file);
      if (isCancelled()) return null;
      serialized.push({
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl,
      });
    } catch {
      if (isCancelled()) return null;
      // If metadata changed but the replacement file became unreadable, keep
      // the last durable copy instead of deleting the attachment on reload.
      if (existing) serialized.push(existing);
    }
  }

  return serialized;
}
