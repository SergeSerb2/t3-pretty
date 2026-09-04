import { useAtomValue } from "@effect/atom-react";
import type { MessageId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { appAtomRegistry } from "./atom-registry";

const outgoingMessagePreviewUrisAtom = Atom.make<Readonly<Record<string, ReadonlyArray<string>>>>(
  {},
).pipe(Atom.keepAlive, Atom.withLabel("mobile:outgoing-message-previews"));

/**
 * Previews are only useful for recently sent messages (until the server asset
 * URL resolves), so the record is capped and oldest entries are evicted on
 * write. Without a bound, pasted-image data URLs accumulated for the whole
 * session and grew the JS heap without limit.
 */
const MAX_OUTGOING_MESSAGE_PREVIEW_ENTRIES = 32;
const MAX_OUTGOING_MESSAGE_PREVIEW_URI_CHARACTERS = 32 * 1024 * 1024;

export function boundOutgoingMessagePreviewUris(
  previews: Readonly<Record<string, ReadonlyArray<string>>>,
  options: {
    readonly maxEntries: number;
    readonly maxUriCharacters: number;
  } = {
    maxEntries: MAX_OUTGOING_MESSAGE_PREVIEW_ENTRIES,
    maxUriCharacters: MAX_OUTGOING_MESSAGE_PREVIEW_URI_CHARACTERS,
  },
): Readonly<Record<string, ReadonlyArray<string>>> {
  const maxEntries = Math.max(0, Math.floor(options.maxEntries));
  const maxUriCharacters = Math.max(0, Math.floor(options.maxUriCharacters));
  const next = Object.fromEntries(
    Object.entries(previews).map(([messageId, uris]) => [messageId, [...uris]]),
  );
  const keys = Object.keys(next);
  let uriCharacters = Object.values(next).reduce(
    (total, uris) => total + uris.reduce((entryTotal, uri) => entryTotal + uri.length, 0),
    0,
  );

  while (keys.length > maxEntries || (uriCharacters > maxUriCharacters && keys.length > 1)) {
    const oldestKey = keys.shift();
    if (oldestKey === undefined) break;
    uriCharacters -= (next[oldestKey] ?? []).reduce((total, uri) => total + uri.length, 0);
    delete next[oldestKey];
  }

  // A single failed file-preview write can leave a message carrying data URLs
  // for every attachment. Keep its leading previews within the aggregate
  // budget instead of retaining an otherwise bounded number of huge strings.
  const remainingKey = keys[0];
  if (remainingKey !== undefined && uriCharacters > maxUriCharacters) {
    let remainingCharacters = maxUriCharacters;
    const retainedUris: string[] = [];
    for (const uri of next[remainingKey] ?? []) {
      if (uri.length > remainingCharacters) continue;
      retainedUris.push(uri);
      remainingCharacters -= uri.length;
    }
    if (retainedUris.length > 0) {
      next[remainingKey] = retainedUris;
    } else {
      delete next[remainingKey];
    }
  }

  return next;
}

export function previewUrisFromDraftAttachments(
  attachments: ReadonlyArray<DraftComposerImageAttachment>,
): ReadonlyArray<string> {
  return attachments.map((attachment) => attachment.previewUri);
}

/**
 * Keep the local composer thumbnails for a just-sent message so the thread
 * feed can show them immediately. Server attachment ids are minted on
 * persist, so the feed matches these URIs by message id and index until
 * `assets.createUrl` resolves.
 */
export function rememberOutgoingMessagePreviewUris(
  messageId: MessageId | string,
  previewUris: ReadonlyArray<string>,
): void {
  if (previewUris.length === 0) {
    return;
  }
  const current = appAtomRegistry.get(outgoingMessagePreviewUrisAtom);
  const key = String(messageId);
  const next: Record<string, ReadonlyArray<string>> = { ...current };
  // Re-insertion makes an updated queued message the newest presentation
  // entry instead of evicting it according to its original insertion time.
  delete next[key];
  next[key] = [...previewUris];
  // This map is only a presentation cache, not the file owner. The same URI
  // may still belong to a copied draft or durable outbox entry.
  appAtomRegistry.set(outgoingMessagePreviewUrisAtom, boundOutgoingMessagePreviewUris(next));
}

export function rememberOutgoingMessageDraftAttachments(
  messageId: MessageId | string,
  attachments: ReadonlyArray<DraftComposerImageAttachment>,
): void {
  rememberOutgoingMessagePreviewUris(messageId, previewUrisFromDraftAttachments(attachments));
}

export function getOutgoingMessagePreviewUris(): Readonly<Record<string, ReadonlyArray<string>>> {
  return appAtomRegistry.get(outgoingMessagePreviewUrisAtom);
}

export function useOutgoingMessagePreviewUris(): Readonly<Record<string, ReadonlyArray<string>>> {
  return useAtomValue(outgoingMessagePreviewUrisAtom);
}
