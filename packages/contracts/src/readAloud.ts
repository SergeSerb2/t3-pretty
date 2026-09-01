import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export const READ_ALOUD_TEXT_MAX_LENGTH = 200;
export const READ_ALOUD_AUDIO_BASE64_MAX_LENGTH = 8 * 1024 * 1024;

export const ReadAloudUnavailableReason = Schema.Literals([
  "internal_build_required",
  "groq_api_key_missing",
]);
export type ReadAloudUnavailableReason = typeof ReadAloudUnavailableReason.Type;

export class ReadAloudUnavailableError extends Schema.TaggedErrorClass<ReadAloudUnavailableError>()(
  "ReadAloudUnavailableError",
  { reason: ReadAloudUnavailableReason },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(ReadAloudUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    return this.reason === "groq_api_key_missing"
      ? "Read aloud requires GROQ_API_KEY on the connected host."
      : "Read aloud is available only in internal builds.";
  }
}

export class ReadAloudUpstreamError extends Schema.TaggedErrorClass<ReadAloudUpstreamError>()(
  "ReadAloudUpstreamError",
  {},
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(ReadAloudUpstreamError)(this, { status: 502 });
  }

  override get message(): string {
    return "Groq could not generate speech for this response.";
  }
}

export const ReadAloudRequest = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(READ_ALOUD_TEXT_MAX_LENGTH)),
});
export type ReadAloudRequest = typeof ReadAloudRequest.Type;

export const ReadAloudResult = Schema.Struct({
  audioBase64: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(READ_ALOUD_AUDIO_BASE64_MAX_LENGTH),
  ),
  mimeType: Schema.Literal("audio/wav"),
});
export type ReadAloudResult = typeof ReadAloudResult.Type;
