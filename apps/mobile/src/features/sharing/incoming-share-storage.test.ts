import { describe, expect, it, vi } from "@effect/vitest";

import type { IncomingShareDraft } from "./incoming-share-model";
import {
  encodeIncomingShareDraftForPersistence,
  prepareIncomingShareDraftForUse,
} from "./incoming-share-storage";

const DATA_URL = "data:image/png;base64,YWJj";
const OWNED_PREVIEW = "file:///documents/t3-composer-previews/share.png";

function draft(previewUri: string, dataUrl = DATA_URL): IncomingShareDraft {
  return {
    schemaVersion: 1,
    id: "share-1",
    createdAt: "2026-07-15T10:00:00.000Z",
    text: "",
    attachments: [
      {
        id: "image-1",
        type: "image",
        name: "share.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl,
        previewUri,
      },
    ],
    warnings: [],
  };
}

describe("incoming share storage", () => {
  it("omits payloads only when an app-owned preview durably holds the bytes", () => {
    const compact = encodeIncomingShareDraftForPersistence(draft(OWNED_PREVIEW));
    expect(compact.attachments[0]?.dataUrl).toBe("");
    expect(JSON.stringify(compact)).not.toContain(";base64,");

    const transient = encodeIncomingShareDraftForPersistence(draft("file:///temporary/share.png"));
    expect(transient.attachments[0]?.dataUrl).toBe(DATA_URL);
  });

  it("materializes a durable preview before compacting a legacy data-backed share", async () => {
    const writePreviewFile = vi.fn(async () => OWNED_PREVIEW);
    const prepared = await prepareIncomingShareDraftForUse(draft(DATA_URL), {
      resolveDataUrl: vi.fn(async () => DATA_URL),
      writePreviewFile,
    });

    expect(prepared.migrated).toBe(true);
    expect(prepared.requiresRewrite).toBe(true);
    expect(prepared.createdPreviewUris).toEqual([OWNED_PREVIEW]);
    expect(prepared.draft.attachments[0]?.previewUri).toBe(OWNED_PREVIEW);
    expect(writePreviewFile).toHaveBeenCalledWith({ base64: "YWJj", extension: "png" });
    expect(JSON.stringify(encodeIncomingShareDraftForPersistence(prepared.draft))).not.toContain(
      ";base64,",
    );
  });

  it("rehydrates a compact attachment from its owned preview", async () => {
    const resolveDataUrl = vi.fn(async () => DATA_URL);
    const writePreviewFile = vi.fn(async () => null);
    const prepared = await prepareIncomingShareDraftForUse(draft(OWNED_PREVIEW, ""), {
      resolveDataUrl,
      writePreviewFile,
    });

    expect(prepared.draft.attachments[0]?.dataUrl).toBe(DATA_URL);
    expect(prepared.migrated).toBe(false);
    expect(prepared.requiresRewrite).toBe(false);
    expect(resolveDataUrl).toHaveBeenCalledTimes(1);
    expect(writePreviewFile).not.toHaveBeenCalled();
  });

  it("removes previews created before a later attachment migration fails", async () => {
    const deletePreviewFiles = vi.fn(async () => undefined);
    const failingDraft: IncomingShareDraft = {
      ...draft("file:///temporary/first.png"),
      attachments: [
        draft("file:///temporary/first.png").attachments[0]!,
        {
          ...draft("file:///documents/t3-composer-previews/second.png", "").attachments[0]!,
          id: "image-2",
        },
      ],
    };

    await expect(
      prepareIncomingShareDraftForUse(failingDraft, {
        resolveDataUrl: vi.fn(async () => {
          throw new Error("transient read failure");
        }),
        writePreviewFile: vi.fn(async () => OWNED_PREVIEW),
        deletePreviewFiles,
      }),
    ).rejects.toThrow("transient read failure");

    expect(deletePreviewFiles).toHaveBeenCalledWith([OWNED_PREVIEW]);
  });
});
