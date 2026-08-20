import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { extractGeneratedImagePath } from "@t3tools/shared/imageTool";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { useAssetUrlState } from "~/assets/assetUrls";
import { useState, type ImgHTMLAttributes } from "react";

import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import type { WorkLogEntry } from "../../session-logic";

export function fadingImageClassName(loaded: boolean, className?: string): string {
  return cn(
    "max-h-[28rem] w-full rounded-xl object-contain opacity-0 transition-opacity duration-500 ease-out motion-reduce:opacity-100 motion-reduce:transition-none",
    loaded && "opacity-100",
    className,
  );
}

export function FadingImg({ className, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...props}
      className={fadingImageClassName(loaded, className)}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
    />
  );
}

function GeneratedImagePlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="flex aspect-[4/3] max-h-72 items-center justify-center rounded-xl bg-muted/50 text-xs text-muted-foreground">
      {label}
    </div>
  );
}

function WorkspaceGeneratedImage(props: {
  readonly alt: string;
  readonly environmentId: EnvironmentId;
  readonly onExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly path: string;
  readonly threadId: ScopedThreadRef["threadId"];
}) {
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadId,
    path: props.path,
  });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (assetUrl._tag === "Failure" || (assetUrl._tag === "Success" && failedUrl === assetUrl.url)) {
    return <GeneratedImagePlaceholder label="Unable to load generated image." />;
  }
  if (assetUrl._tag !== "Success") {
    return <GeneratedImagePlaceholder label="Generating image…" />;
  }

  return (
    <button
      type="button"
      className="block w-full overflow-hidden rounded-xl bg-muted/30 text-left"
      onClick={() =>
        props.onExpand?.({
          images: [{ src: assetUrl.url, name: props.alt }],
          index: 0,
        })
      }
    >
      <FadingImg src={assetUrl.url} alt={props.alt} onError={() => setFailedUrl(assetUrl.url)} />
    </button>
  );
}

export function ChatMarkdownImage(props: {
  readonly alt?: string | undefined;
  readonly environmentId: EnvironmentId | null;
  readonly localPath?: string | null | undefined;
  readonly src: string;
  readonly threadRef?: ScopedThreadRef | undefined;
}) {
  const alt = props.alt?.trim() || "Generated image";
  if (/^(?:https?:|data:)/iu.test(props.src)) {
    return <FadingImg src={props.src} alt={alt} />;
  }
  const localPath = props.localPath ?? null;
  if (
    localPath &&
    props.threadRef &&
    props.environmentId &&
    isWorkspaceImagePreviewPath(localPath)
  ) {
    return (
      <div className="my-2 max-w-xl">
        <WorkspaceGeneratedImage
          alt={alt}
          environmentId={props.environmentId}
          path={localPath}
          threadId={props.threadRef.threadId}
        />
      </div>
    );
  }
  return <FadingImg src={props.src} alt={alt} />;
}

export function generatedImageWorkEntryPath(workEntry: WorkLogEntry): string | undefined {
  if (workEntry.itemType !== "image_generation") {
    return undefined;
  }
  return extractGeneratedImagePath({
    changedFiles: workEntry.changedFiles,
    detail: workEntry.detail,
    data: workEntry.toolData,
  });
}

export function GeneratedImageCard(props: {
  readonly environmentId: EnvironmentId | null;
  readonly onExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly path: string | undefined;
  readonly pending: boolean;
  readonly threadRef: ScopedThreadRef | null;
}) {
  if (!props.path || !props.threadRef || !props.environmentId) {
    return (
      <GeneratedImagePlaceholder
        label={props.pending ? "Generating image…" : "Image unavailable."}
      />
    );
  }
  return (
    <WorkspaceGeneratedImage
      alt="Generated image"
      environmentId={props.environmentId}
      onExpand={props.onExpand}
      path={props.path}
      threadId={props.threadRef.threadId}
    />
  );
}
