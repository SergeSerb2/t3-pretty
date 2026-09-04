// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  ATTACHMENT_FEED_PREVIEW_VARIANT,
  attachmentFeedPreviewPath,
} from "./attachmentFeedPreviewPath.ts";

export { ATTACHMENT_FEED_PREVIEW_VARIANT, attachmentFeedPreviewPath };

export const ATTACHMENT_FEED_PREVIEW_WIDTH = 1024;
export const ATTACHMENT_FEED_PREVIEW_HEIGHT = 788;
export const ATTACHMENT_FEED_PREVIEW_MAX_PENDING_JOBS = 32;
export const ATTACHMENT_FEED_PREVIEW_MAX_CONCURRENT_JOBS = 2;
export const ATTACHMENT_FEED_PREVIEW_MAX_INPUT_PIXELS = 40_000_000;

const previewJobs = new Map<string, Promise<string>>();
const previewJobWaiters: Array<() => void> = [];
let activePreviewJobs = 0;

class AttachmentPreviewGenerationError extends Data.TaggedError(
  "AttachmentPreviewGenerationError",
)<{ readonly cause: unknown }> {}

export function canStartAttachmentPreviewJob(pendingJobs: number): boolean {
  return (
    Number.isSafeInteger(pendingJobs) &&
    pendingJobs >= 0 &&
    pendingJobs < ATTACHMENT_FEED_PREVIEW_MAX_PENDING_JOBS
  );
}

async function withPreviewJobPermit<A>(run: () => Promise<A>): Promise<A> {
  if (activePreviewJobs < ATTACHMENT_FEED_PREVIEW_MAX_CONCURRENT_JOBS) {
    activePreviewJobs += 1;
  } else {
    // The active count stays reserved while a permit is handed directly to
    // the next waiter, preventing a newly arriving job from stealing it in
    // the microtask gap before the queued continuation resumes.
    await new Promise<void>((resolve) => previewJobWaiters.push(resolve));
  }

  try {
    return await run();
  } finally {
    const next = previewJobWaiters.shift();
    if (next) {
      next();
    } else {
      activePreviewJobs -= 1;
    }
  }
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
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default ?? sharpModule;
    await sharp(input.sourcePath, {
      failOn: "error",
      limitInputPixels: ATTACHMENT_FEED_PREVIEW_MAX_INPUT_PIXELS,
      sequentialRead: true,
    })
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
      if (!canStartAttachmentPreviewJob(previewJobs.size)) {
        // The original asset is already a valid response. Falling back under
        // overload keeps previewing available without building an unbounded
        // queue of native image decodes and temporary files.
        return input.sourcePath;
      }
      job = withPreviewJobPermit(() =>
        createAttachmentFeedPreview({ sourcePath: input.sourcePath, previewPath }),
      );
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
