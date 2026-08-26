import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import {
  appendDictationSegment,
  formatDictationInsertion,
  replaceDictationInsertion,
  transcribeDictationAudio,
} from "./dictation.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test/base",
  wsBaseUrl: "wss://environment.example.test",
});

const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target,
};

describe("dictation composer insertion", () => {
  it("joins chunks and preserves surrounding word boundaries", () => {
    const transcript = appendDictationSegment("first thought", "  second thought  ");
    const insertion = formatDictationInsertion({
      before: "Please",
      after: "today.",
      transcript,
    });

    expect(insertion).toBe(" first thought second thought ");
    expect(
      replaceDictationInsertion({
        value: "Pleasetoday.",
        start: 6,
        before: "Please",
        after: "today.",
        previous: "",
        next: insertion,
      }),
    ).toEqual({ value: "Please first thought second thought today.", cursor: 36 });
  });

  it("refuses to overwrite composer text that changed during dictation", () => {
    expect(
      replaceDictationInsertion({
        value: "edited elsewhere",
        start: 0,
        before: "",
        after: "",
        previous: "old transcript",
        next: "new transcript",
      }),
    ).toBeNull();
  });

  it("refuses the first insertion after the surrounding composer text changed", () => {
    expect(
      replaceDictationInsertion({
        value: "replaced prompt",
        start: 6,
        before: "Please",
        after: "today.",
        previous: "",
        next: " dictated text ",
      }),
    ).toBeNull();
  });
});

describe("transcribeDictationAudio", () => {
  it.effect("routes audio through the prepared environment HTTP endpoint", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
      const fetchFn = ((request, init) => {
        calls.push([request, init ?? {}]);
        return Promise.resolve(Response.json({ text: "hello from Groq" }));
      }) satisfies typeof fetch;

      const result = yield* transcribeDictationAudio({
        prepared,
        audioBase64: "YXVkaW8=",
        mimeType: "audio/m4a",
      }).pipe(Effect.provide(remoteHttpClientLayer(fetchFn)));

      expect(result).toEqual({ text: "hello from Groq" });
      expect(String(calls[0]?.[0])).toBe(
        "https://environment.example.test/api/dictation/transcribe",
      );
      expect(calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "include" });
    }),
  );
});
