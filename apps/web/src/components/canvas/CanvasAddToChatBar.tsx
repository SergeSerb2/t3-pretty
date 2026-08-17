"use client";

/**
 * Floating "Add to chat" bar for the current canvas selection. It attaches two
 * things to the composer draft: a structured `<canvas_selection>` context block
 * (node ids, names, sizes, capture origins) and a PNG crop of the selected
 * region, paired by id the way preview annotations are.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { type CanvasMeasuredSizes } from "~/canvasDocSync";
import type { CanvasDocument } from "@t3tools/contracts";

import {
  attachCanvasSelectionToDraft,
  canvasSelectionAttachmentResources,
  canvasSelectionImageSrcByNodeId,
  cropImageNodes,
} from "./canvasSelectionAttach";
import { readCanvasCropPalette } from "./canvasSelectionCrop";

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

  const imageNodes = cropImageNodes(doc, selectedIds, props.measuredSizes);
  const attachmentResources = canvasSelectionAttachmentResources(
    doc,
    selectedIds,
    props.measuredSizes,
  );
  const assetUrls = useAssetUrls(threadRef.environmentId, attachmentResources);

  const submit = async (): Promise<void> => {
    if (busy || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const urlByAttachmentId = new Map(
        attachmentResources.flatMap((resource, index) => {
          const url = assetUrls[index];
          return url ? [[resource.attachmentId, url] as const] : [];
        }),
      );
      const srcByNodeId = canvasSelectionImageSrcByNodeId(threadRef, imageNodes, urlByAttachmentId);
      await attachCanvasSelectionToDraft({
        threadRef,
        doc,
        revision: props.revision,
        selectedIds,
        measuredSizes: props.measuredSizes,
        resolveImageSrc: (node) => srcByNodeId.get(node.id) ?? null,
        palette: readCanvasCropPalette(props.paletteRef.current),
        comment,
      });
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
