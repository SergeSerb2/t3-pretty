"use client";

/**
 * Floating "Add to chat" bar for the current canvas selection. It attaches two
 * things to the composer draft: a structured `<canvas_selection>` context block
 * (node ids, names, sizes, capture origins) and a PNG crop of the selected
 * region, paired by id the way preview annotations are.
 */
import type { CanvasDocument, CanvasImageNode, ScopedThreadRef } from "@t3tools/contracts";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { getNode, type CanvasMeasuredSizes } from "~/canvasDocSync";
import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import {
  useComposerDraftStore,
  useComposerThreadDraft,
  type ComposerImageAttachment,
} from "~/composerDraftStore";
import { toastManager } from "~/components/ui/toast";
import {
  canvasSelectionImageName,
  canvasSelectionNodeSummary,
  type CanvasSelectionContext,
} from "~/lib/canvasSelection";
import { randomUUID } from "~/lib/utils";

import {
  canvasCropRect,
  canvasCropVisibleEntries,
  readCanvasCropPalette,
  renderCanvasSelectionCrop,
} from "./canvasSelectionCrop";

/**
 * Image nodes the crop may need to paint: every image overlapping the crop
 * rect, not just the selected ones, so surrounding context renders too.
 */
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

export function CanvasAddToChatBar(props: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  revision: number;
  selectedIds: readonly string[];
  measuredSizes: CanvasMeasuredSizes | undefined;
  /** Element whose computed colors the crop should paint with. */
  paletteRef: React.RefObject<HTMLElement | null>;
}) {
  const { doc, selectedIds, threadRef } = props;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const addCanvasSelection = useComposerDraftStore((store) => store.addCanvasSelection);
  const addImage = useComposerDraftStore((store) => store.addImage);
  const draftImageCount = useComposerThreadDraft(threadRef).images.length;

  const imageNodes = cropImageNodes(doc, selectedIds, props.measuredSizes);
  // Signed asset URLs are resolved up-front through the same hook the image
  // nodes use, so the crop never has to reach into the DOM for a src.
  const assetUrls = useAssetUrls(
    threadRef.environmentId,
    imageNodes.map((node) => ({ _tag: "attachment" as const, attachmentId: node.attachmentId })),
  );

  const submit = async (): Promise<void> => {
    if (busy || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const nodes = selectedIds.flatMap((id) => {
        const node = getNode(doc, id);
        return node === null ? [] : [canvasSelectionNodeSummary(node)];
      });
      if (nodes.length === 0) return;

      const selectionId = randomUUID();
      const trimmedComment = comment.trim();
      const selection: CanvasSelectionContext = {
        id: selectionId,
        docRevision: props.revision,
        ...(trimmedComment.length > 0 ? { comment: trimmedComment } : {}),
        nodes,
      };

      const localPreviews = selectThreadCanvasState(
        useCanvasStore.getState().byThreadKey,
        threadRef,
      ).localImagePreviews;
      const srcByNodeId = new Map<string, string>();
      imageNodes.forEach((node, index) => {
        // A local preview is only authoritative while the payload is still
        // unresolved; once the server has an attachment, that is the bitmap
        // on screen (a stale re-capture preview would crop the wrong image).
        const preview = node.attachmentId === "" ? localPreviews[node.id] : undefined;
        const resolved = preview ?? assetUrls[index] ?? null;
        if (resolved !== null) srcByNodeId.set(node.id, resolved);
      });

      let crop = null;
      try {
        crop = await renderCanvasSelectionCrop({
          doc,
          selectedIds,
          measuredSizes: props.measuredSizes,
          resolveImageSrc: (node) => srcByNodeId.get(node.id) ?? null,
          palette: readCanvasCropPalette(props.paletteRef.current),
          fileName: canvasSelectionImageName(selectionId),
        });
      } catch {
        // A tainted or unreachable bitmap only costs the picture; the
        // structured block still tells the agent exactly what was selected.
      }

      addCanvasSelection(threadRef, selection);

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
        addImage(threadRef, {
          type: "image",
          id: selectionId,
          name: crop.file.name,
          mimeType: crop.file.type,
          sizeBytes: crop.file.size,
          previewUrl: URL.createObjectURL(crop.file),
          file: crop.file,
        } satisfies ComposerImageAttachment);
      }
      setComment("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/95 p-1 pl-2.5 shadow-lg/5 backdrop-blur-md dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/10">
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {selectedIds.length} selected
      </span>
      <input
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Add a note…"
        aria-label="Canvas selection note"
        className="h-7 w-44 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-foreground text-xs outline-none placeholder:text-muted-foreground/70 focus:border-border"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 font-medium text-primary-foreground text-xs transition hover:bg-primary/90 disabled:cursor-default disabled:opacity-60"
      >
        <MessageSquarePlus className="size-3.5" />
        Add to chat
      </button>
    </div>
  );
}
