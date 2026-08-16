// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { normalizeAttachmentRelativePath } from "../attachmentPaths.ts";

export const ATTACHMENT_FEED_PREVIEW_VARIANT = "feed-preview";
const ATTACHMENT_FEED_PREVIEW_VERSION = 1;

export function attachmentFeedPreviewPath(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const attachmentId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!attachmentId || attachmentId.includes("/") || attachmentId.includes(".")) {
    return null;
  }
  return NodePath.join(
    input.attachmentsDir,
    ".previews",
    `${attachmentId}-feed-v${ATTACHMENT_FEED_PREVIEW_VERSION}.webp`,
  );
}
