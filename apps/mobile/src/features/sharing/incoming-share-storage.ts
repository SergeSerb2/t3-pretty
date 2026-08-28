import * as Schema from "effect/Schema";

import { removeStaleAtomicWriteTempFiles, writeFileAtomically } from "../../lib/atomic-file";
import {
  deleteComposerPreviewFiles,
  isOwnedComposerPreviewUri,
  resolveComposerAttachmentDataUrl,
  writeComposerPreviewFile,
} from "../../lib/composerImages";
import { compareTimestamps } from "../../lib/time";
import { decodeIncomingShareDraft, type IncomingShareDraft } from "./incoming-share-model";

const INCOMING_SHARE_DIRECTORY = "incoming-shares";

export class IncomingShareStorageError extends Schema.TaggedErrorClass<IncomingShareStorageError>()(
  "IncomingShareStorageError",
  {
    operation: Schema.Literals(["load", "write", "remove"]),
    shareId: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Incoming share storage operation ${this.operation} failed for ${this.shareId ?? "unknown"}.`;
  }
}

function fileName(shareId: string): string {
  return `${encodeURIComponent(shareId)}.json`;
}

async function getDirectory() {
  const { Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, INCOMING_SHARE_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

async function getFile(shareId: string) {
  const { File } = await import("expo-file-system");
  return new File(await getDirectory(), fileName(shareId));
}

/** Keep inbox JSON small; attachment bytes live in app-owned preview files. */
export function encodeIncomingShareDraftForPersistence(
  draft: IncomingShareDraft,
): IncomingShareDraft {
  return {
    ...draft,
    attachments: draft.attachments.map((attachment) => ({
      ...attachment,
      // A non-owned preview can disappear between launches. Preserve its
      // payload until load-time migration successfully materializes our copy.
      dataUrl: isOwnedComposerPreviewUri(attachment.previewUri) ? "" : attachment.dataUrl,
    })),
  };
}

export interface IncomingShareAttachmentStorage {
  readonly resolveDataUrl: typeof resolveComposerAttachmentDataUrl;
  readonly writePreviewFile: typeof writeComposerPreviewFile;
  readonly deletePreviewFiles?: (uris: ReadonlyArray<string>) => Promise<void>;
}

const defaultAttachmentStorage: IncomingShareAttachmentStorage = {
  resolveDataUrl: resolveComposerAttachmentDataUrl,
  writePreviewFile: writeComposerPreviewFile,
  deletePreviewFiles: deleteComposerPreviewFiles,
};

function base64Payload(dataUrl: string): string | null {
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  return dataUrl.startsWith("data:") && index >= 0 ? dataUrl.slice(index + marker.length) : null;
}

/** Hydrate compact attachments and migrate legacy data-backed previews. */
export async function prepareIncomingShareDraftForUse(
  draft: IncomingShareDraft,
  storage: IncomingShareAttachmentStorage = defaultAttachmentStorage,
): Promise<{
  readonly draft: IncomingShareDraft;
  readonly migrated: boolean;
  readonly requiresRewrite: boolean;
  readonly createdPreviewUris: ReadonlyArray<string>;
}> {
  let migrated = false;
  const createdPreviewUris: string[] = [];
  const attachments: IncomingShareDraft["attachments"][number][] = [];
  try {
    // Process at most eight attachments one at a time. Concurrent base64 reads
    // can briefly multiply the 10 MB per-image budget, and a sibling failure
    // must not strand previews already created by this migration.
    for (const attachment of draft.attachments) {
      const dataUrl =
        attachment.dataUrl.length > 0
          ? attachment.dataUrl
          : await storage.resolveDataUrl(attachment, { throwOnReadError: true });
      if (dataUrl === null) {
        continue;
      }
      if (isOwnedComposerPreviewUri(attachment.previewUri)) {
        attachments.push(attachment.dataUrl === dataUrl ? attachment : { ...attachment, dataUrl });
        continue;
      }
      const base64 = base64Payload(dataUrl);
      if (base64 === null) {
        attachments.push({ ...attachment, dataUrl });
        continue;
      }
      const previewUri = await storage.writePreviewFile({
        base64,
        extension: attachment.mimeType.split("/")[1] ?? "png",
      });
      if (previewUri === null) {
        attachments.push({ ...attachment, dataUrl });
        continue;
      }
      migrated = true;
      createdPreviewUris.push(previewUri);
      attachments.push({ ...attachment, dataUrl, previewUri });
    }
  } catch (cause) {
    try {
      await (storage.deletePreviewFiles ?? deleteComposerPreviewFiles)(createdPreviewUris);
    } catch (cleanupError) {
      console.warn("[incoming-share] could not roll back migrated previews", cleanupError);
    }
    throw cause;
  }
  const nextDraft =
    attachments.length === draft.attachments.length
      ? { ...draft, attachments }
      : {
          ...draft,
          attachments,
          warnings: [...draft.warnings, "One shared image is no longer available."],
        };
  return {
    draft: nextDraft,
    migrated,
    requiresRewrite: migrated || attachments.length !== draft.attachments.length,
    createdPreviewUris,
  };
}

export async function loadIncomingShareDrafts(): Promise<ReadonlyArray<IncomingShareDraft>> {
  try {
    const { File } = await import("expo-file-system");
    const drafts: IncomingShareDraft[] = [];
    const directory = await getDirectory();
    await removeStaleAtomicWriteTempFiles(directory);
    for (const entry of directory.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith(".json")) {
        continue;
      }
      try {
        const decoded = decodeIncomingShareDraft(JSON.parse(await entry.text()) as unknown);
        const prepared = await prepareIncomingShareDraftForUse(decoded);
        if (prepared.requiresRewrite) {
          try {
            await writeIncomingShareDraft(prepared.draft);
          } catch (cause) {
            await deleteComposerPreviewFiles(prepared.createdPreviewUris);
            drafts.push(decoded);
            console.warn(
              "[incoming-share] could not compact persisted share",
              new IncomingShareStorageError({ operation: "write", shareId: decoded.id, cause }),
            );
            continue;
          }
        }
        drafts.push(prepared.draft);
      } catch (cause) {
        console.warn(
          "[incoming-share] ignored invalid persisted share",
          new IncomingShareStorageError({ operation: "load", shareId: null, cause }),
        );
      }
    }
    return drafts.sort((left, right) => compareTimestamps(right.createdAt, left.createdAt));
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "load", shareId: null, cause });
  }
}

export async function writeIncomingShareDraft(draft: IncomingShareDraft): Promise<void> {
  try {
    const file = await getFile(draft.id);
    await writeFileAtomically(file, JSON.stringify(encodeIncomingShareDraftForPersistence(draft)));
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "write", shareId: draft.id, cause });
  }
}

export async function removeIncomingShareDraft(shareId: string): Promise<void> {
  try {
    const file = await getFile(shareId);
    if (file.exists) {
      file.delete();
    }
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "remove", shareId, cause });
  }
}
