import {
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  READ_ALOUD_AUDIO_BASE64_MAX_LENGTH,
  ReadAloudUnavailableError,
  ReadAloudUpstreamError,
} from "@t3tools/contracts";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { resolveDictationAvailability } from "../dictation/availability.ts";

const GROQ_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech";
const SPEECH_MODEL = "canopylabs/orpheus-v1-english";
const SPEECH_VOICE = "hannah";
const MAX_AUDIO_BYTES = Math.floor(READ_ALOUD_AUDIO_BASE64_MAX_LENGTH / 4) * 3;

function isWavAudio(audio: Uint8Array): boolean {
  return (
    audio.byteLength >= 44 &&
    audio.byteLength <= MAX_AUDIO_BYTES &&
    audio[0] === 0x52 &&
    audio[1] === 0x49 &&
    audio[2] === 0x46 &&
    audio[3] === 0x46 &&
    audio[8] === 0x57 &&
    audio[9] === 0x41 &&
    audio[10] === 0x56 &&
    audio[11] === 0x45
  );
}

function requireReadAloudApiKey() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const availability = resolveDictationAvailability(T3CODE_BUILD_FLAVOR, apiKey);
  return availability.available
    ? Effect.succeed(apiKey!)
    : Effect.fail(
        new ReadAloudUnavailableError({
          reason: availability.reason ?? "groq_api_key_missing",
        }),
      );
}

export const requestGroqSpeech = Effect.fn("readAloud.requestGroqSpeech")(function* (
  apiKey: string,
  text: string,
) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* HttpClientRequest.post(GROQ_SPEECH_URL).pipe(
    HttpClientRequest.bearerToken(apiKey),
    HttpClientRequest.bodyJsonUnsafe({
      model: SPEECH_MODEL,
      input: text,
      voice: SPEECH_VOICE,
      response_format: "wav",
    }),
    client.execute,
    Effect.mapError(() => new ReadAloudUpstreamError()),
  );
  const audio = new Uint8Array(
    yield* response.arrayBuffer.pipe(Effect.mapError(() => new ReadAloudUpstreamError())),
  );
  if (!isWavAudio(audio)) {
    return yield* new ReadAloudUpstreamError();
  }
  return { audioBase64: Encoding.encodeBase64(audio), mimeType: "audio/wav" as const };
});

const synthesize = Effect.fn("readAloud.synthesize")(function* (text: string) {
  const apiKey = yield* requireReadAloudApiKey();
  return yield* requestGroqSpeech(apiKey, text);
});

export const readAloudHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "readAloud",
  Effect.fnUntraced(function* (handlers) {
    return yield* Effect.succeed(
      handlers.handle(
        "synthesize",
        Effect.fn("environment.readAloud.synthesize")(function* (args) {
          yield* Effect.all([
            annotateEnvironmentRequest(args.endpoint.name),
            requireEnvironmentScope(AuthOrchestrationOperateScope),
          ]);
          return yield* synthesize(args.payload.text);
        }),
      ),
    );
  }),
);
