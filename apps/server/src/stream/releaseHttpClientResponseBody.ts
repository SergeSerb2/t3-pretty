import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * Consume at most one response chunk, then close the stream scope so the HTTP
 * implementation can cancel or destroy the unread remainder.
 */
export const releaseHttpClientResponseBody = (
  response: Pick<HttpClientResponse.HttpClientResponse, "stream">,
): Effect.Effect<void> => response.stream.pipe(Stream.take(1), Stream.runDrain, Effect.ignore);
