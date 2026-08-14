import * as Schema from "effect/Schema";

export const DraftComposerImageAttachmentSchema = Schema.Struct({
  id: Schema.String,
  previewUri: Schema.String,
  type: Schema.Literal("image"),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});

/**
 * Persisted drafts omit the base64 payload so a keystroke never serializes
 * megabytes of image data; `dataUrl` is rehydrated from the app-owned preview
 * file (or a `data:` preview URI) when the draft loads.
 */
export const PersistedComposerImageAttachmentSchema = Schema.Struct({
  id: Schema.String,
  previewUri: Schema.String,
  type: Schema.Literal("image"),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.optional(Schema.String),
});
