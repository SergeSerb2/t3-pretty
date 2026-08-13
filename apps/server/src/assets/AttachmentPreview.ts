// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import sharp from "sharp";

import { normalizeAttachmentRelativePath } from "../attachmentPaths.ts";

export const ATTACHMENT_FEED_PREVIEW_VARIANT = "feed-preview";
export const ATTACHMENT_FEED_PREVIEW_WIDTH = 1024;
export const ATTACHMENT_FEED_PREVIEW_HEIGHT = 788;
const ATTACHMENT_FEED_PREVIEW_VERSION = 1;

const previewJobs = new Map<string, Promise<string>>();

class AttachmentPreviewGenerationError extends Data.TaggedError(
  "AttachmentPreviewGenerationError",
)<{ readonly cause: unknown }> {}

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

async function createAttachmentFeedPreview(input: {
  readonly sourcePath: string;
  readonly previewPath: string;
}): Promise<string> {
  try {
    await NodeFSP.access(input.previewPath);
    return input.previewPath;
  } catch {
    // Generate below.
  }

  await NodeFSP.mkdir(NodePath.dirname(input.previewPath), { recursive: true });
  const temporaryPath = `${input.previewPath}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await sharp(input.sourcePath)
      .rotate()
      .resize({
        width: ATTACHMENT_FEED_PREVIEW_WIDTH,
        height: ATTACHMENT_FEED_PREVIEW_HEIGHT,
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toFile(temporaryPath);
    await NodeFSP.rename(temporaryPath, input.previewPath);
    return input.previewPath;
  } finally {
    await NodeFSP.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Lazily creates one immutable feed-sized derivative per attachment. Concurrent
 * first requests share the same job, while generation failures fall back to
 * the original asset so an unsupported image codec never breaks the thread.
 */
export const resolveAttachmentFeedPreview = Effect.fn("AttachmentPreview.resolveFeedPreview")(
  function* (input: {
    readonly attachmentsDir: string;
    readonly attachmentId: string;
    readonly sourcePath: string;
  }) {
    const previewPath = attachmentFeedPreviewPath(input);
    if (!previewPath) {
      return input.sourcePath;
    }

    let job = previewJobs.get(previewPath);
    if (!job) {
      job = createAttachmentFeedPreview({ sourcePath: input.sourcePath, previewPath });
      previewJobs.set(previewPath, job);
      const startedJob = job;
      const releaseJob = () => {
        if (previewJobs.get(previewPath) === startedJob) {
          previewJobs.delete(previewPath);
        }
      };
      void startedJob.then(releaseJob, releaseJob);
    }

    const pendingJob = job;
    return yield* Effect.tryPromise({
      try: () => pendingJob,
      catch: (cause) => new AttachmentPreviewGenerationError({ cause }),
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Could not generate attachment feed preview; serving the original.", {
          attachmentId: input.attachmentId,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => input.sourcePath),
    );
  },
);
