import type { DictationAudioMimeType } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  makeEnvironmentHttpApiUrlBuilder,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const DEFAULT_DICTATION_TIMEOUT_MS = 45_000;

export const fetchDictationStatus = Effect.fn("clientRuntime.state.dictation.status")(function* (
  prepared: PreparedConnection,
) {
  const requestUrl = makeEnvironmentHttpApiUrlBuilder(prepared.httpBaseUrl).dictation.status();
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
  const headers = yield* buildEnvironmentAuthHeaders(
    prepared.httpAuthorization,
    "GET",
    requestUrl,
    signer,
  );
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    DEFAULT_DICTATION_TIMEOUT_MS,
    withEnvironmentCredentials(prepared.httpAuthorization, client.dictation.status({ headers })),
  );
});

export const transcribeDictationAudio = Effect.fn("clientRuntime.state.dictation.transcribe")(
  function* (input: {
    readonly prepared: PreparedConnection;
    readonly audioBase64: string;
    readonly mimeType: DictationAudioMimeType;
  }) {
    const requestUrl = makeEnvironmentHttpApiUrlBuilder(
      input.prepared.httpBaseUrl,
    ).dictation.transcribe();
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
    const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
    const headers = yield* buildEnvironmentAuthHeaders(
      input.prepared.httpAuthorization,
      "POST",
      requestUrl,
      signer,
    );
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      DEFAULT_DICTATION_TIMEOUT_MS,
      withEnvironmentCredentials(
        input.prepared.httpAuthorization,
        client.dictation.transcribe({
          headers,
          payload: { audioBase64: input.audioBase64, mimeType: input.mimeType },
        }),
      ),
    );
  },
);

export const cleanupDictation = Effect.fn("clientRuntime.state.dictation.cleanup")(
  function* (input: {
    readonly prepared: PreparedConnection;
    readonly transcript: string;
    readonly before: string;
    readonly after: string;
  }) {
    const requestUrl = makeEnvironmentHttpApiUrlBuilder(
      input.prepared.httpBaseUrl,
    ).dictation.cleanup();
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
    const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
    const headers = yield* buildEnvironmentAuthHeaders(
      input.prepared.httpAuthorization,
      "POST",
      requestUrl,
      signer,
    );
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      DEFAULT_DICTATION_TIMEOUT_MS,
      withEnvironmentCredentials(
        input.prepared.httpAuthorization,
        client.dictation.cleanup({
          headers,
          payload: { transcript: input.transcript, before: input.before, after: input.after },
        }),
      ),
    );
  },
);

export function appendDictationSegment(transcript: string, segment: string): string {
  const next = segment.trim();
  return next.length === 0 ? transcript : [transcript.trim(), next].filter(Boolean).join(" ");
}

export function formatDictationInsertion(input: {
  readonly before: string;
  readonly after: string;
  readonly transcript: string;
}): string {
  const text = input.transcript.trim();
  if (text.length === 0) return "";
  const prefix =
    input.before.length > 0 &&
    !/\s$/.test(input.before) &&
    !/[([{/]$/.test(input.before) &&
    !/^[,.;:!?)}\]]/.test(text)
      ? " "
      : "";
  const suffix =
    input.after.length > 0 && !/^\s/.test(input.after) && !/^[,.;:!?)}\]]/.test(input.after)
      ? " "
      : "";
  return `${prefix}${text}${suffix}`;
}

export function replaceDictationInsertion(input: {
  readonly value: string;
  readonly start: number;
  readonly previous: string;
  readonly next: string;
}): { readonly value: string; readonly cursor: number } | null {
  if (input.value.slice(input.start, input.start + input.previous.length) !== input.previous) {
    return null;
  }
  return {
    value: `${input.value.slice(0, input.start)}${input.next}${input.value.slice(input.start + input.previous.length)}`,
    cursor: input.start + input.next.length,
  };
}
