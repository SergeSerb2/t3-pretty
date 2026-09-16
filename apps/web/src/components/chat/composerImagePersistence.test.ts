import { expect, it, vi } from "vite-plus/test";

import type {
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../../composerDraftStore";
import { serializeComposerImageAttachments } from "./composerImagePersistence";

function image(id: string, contents = id): ComposerImageAttachment {
  const file = new File([contents], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
  };
}

function persisted(image: ComposerImageAttachment): PersistedComposerImageAttachment {
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    dataUrl: `data:${image.mimeType};base64,existing-${image.id}`,
  };
}

it("reuses unchanged persisted images and reads only new files in composer order", async () => {
  const existingImage = image("existing");
  const newImage = image("new");
  const existingAttachment = persisted(existingImage);
  const readDataUrl = vi.fn(async (file: File) => `data:${file.type};base64,new-payload`);

  const result = await serializeComposerImageAttachments({
    images: [existingImage, newImage],
    existingAttachments: [existingAttachment],
    readDataUrl,
    isCancelled: () => false,
  });

  expect(readDataUrl).toHaveBeenCalledTimes(1);
  expect(readDataUrl).toHaveBeenCalledWith(newImage.file);
  expect(result?.[0]).toBe(existingAttachment);
  expect(result?.map((attachment) => attachment.id)).toEqual(["existing", "new"]);
});

it("stops before reading another image after the persistence effect is cancelled", async () => {
  const images = [image("first"), image("second")];
  let cancelled = false;
  const readDataUrl = vi.fn(async (file: File) => {
    cancelled = true;
    return `data:${file.type};base64,payload`;
  });

  const result = await serializeComposerImageAttachments({
    images,
    existingAttachments: [],
    readDataUrl,
    isCancelled: () => cancelled,
  });

  expect(result).toBeNull();
  expect(readDataUrl).toHaveBeenCalledTimes(1);
});

it("keeps the last durable copy when a changed replacement cannot be read", async () => {
  const original = image("same", "old");
  const replacement = image("same", "larger replacement");
  const existingAttachment = persisted(original);

  const result = await serializeComposerImageAttachments({
    images: [replacement],
    existingAttachments: [existingAttachment],
    readDataUrl: async () => Promise.reject(new Error("unreadable")),
    isCancelled: () => false,
  });

  expect(result).toEqual([existingAttachment]);
});
