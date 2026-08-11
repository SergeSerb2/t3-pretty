"use client";

import type { CanvasImageNode, EnvironmentId } from "@t3tools/contracts";
import { ImageOff } from "lucide-react";
import { useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";

/**
 * Image node. A pending image (empty attachmentId sentinel, before the server
 * resolves the payload) renders the local dataUrl preview from the canvas
 * store; a resolved image loads through the signed asset URL, holding the
 * previous URL string across refreshes so re-signing never flickers the
 * bitmap.
 */
export function CanvasImageNodeView(props: {
  node: CanvasImageNode;
  environmentId: EnvironmentId;
  localPreviewUrl: string | null;
  size: { width: number; height: number };
}) {
  const { node } = props;
  const pending = node.attachmentId === "";
  return (
    <div
      className="absolute top-0 left-0 overflow-hidden rounded-[3px] bg-muted shadow-sm ring-1 ring-black/5 dark:ring-white/10"
      style={{ width: Math.max(props.size.width, 1), height: Math.max(props.size.height, 1) }}
    >
      {pending ? (
        props.localPreviewUrl !== null ? (
          <CanvasNodeImage src={props.localPreviewUrl} alt={node.name ?? "Canvas image"} />
        ) : (
          <ImageSkeleton />
        )
      ) : (
        <AttachmentImage node={node} environmentId={props.environmentId} />
      )}
    </div>
  );
}

function AttachmentImage({
  node,
  environmentId,
}: {
  node: CanvasImageNode;
  environmentId: EnvironmentId;
}) {
  const assetUrl = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId: node.attachmentId,
  });
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Hold the previously resolved URL until the refreshed string actually
  // differs (signed-URL refreshes routinely re-resolve to the same URL).
  if (assetUrl._tag === "Success" && assetUrl.url !== resolvedUrl) {
    setResolvedUrl(assetUrl.url);
  }
  if (resolvedUrl !== null && failedUrl !== resolvedUrl) {
    return (
      <CanvasNodeImage
        src={resolvedUrl}
        alt={node.name ?? "Canvas image"}
        onError={() => setFailedUrl(resolvedUrl)}
      />
    );
  }
  if (assetUrl._tag === "Failure" || failedUrl !== null) {
    return <BrokenImage name={node.name ?? null} />;
  }
  return <ImageSkeleton />;
}

function CanvasNodeImage(props: { src: string; alt: string; onError?: () => void }) {
  return (
    <img
      src={props.src}
      alt={props.alt}
      draggable={false}
      className="size-full select-none object-fill"
      onError={props.onError}
    />
  );
}

function ImageSkeleton() {
  return <div aria-hidden="true" className="size-full animate-pulse bg-muted-foreground/10" />;
}

function BrokenImage({ name }: { name: string | null }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-muted-foreground">
      <ImageOff aria-hidden="true" className="size-4 shrink-0" />
      <span className="max-w-full truncate text-[10px] leading-tight">
        {name ?? "Image unavailable"}
      </span>
    </div>
  );
}
