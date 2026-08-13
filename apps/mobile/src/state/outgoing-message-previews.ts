import { useAtomValue } from "@effect/atom-react";
import type { MessageId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { appAtomRegistry } from "./atom-registry";

const outgoingMessagePreviewUrisAtom = Atom.make<Readonly<Record<string, ReadonlyArray<string>>>>(
  {},
).pipe(Atom.keepAlive, Atom.withLabel("mobile:outgoing-message-previews"));

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
  appAtomRegistry.set(outgoingMessagePreviewUrisAtom, {
    ...current,
    [String(messageId)]: [...previewUris],
  });
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
