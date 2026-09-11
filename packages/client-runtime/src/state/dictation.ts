import {
  DictationUnavailableError,
  DictationUpstreamError,
  type DictationAudioMimeType,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { PreparedConnection } from "../connection/model.ts";
import type { EnvironmentPresentation } from "../connection/presentation.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequestWithAdditionalError,
  makeEnvironmentHttpApiClient,
  makeEnvironmentHttpApiUrlBuilder,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const DEFAULT_DICTATION_TIMEOUT_MS = 45_000;
const isDictationHttpError = Schema.is(
  Schema.Union([DictationUnavailableError, DictationUpstreamError]),
);

/** Prefer the draft's host, then share any connected host that advertises dictation. */
export function createDictationHostAtoms(input: {
  readonly presentationsAtom: Atom.Atom<ReadonlyMap<EnvironmentId, EnvironmentPresentation>>;
  readonly preparedConnectionValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Option.Option<PreparedConnection>>;
}) {
  return Atom.family((preferredEnvironmentId: EnvironmentId | null) =>
    Atom.make((get): PreparedConnection | null => {
      const presentations = get(input.presentationsAtom);
      const ids = [...presentations.keys()];
      if (preferredEnvironmentId !== null) {
        ids.sort(
          (a, b) => Number(b === preferredEnvironmentId) - Number(a === preferredEnvironmentId),
        );
      }
      for (const id of ids) {
        const presentation = presentations.get(id);
        if (
          presentation?.connection.phase !== "connected" ||
          presentation.serverConfig?.environment.capabilities.voiceDictation !== true
        )
          continue;
        const prepared = get(input.preparedConnectionValueAtom(id));
        if (Option.isSome(prepared)) return prepared.value;
      }
      return null;
    }).pipe(Atom.withLabel(`dictation-host:${preferredEnvironmentId ?? "any"}`)),
  );
}

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
  return yield* executeEnvironmentHttpRequestWithAdditionalError(
    requestUrl,
    DEFAULT_DICTATION_TIMEOUT_MS,
    withEnvironmentCredentials(prepared.httpAuthorization, client.dictation.status({ headers })),
    isDictationHttpError,
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
    return yield* executeEnvironmentHttpRequestWithAdditionalError(
      requestUrl,
      DEFAULT_DICTATION_TIMEOUT_MS,
      withEnvironmentCredentials(
        input.prepared.httpAuthorization,
        client.dictation.transcribe({
          headers,
          payload: { audioBase64: input.audioBase64, mimeType: input.mimeType },
        }),
      ),
      isDictationHttpError,
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
    return yield* executeEnvironmentHttpRequestWithAdditionalError(
      requestUrl,
      DEFAULT_DICTATION_TIMEOUT_MS,
      withEnvironmentCredentials(
        input.prepared.httpAuthorization,
        client.dictation.cleanup({
          headers,
          payload: { transcript: input.transcript, before: input.before, after: input.after },
        }),
      ),
      isDictationHttpError,
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
  readonly before: string;
  readonly after: string;
  readonly previous: string;
  readonly next: string;
}): { readonly value: string; readonly cursor: number } | null {
  if (
    input.start !== input.before.length ||
    input.value !== `${input.before}${input.previous}${input.after}`
  ) {
    return null;
  }
  return {
    value: `${input.before}${input.next}${input.after}`,
    cursor: input.start + input.next.length,
  };
}
