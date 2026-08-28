import { ReadAloudUpstreamError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { requestGroqSpeech } from "./http.ts";

const decodeGroqSpeechRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      model: Schema.String,
      input: Schema.String,
      voice: Schema.String,
      response_format: Schema.String,
    }),
  ),
);

const WAV_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0,
  0, 1, 0, 1, 0, 0x80, 0xbb, 0, 0, 0, 0x77, 1, 0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
]);

describe("requestGroqSpeech", () => {
  it.effect("sends the natural Groq voice request and returns validated WAV audio", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly authorization: string | undefined; readonly body: string }> =
        [];
      const client = HttpClient.make((request, url) => {
        expect(url.toString()).toBe("https://api.groq.com/openai/v1/audio/speech");
        requests.push({
          authorization: request.headers.authorization,
          body:
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        });
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(WAV_HEADER, { status: 200, headers: { "content-type": "audio/wav" } }),
          ),
        );
      });

      const result = yield* requestGroqSpeech("secret", "Read this response.").pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]?.authorization).toBe("Bearer secret");
      const body = yield* decodeGroqSpeechRequest(requests[0]?.body ?? "{}");
      expect(body).toEqual({
        model: "canopylabs/orpheus-v1-english",
        input: "Read this response.",
        voice: "hannah",
        response_format: "wav",
      });
      expect(result.mimeType).toBe("audio/wav");
      expect(result.audioBase64).toBe(Buffer.from(WAV_HEADER).toString("base64"));
    }),
  );

  it.effect("rejects a successful upstream response that is not WAV audio", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not audio"))),
      );

      const error = yield* requestGroqSpeech("secret", "Read this response.").pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.flip,
      );

      expect(error).toBeInstanceOf(ReadAloudUpstreamError);
    }),
  );
});
