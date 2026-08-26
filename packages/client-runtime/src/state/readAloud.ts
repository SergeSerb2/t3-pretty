import {
  READ_ALOUD_TEXT_MAX_LENGTH,
  ReadAloudUnavailableError,
  ReadAloudUpstreamError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequestWithAdditionalError,
  makeEnvironmentHttpApiClient,
  makeEnvironmentHttpApiUrlBuilder,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const DEFAULT_READ_ALOUD_TIMEOUT_MS = 45_000;
const isReadAloudHttpError = Schema.is(
  Schema.Union([ReadAloudUnavailableError, ReadAloudUpstreamError]),
);

export const synthesizeReadAloud = Effect.fn("clientRuntime.state.readAloud.synthesize")(
  function* (input: { readonly prepared: PreparedConnection; readonly text: string }) {
    const requestUrl = makeEnvironmentHttpApiUrlBuilder(
      input.prepared.httpBaseUrl,
    ).readAloud.synthesize();
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
      DEFAULT_READ_ALOUD_TIMEOUT_MS,
      withEnvironmentCredentials(
        input.prepared.httpAuthorization,
        client.readAloud.synthesize({ headers, payload: { text: input.text } }),
      ),
      isReadAloudHttpError,
    );
  },
);

export function readAloudPlainText(markdown: string): string {
  const unmarked = markdown
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*~]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, " less than ")
    .replace(/&gt;/g, " greater than ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return unmarked
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}|>|[-+]|\d+[.)])\s+/, "")
        .replace(/^\s{0,3}_{3,}\s*$/, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .replace(/([^\s.!?;:,])\n/g, "$1. ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeChunkEnd(text: string, requestedEnd: number): number {
  return requestedEnd > 0 && /[\uD800-\uDBFF]/.test(text[requestedEnd - 1] ?? "")
    ? requestedEnd - 1
    : requestedEnd;
}

export function readAloudChunks(markdown: string): ReadonlyArray<string> {
  let remaining = readAloudPlainText(markdown);
  const chunks: string[] = [];

  while (remaining.length > READ_ALOUD_TEXT_MAX_LENGTH) {
    const window = remaining.slice(0, READ_ALOUD_TEXT_MAX_LENGTH);
    const minimumNaturalBreak = Math.floor(READ_ALOUD_TEXT_MAX_LENGTH / 2);
    let end = 0;
    for (const match of window.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)) {
      const candidate = (match.index ?? 0) + match[0].length;
      if (candidate >= minimumNaturalBreak) end = candidate;
    }
    if (end === 0) {
      end = Math.max(window.lastIndexOf("; ") + 1, window.lastIndexOf(", ") + 1);
    }
    if (end < minimumNaturalBreak) end = window.lastIndexOf(" ");
    if (end <= 0) end = safeChunkEnd(remaining, READ_ALOUD_TEXT_MAX_LENGTH);

    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
