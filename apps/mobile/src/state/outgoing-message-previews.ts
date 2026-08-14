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
  const next: Record<string, ReadonlyArray<string>> = {
    ...current,
    [String(messageId)]: [...previewUris],
  };
  const keys = Object.keys(next);
  const evictedUris: string[] = [];
  while (keys.length > MAX_OUTGOING_MESSAGE_PREVIEW_ENTRIES) {
    const oldestKey = keys.shift();
    if (oldestKey === undefined) {
      break;
    }
    evictedUris.push(...(next[oldestKey] ?? []));
    delete next[oldestKey];
  }
  appAtomRegistry.set(outgoingMessagePreviewUrisAtom, next);
  if (evictedUris.length > 0) {
    // Lazy: composerImages pulls in expo modules, which must stay out of this
    // module's import graph (state modules load in tests and headless contexts).
    void import("../lib/composerImages").then(({ deleteComposerPreviewFiles }) =>
      deleteComposerPreviewFiles(evictedUris),
    );
  }
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
