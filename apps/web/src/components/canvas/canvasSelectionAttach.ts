import type { CanvasDocument, CanvasImageNode, ScopedThreadRef } from "@t3tools/contracts";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";

import {
  canvasImageAttachmentResources,
  getNode,
  isPendingImageNode,
  type CanvasMeasuredSizes,
} from "~/canvasDocSync";
import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { useComposerDraftStore, type ComposerImageAttachment } from "~/composerDraftStore";
import { toastManager } from "~/components/ui/toast";
import {
  canvasSelectionImageName,
  canvasSelectionNodeSummary,
  type CanvasSelectionContext,
  type CanvasSelectionNodeSummary,
} from "~/lib/canvasSelection";
import { randomUUID } from "~/lib/utils";

import {
  canvasCropRect,
  canvasCropVisibleEntries,
  renderCanvasSelectionCrop,
  type CanvasCropPalette,
} from "./canvasSelectionCrop";

function cropImageNodes(
  doc: CanvasDocument,
  selectedIds: readonly string[],
  measuredSizes: CanvasMeasuredSizes | undefined,
): CanvasImageNode[] {
  const rect = canvasCropRect(doc, selectedIds, measuredSizes);
  if (rect === null) return [];
  return canvasCropVisibleEntries(doc, rect, measuredSizes).flatMap((entry) =>
    entry.node.type === "image" ? [entry.node] : [],
  );
}

export function canvasSelectionAttachmentResources(
  doc: CanvasDocument,
  selectedIds: readonly string[],
  measuredSizes: CanvasMeasuredSizes | undefined,
) {
  return canvasImageAttachmentResources(cropImageNodes(doc, selectedIds, measuredSizes));
}

/**
 * Attach a canvas selection (structured block + optional crop) to the thread's
 * composer draft. Used by Add to chat and by canvas-first Send.
 */
export async function attachCanvasSelectionToDraft(input: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  revision: number;
  selectedIds: readonly string[];
  measuredSizes: CanvasMeasuredSizes | undefined;
  resolveImageSrc: (node: CanvasImageNode) => string | null;
  palette: CanvasCropPalette;
  comment?: string;
}): Promise<{ nodes: CanvasSelectionNodeSummary[] } | null> {
  const nodes = input.selectedIds.flatMap((id) => {
    const node = getNode(input.doc, id);
    return node === null ? [] : [canvasSelectionNodeSummary(node)];
  });
  if (nodes.length === 0) return null;

  const selectionId = randomUUID();
  const trimmedComment = input.comment?.trim() ?? "";
  const selection: CanvasSelectionContext = {
    id: selectionId,
    docRevision: input.revision,
    ...(trimmedComment.length > 0 ? { comment: trimmedComment } : {}),
    nodes,
  };

  const imageNodes = cropImageNodes(input.doc, input.selectedIds, input.measuredSizes);
  let crop = null;
  try {
    crop = await renderCanvasSelectionCrop({
      doc: input.doc,
      selectedIds: input.selectedIds,
      measuredSizes: input.measuredSizes,
      resolveImageSrc: input.resolveImageSrc,
      palette: input.palette,
      fileName: canvasSelectionImageName(selectionId),
    });
  } catch {
    // A tainted or unreachable bitmap only costs the picture; the structured
    // block still tells the agent exactly what was selected.
  }

  const store = useComposerDraftStore.getState();
  store.addCanvasSelection(input.threadRef, selection);
  const draftImageCount = store.getComposerDraft(input.threadRef)?.images.length ?? 0;

  if (crop === null) {
    toastManager.add({
      type: "info",
      title: "Added selection without an image",
      description: "The canvas image could not be rendered, so only its details were attached.",
    });
  } else if (draftImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    toastManager.add({
      type: "info",
      title: "Attachment limit reached",
      description: `Added the selection details only; a message can carry ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images.`,
    });
  } else {
    store.addImage(input.threadRef, {
      type: "image",
      id: selectionId,
      name: crop.file.name,
      mimeType: crop.file.type,
      sizeBytes: crop.file.size,
      previewUrl: URL.createObjectURL(crop.file),
      file: crop.file,
    } satisfies ComposerImageAttachment);
  }

  return { nodes };
}

export function canvasSelectionImageSrcByNodeId(
  threadRef: ScopedThreadRef,
  imageNodes: readonly CanvasImageNode[],
  urlByAttachmentId: ReadonlyMap<string, string>,
): Map<string, string> {
  const localPreviews = selectThreadCanvasState(
    useCanvasStore.getState().byThreadKey,
    threadRef,
  ).localImagePreviews;
  const srcByNodeId = new Map<string, string>();
  for (const node of imageNodes) {
    const preview = isPendingImageNode(node) ? localPreviews[node.id] : undefined;
    const resolved = preview ?? urlByAttachmentId.get(node.attachmentId) ?? null;
    if (resolved !== null) srcByNodeId.set(node.id, resolved);
  }
  return srcByNodeId;
}

export { cropImageNodes };
