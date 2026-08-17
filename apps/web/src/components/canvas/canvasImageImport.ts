import {
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import { readFileAsDataUrl } from "~/components/ChatView.logic";
import { compressImageToByteLimit } from "~/lib/imageCompression";

import type { CanvasCaptureImage } from "./canvasCapture";

export function canvasImportableImageFiles(files: readonly File[]): File[] {
  return files.filter(
    (file) => file.type.startsWith("image/") && isProviderSendTurnSupportedImageMimeType(file.type),
  );
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return target.closest("input, textarea, [contenteditable='true']") !== null;
}

function naturalSizeFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      reject(new Error("Could not decode image."));
    });
    image.src = dataUrl;
  });
}

export async function filesToCanvasCaptureImages(
  files: readonly File[],
): Promise<{ images: { image: CanvasCaptureImage; name: string }[]; error: string | null }> {
  const accepted = canvasImportableImageFiles(files);
  let error: string | null = null;
  if (accepted.length === 0 && files.length > 0) {
    error = "Drop GIF, JPEG, PNG, or WebP images onto the canvas.";
  }

  const images: { image: CanvasCaptureImage; name: string }[] = [];
  for (const file of accepted) {
    const compressed = await compressImageToByteLimit(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
    if (!compressed.ok) {
      error =
        compressed.reason === "unreadable"
          ? `'${file.name}' could not be read as an image.`
          : `'${file.name}' is too large to place, even after compression.`;
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(compressed.file);
      const size = await naturalSizeFromDataUrl(dataUrl);
      if (!(size.width > 0) || !(size.height > 0)) {
        error = `'${file.name}' could not be read as an image.`;
        continue;
      }
      images.push({
        image: { dataUrl, width: size.width, height: size.height },
        name: compressed.file.name || file.name || "image",
      });
    } catch {
      error = `'${file.name}' could not be read as an image.`;
    }
  }
  return { images, error };
}

export function imageFilesFromClipboard(event: ClipboardEvent): File[] {
  const files: File[] = [];
  const items = event.clipboardData?.items;
  if (!items) return files;
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return [...dataTransfer.files];
}
