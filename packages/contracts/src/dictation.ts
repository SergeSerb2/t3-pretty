import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export const DICTATION_AUDIO_BASE64_MAX_LENGTH = 4 * 1024 * 1024;
export const DICTATION_CONTEXT_MAX_LENGTH = 8 * 1024;
export const DICTATION_TRANSCRIPT_MAX_LENGTH = 64 * 1024;

export const DictationAudioMimeType = Schema.Literals([
  "audio/mp4",
  "audio/m4a",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
export type DictationAudioMimeType = typeof DictationAudioMimeType.Type;

export const DictationUnavailableReason = Schema.Literals([
  "internal_build_required",
  "groq_api_key_missing",
]);
export type DictationUnavailableReason = typeof DictationUnavailableReason.Type;

export const DictationUpstreamFailureReason = Schema.Literals([
  "transcription_failed",
  "cleanup_failed",
]);
export type DictationUpstreamFailureReason = typeof DictationUpstreamFailureReason.Type;

export class DictationUnavailableError extends Schema.TaggedErrorClass<DictationUnavailableError>()(
  "DictationUnavailableError",
  {
    reason: DictationUnavailableReason,
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(DictationUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    return this.reason === "groq_api_key_missing"
      ? "Voice dictation requires GROQ_API_KEY on the connected host."
      : "Voice dictation is available only in internal builds.";
  }
}

export class DictationUpstreamError extends Schema.TaggedErrorClass<DictationUpstreamError>()(
  "DictationUpstreamError",
  {
    reason: DictationUpstreamFailureReason,
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(DictationUpstreamError)(this, { status: 502 });
  }

  override get message(): string {
    return this.reason === "transcription_failed"
      ? "Groq could not transcribe this audio."
      : "Groq could not clean up this dictation.";
  }
}

export const DictationStatusResult = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.NullOr(DictationUnavailableReason),
});
export type DictationStatusResult = typeof DictationStatusResult.Type;

export const DictationTranscriptionRequest = Schema.Struct({
  audioBase64: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(DICTATION_AUDIO_BASE64_MAX_LENGTH),
  ),
  mimeType: DictationAudioMimeType,
});
export type DictationTranscriptionRequest = typeof DictationTranscriptionRequest.Type;

export const DictationTranscriptionResult = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(DICTATION_TRANSCRIPT_MAX_LENGTH)),
});
export type DictationTranscriptionResult = typeof DictationTranscriptionResult.Type;

const DictationContext = Schema.String.check(Schema.isMaxLength(DICTATION_CONTEXT_MAX_LENGTH));

export const DictationCleanupRequest = Schema.Struct({
  transcript: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(DICTATION_TRANSCRIPT_MAX_LENGTH),
  ),
  before: DictationContext,
  after: DictationContext,
});
export type DictationCleanupRequest = typeof DictationCleanupRequest.Type;

export const DictationCleanupResult = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(DICTATION_TRANSCRIPT_MAX_LENGTH)),
});
export type DictationCleanupResult = typeof DictationCleanupResult.Type;
