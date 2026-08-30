import {
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { ResolvedSharePayload, SharePayload } from "expo-sharing";

import { DraftComposerImageAttachmentSchema } from "../../lib/composer-image-schema";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import { estimateBase64ByteSize } from "../../lib/base64";

export interface IncomingShareDraft {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly destination?: IncomingShareDestination;
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly warnings: ReadonlyArray<string>;
}

export interface IncomingShareDestination {
  readonly environmentId: string;
  readonly projectId: string;
}

const IncomingShareDestinationSchema = Schema.Struct({
  environmentId: Schema.String,
  projectId: Schema.String,
});

export const IncomingShareDraftSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  createdAt: Schema.String,
  destination: Schema.optional(IncomingShareDestinationSchema),
  text: Schema.String,
  attachments: Schema.Array(DraftComposerImageAttachmentSchema),
  warnings: Schema.Array(Schema.String),
});

const decodeIncomingShareDraftSync = Schema.decodeUnknownSync(IncomingShareDraftSchema);

export function decodeIncomingShareDraft(value: unknown): IncomingShareDraft {
  return decodeIncomingShareDraftSync(value);
}

export interface IncomingShareFileReader {
  /** Returns null when a native size preflight exceeds maxBytes. */
  readonly readBase64: (uri: string, maxBytes: number) => Promise<string | null>;
  readonly writePreviewFile: (input: {
    readonly base64: string;
    readonly extension: string;
  }) => Promise<string | null>;
  readonly removeOwnedFile: (uri: string) => Promise<void> | void;
}

function sharedText(payloads: ReadonlyArray<SharePayload>): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const seen = new Set<string>();
  const values: string[] = [];
  let length = 0;
  for (const payload of payloads) {
    if (payload.shareType !== "text" && payload.shareType !== "url") {
      continue;
    }
    const value = payload.value.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const separatorLength = values.length > 0 ? 2 : 0;
    const available = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - length - separatorLength;
    if (available <= 0) {
      return { text: values.join("\n\n"), truncated: true };
    }
    if (value.length > available) {
      values.push(value.slice(0, available));
      return { text: values.join("\n\n"), truncated: true };
    }
    values.push(value);
    length += separatorLength + value.length;
  }
  return { text: values.join("\n\n"), truncated: false };
}

function resolvedImageFor(
  payload: SharePayload,
  index: number,
  resolvedPayloads: ReadonlyArray<ResolvedSharePayload>,
  consumedIndexes: Set<number>,
): ResolvedSharePayload | undefined {
  const sameIndex = resolvedPayloads[index];
  if (
    !consumedIndexes.has(index) &&
    sameIndex?.shareType === payload.shareType &&
    sameIndex.value === payload.value
  ) {
    consumedIndexes.add(index);
    return sameIndex;
  }
  const matchingIndex = resolvedPayloads.findIndex(
    (candidate, candidateIndex) =>
      !consumedIndexes.has(candidateIndex) &&
      candidate.shareType === payload.shareType &&
      candidate.value === payload.value,
  );
  if (matchingIndex < 0) {
    return undefined;
  }
  consumedIndexes.add(matchingIndex);
  return resolvedPayloads[matchingIndex];
}

async function releaseOwnedFiles(
  fileReader: IncomingShareFileReader,
  uris: ReadonlyArray<string | undefined>,
): Promise<void> {
  for (const uri of new Set(uris.filter((candidate): candidate is string => Boolean(candidate)))) {
    try {
      await fileReader.removeOwnedFile(uri);
    } catch {
      // Temporary-file cleanup is best-effort and must never discard content
      // that was successfully converted into a durable composer attachment.
    }
  }
}

function fallbackName(uri: string, index: number, mimeType: string): string {
  try {
    const pathName = new URL(uri).pathname.split("/").findLast((segment) => segment.length > 0);
    if (pathName) {
      return decodeURIComponent(pathName);
    }
  } catch {
    // Fall through to a deterministic attachment name.
  }
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9.+-]/gi, "") || "png";
  return `shared-image-${index + 1}.${extension}`;
}

export async function buildIncomingShareDraft(input: {
  readonly payloads: ReadonlyArray<SharePayload>;
  readonly resolvedPayloads: ReadonlyArray<ResolvedSharePayload>;
  readonly fileReader: IncomingShareFileReader;
  readonly id: string;
  readonly createdAt: string;
}): Promise<IncomingShareDraft> {
  const attachments: DraftComposerImageAttachment[] = [];
  const warnings: string[] = [];
  const text = sharedText(input.payloads);
  if (text.truncated) {
    warnings.push(
      `Shared text was truncated to the ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US")} character composer limit.`,
    );
  }
  const consumedResolvedPayloadIndexes = new Set<number>();
  let warnedAttachmentLimit = false;

  for (const [index, payload] of input.payloads.entries()) {
    if (payload.shareType !== "image") {
      continue;
    }
    const resolved = resolvedImageFor(
      payload,
      index,
      input.resolvedPayloads,
      consumedResolvedPayloadIndexes,
    );
    const uri = resolved?.contentUri ?? payload.value;
    if (attachments.length >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      if (!warnedAttachmentLimit) {
        warnings.push(
          `Only the first ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} shared images were attached.`,
        );
        warnedAttachmentLimit = true;
      }
      await releaseOwnedFiles(input.fileReader, [uri, payload.value]);
      continue;
    }

    const mimeType = (resolved?.contentMimeType ?? payload.mimeType ?? "image/png").toLowerCase();
    if (!uri || !mimeType.startsWith("image/")) {
      warnings.push("One shared item was not a supported image.");
      await releaseOwnedFiles(input.fileReader, [uri, payload.value]);
      continue;
    }
    if (!isProviderSendTurnSupportedImageMimeType(mimeType)) {
      warnings.push(
        `'${resolved?.originalName ?? fallbackName(uri, index, mimeType)}' is not a supported image type.`,
      );
      await releaseOwnedFiles(input.fileReader, [uri, payload.value]);
      continue;
    }
    if (
      resolved?.contentSize !== null &&
      resolved?.contentSize !== undefined &&
      resolved.contentSize > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
    ) {
      warnings.push(
        `'${resolved.originalName ?? fallbackName(uri, index, mimeType)}' exceeds the 10 MB attachment limit.`,
      );
      await releaseOwnedFiles(input.fileReader, [uri, payload.value]);
      continue;
    }

    try {
      const base64 = await input.fileReader.readBase64(uri, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
      if (base64 === null) {
        warnings.push(
          `'${resolved?.originalName ?? fallbackName(uri, index, mimeType)}' exceeds the 10 MB attachment limit.`,
        );
        continue;
      }
      // Provider metadata is only an early rejection hint. Enforce the hard
      // limit against the bytes that will actually be persisted and sent.
      const sizeBytes = estimateBase64ByteSize(base64);
      if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        warnings.push(
          `'${resolved?.originalName ?? fallbackName(uri, index, mimeType)}' exceeds the 10 MB attachment limit.`,
        );
        continue;
      }
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const previewUri = await input.fileReader.writePreviewFile({
        base64,
        extension: mimeType.split("/")[1] ?? "png",
      });
      if (previewUri === null) {
        warnings.push(
          `Could not preserve '${resolved?.originalName ?? fallbackName(uri, index, mimeType)}'.`,
        );
        continue;
      }
      attachments.push({
        id: `${input.id}:image:${index}`,
        type: "image",
        name: resolved?.originalName ?? fallbackName(uri, index, mimeType),
        mimeType,
        sizeBytes,
        dataUrl,
        // The share provider's file is temporary. The app-owned preview is the
        // durable byte source after the inbox strips dataUrl for persistence.
        previewUri,
      });
    } catch {
      warnings.push(`Could not read '${fallbackName(uri, index, mimeType)}'.`);
    } finally {
      await releaseOwnedFiles(input.fileReader, [uri, payload.value]);
    }
  }

  return {
    schemaVersion: 1,
    id: input.id,
    createdAt: input.createdAt,
    text: text.text,
    attachments,
    warnings,
  };
}

export function hasIncomingShareContent(draft: IncomingShareDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}
