import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { extractGeneratedImagePath } from "@t3tools/shared/imageTool";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { useAssetUrlState } from "~/assets/assetUrls";
import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";

import { resolveMarkdownFileLinkMeta } from "../../markdown-links";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import type { WorkLogEntry } from "../../session-logic";

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** Join a generated-image path against the workspace cwd when it is relative. */
export function resolveGeneratedImageAssetPath(
  path: string,
  cwd: string | undefined,
): string | null {
  // Grok session folders use literal `%2F` segments. URI-decoding those
  // absolute tool paths would collapse them into the wrong location.
  const resolved = isAbsoluteFilesystemPath(path)
    ? path
    : (resolveMarkdownFileLinkMeta(path, cwd)?.filePath ?? path);
  return isWorkspaceImagePreviewPath(resolved) ? resolved : null;
}

export function fadingImageClassName(loaded: boolean, className?: string): string {
  return cn(
    "max-h-[28rem] w-full rounded-xl object-contain opacity-0 transition-opacity duration-500 ease-out motion-reduce:opacity-100 motion-reduce:transition-none",
    loaded && "opacity-100",
    className,
  );
}

/** Cached and already-failed images report `complete` without firing onLoad. */
export function isFadingImageSettled(image: { readonly complete: boolean } | null): boolean {
  return image?.complete === true;
}

export function FadingImg({
  className,
  onError,
  onLoad,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    setLoaded(isFadingImageSettled(imgRef.current));
  }, [src]);

  return (
    <img
      {...props}
      ref={imgRef}
      src={src}
      className={fadingImageClassName(loaded, className)}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(true);
        onError?.(event);
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
    return <GeneratedImagePlaceholder label="Loading image…" />;
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
  readonly onExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
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
          onExpand={props.onExpand}
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
  readonly cwd?: string | undefined;
  readonly environmentId: EnvironmentId | null;
  readonly onExpand?: ((preview: ExpandedImagePreview) => void) | undefined;
  readonly path: string | undefined;
  readonly pending: boolean;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const path = props.path ? resolveGeneratedImageAssetPath(props.path, props.cwd) : null;
  if (!path || !props.threadRef || !props.environmentId) {
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
      path={path}
      threadId={props.threadRef.threadId}
    />
  );
}
