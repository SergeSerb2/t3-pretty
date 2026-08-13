// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import sharp from "sharp";

import {
  ATTACHMENT_FEED_PREVIEW_HEIGHT,
  ATTACHMENT_FEED_PREVIEW_WIDTH,
  resolveAttachmentFeedPreview,
} from "./AttachmentPreview.ts";

it.effect("creates and reuses a bounded WebP feed preview", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-preview-test-"))),
    (attachmentsDir) =>
      Effect.gen(function* () {
        const attachmentId = "thread-1-00000000-0000-4000-8000-000000000001";
        const sourcePath = NodePath.join(attachmentsDir, `${attachmentId}.png`);
        yield* Effect.promise(() =>
          sharp({
            create: {
              width: 1320,
              height: 2868,
              channels: 4,
              background: { r: 30, g: 100, b: 180, alpha: 1 },
            },
          })
            .png()
            .toFile(sourcePath),
        );

        const first = yield* resolveAttachmentFeedPreview({
          attachmentsDir,
          attachmentId,
          sourcePath,
        });
        const second = yield* resolveAttachmentFeedPreview({
          attachmentsDir,
          attachmentId,
          sourcePath,
        });
        const metadata = yield* Effect.promise(() => sharp(first).metadata());
        const [sourceStat, previewStat] = yield* Effect.promise(() =>
          Promise.all([NodeFSP.stat(sourcePath), NodeFSP.stat(first)]),
        );

        expect(second).toBe(first);
        expect(metadata.format).toBe("webp");
        expect(metadata.width).toBeLessThanOrEqual(ATTACHMENT_FEED_PREVIEW_WIDTH);
        expect(metadata.height).toBeLessThanOrEqual(ATTACHMENT_FEED_PREVIEW_HEIGHT);
        expect(previewStat.size).toBeLessThan(sourceStat.size);
      }),
    (attachmentsDir) =>
      Effect.promise(() => NodeFSP.rm(attachmentsDir, { recursive: true, force: true })),
  ),
);
