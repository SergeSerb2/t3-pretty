export interface UserMessageImageSource {
  readonly key: string;
  readonly attachmentId: string | null;
  readonly localPreviewUri: string | null;
}

/**
 * Images to render on a user bubble. Server attachments win for identity
 * (signed asset URLs), but a just-sent message can land without them — or
 * with ids that are not fetchable yet. Local composer preview URIs are
 * matched by index, the same handoff web uses.
 */
export function resolveUserMessageImageSources(input: {
  readonly attachments: ReadonlyArray<{ readonly id: string }>;
  readonly localPreviewUris?: ReadonlyArray<string>;
}): ReadonlyArray<UserMessageImageSource> {
  const localPreviewUris = input.localPreviewUris ?? [];
  if (input.attachments.length > 0) {
    return input.attachments.map((attachment, index) => ({
      key: attachment.id,
      attachmentId: attachment.id,
      localPreviewUri: localPreviewUris[index] ?? null,
    }));
  }
  return localPreviewUris.map((uri, index) => ({
    key: `local:${index}`,
    attachmentId: null,
    localPreviewUri: uri,
  }));
}
