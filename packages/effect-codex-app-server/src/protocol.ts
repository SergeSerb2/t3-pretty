import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

import * as CodexError from "./errors.ts";
import { JsonRpcId, JsonRpcResponseEnvelope } from "./_internal/shared.ts";
const isJsonRpcId = Schema.is(JsonRpcId);
const isJsonRpcResponseEnvelope = Schema.is(JsonRpcResponseEnvelope);
const isCodexAppServerError = Schema.is(CodexError.CodexAppServerError);

export interface CodexAppServerProtocolLogEvent {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed";
  readonly payload: unknown;
}

export interface CodexAppServerIncomingNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexAppServerIncomingRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexAppServerPatchedProtocolOptions {
  readonly stdio: Stdio.Stdio;
  readonly terminationError?: Effect.Effect<CodexError.CodexAppServerError>;
  readonly maximumWireLineBytes?: number;
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (event: CodexAppServerProtocolLogEvent) => Effect.Effect<void, never>;
  readonly onNotification?: (
    notification: CodexAppServerIncomingNotification,
  ) => Effect.Effect<void, never>;
  readonly onRequest?: (
    request: CodexAppServerIncomingRequest,
  ) => Effect.Effect<unknown, CodexError.CodexAppServerError>;
  readonly onTermination?: (error: CodexError.CodexAppServerError) => Effect.Effect<void, never>;
}

export interface CodexAppServerPatchedProtocol {
  readonly incomingNotifications: Stream.Stream<CodexAppServerIncomingNotification>;
  readonly incomingRequests: Stream.Stream<CodexAppServerIncomingRequest>;
  readonly request: (
    method: string,
    payload?: unknown,
  ) => Effect.Effect<unknown, CodexError.CodexAppServerError>;
  readonly notify: (
    method: string,
    payload?: unknown,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly respond: (
    requestId: string | number,
    result: unknown,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly respondError: (
    requestId: string | number,
    error: CodexError.CodexAppServerRequestError,
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
}

interface CodexAppServerPendingRequest {
  readonly deferred: Deferred.Deferred<unknown, CodexError.CodexAppServerError>;
  readonly method: string;
}

/**
 * A turn can carry eight compact 14M-character image data URLs plus its prompt
 * and metadata. Match the primary transport's 128 MiB compatibility ceiling:
 * it is deliberately generous, but still prevents a broken app-server from
 * growing one unterminated stdout record without bound.
 */
export const CODEX_APP_SERVER_MAXIMUM_WIRE_LINE_BYTES = 128 * 1024 * 1024;
const CODEX_APP_SERVER_TRANSPORT_QUEUE_CAPACITY = 8;
const CODEX_APP_SERVER_OBSERVER_CAPACITY = 128;

export type CodexAppServerWireLineFrameResult =
  | { readonly _tag: "Framed"; readonly lines: ReadonlyArray<string> }
  | {
      readonly _tag: "Overflow";
      readonly lines: ReadonlyArray<string>;
      readonly maximumBytes: number;
      readonly observedBytes: number;
    };

/** Incrementally frames raw UTF-8 bytes without joining an incomplete line on every chunk. */
export function makeCodexAppServerWireLineFramer(
  configuredMaximumBytes = CODEX_APP_SERVER_MAXIMUM_WIRE_LINE_BYTES,
) {
  const maximumBytes =
    Number.isSafeInteger(configuredMaximumBytes) && configuredMaximumBytes > 0
      ? Math.min(configuredMaximumBytes, CODEX_APP_SERVER_MAXIMUM_WIRE_LINE_BYTES)
      : CODEX_APP_SERVER_MAXIMUM_WIRE_LINE_BYTES;
  const decoder = new TextDecoder();
  let pendingBuffer = new Uint8Array();
  let pendingBytes = 0;
  let overflow: { readonly maximumBytes: number; readonly observedBytes: number } | undefined;

  const clearPending = () => {
    // A single exceptional line must not pin its maximum-sized backing buffer
    // for the rest of a long-lived provider session.
    if (pendingBuffer.byteLength > 1024 * 1024) pendingBuffer = new Uint8Array();
    pendingBytes = 0;
  };

  const ensurePendingCapacity = (requiredBytes: number) => {
    if (pendingBuffer.byteLength >= requiredBytes) return;
    let capacity = Math.min(maximumBytes, Math.max(64 * 1024, pendingBuffer.byteLength * 2));
    while (capacity < requiredBytes) capacity = Math.min(maximumBytes, capacity * 2);
    const next = new Uint8Array(capacity);
    next.set(pendingBuffer.subarray(0, pendingBytes));
    pendingBuffer = next;
  };

  const decodeCompletedLine = (tail: Uint8Array<ArrayBufferLike>): string => {
    const totalBytes = pendingBytes + tail.byteLength;
    let bytes: Uint8Array<ArrayBufferLike>;
    if (pendingBytes === 0) {
      bytes = tail;
    } else {
      ensurePendingCapacity(totalBytes);
      pendingBuffer.set(tail, pendingBytes);
      bytes = pendingBuffer.subarray(0, totalBytes);
    }
    const content =
      bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0d
        ? bytes.subarray(0, bytes.byteLength - 1)
        : bytes;
    const line = decoder.decode(content);
    clearPending();
    return line;
  };

  const overflowResult = (
    lines: ReadonlyArray<string>,
    observedBytes: number,
  ): CodexAppServerWireLineFrameResult => {
    overflow = { maximumBytes, observedBytes };
    clearPending();
    return { _tag: "Overflow", lines, ...overflow };
  };

  const push = (chunk: Uint8Array<ArrayBufferLike>): CodexAppServerWireLineFrameResult => {
    if (overflow) return { _tag: "Overflow", lines: [], ...overflow };
    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const segment = chunk.subarray(start, index);
      const observedBytes = pendingBytes + segment.byteLength;
      if (observedBytes > maximumBytes) return overflowResult(lines, observedBytes);
      lines.push(decodeCompletedLine(segment));
      start = index + 1;
    }

    const tail = chunk.subarray(start);
    if (tail.byteLength === 0) return { _tag: "Framed", lines };
    const observedBytes = pendingBytes + tail.byteLength;
    if (observedBytes > maximumBytes) return overflowResult(lines, observedBytes);
    ensurePendingCapacity(observedBytes);
    pendingBuffer.set(tail, pendingBytes);
    pendingBytes = observedBytes;
    return { _tag: "Framed", lines };
  };

  const finish = (): CodexAppServerWireLineFrameResult => {
    if (overflow) return { _tag: "Overflow", lines: [], ...overflow };
    return pendingBytes === 0
      ? { _tag: "Framed", lines: [] }
      : { _tag: "Framed", lines: [decodeCompletedLine(new Uint8Array())] };
  };

  return { push, finish } as const;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIncomingRequest(value: unknown): value is CodexAppServerIncomingRequest {
  if (!isObject(value) || typeof value.method !== "string") {
    return false;
  }
  return isJsonRpcId(value.id);
}

function isIncomingNotification(value: unknown): value is CodexAppServerIncomingNotification {
  return isObject(value) && typeof value.method === "string" && !("id" in value);
}

function isIncomingResponse(value: unknown): value is typeof JsonRpcResponseEnvelope.Type {
  return isJsonRpcResponseEnvelope(value);
}

const encodeJsonString = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJsonString = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const encodeWireMessage = (
  message: Record<string, unknown>,
): Effect.Effect<string, CodexError.CodexAppServerProtocolParseError> =>
  encodeJsonString(message).pipe(
    Effect.map((encoded) => `${encoded}\n`),
    Effect.mapError((cause) => {
      const method = typeof message.method === "string" ? message.method : undefined;
      const requestId =
        typeof message.id === "string" || typeof message.id === "number"
          ? String(message.id)
          : undefined;
      return CodexError.CodexAppServerProtocolParseError.fromSchemaError(
        "encode-wire-message",
        cause,
        {
          ...(method === undefined ? {} : { method }),
          ...(requestId === undefined ? {} : { requestId }),
        },
      );
    }),
  );

const decodeWireMessage = (
  line: string,
): Effect.Effect<unknown, CodexError.CodexAppServerProtocolParseError> =>
  decodeJsonString(line).pipe(
    Effect.mapError((cause) =>
      CodexError.CodexAppServerProtocolParseError.fromSchemaError("decode-wire-message", cause),
    ),
  );

const normalizeIncomingError = (
  error: unknown,
  operation: CodexError.CodexAppServerTransportOperation,
): CodexError.CodexAppServerError =>
  isCodexAppServerError(error)
    ? error
    : new CodexError.CodexAppServerTransportError({
        operation,
        cause: error,
      });

const toProtocolMessage = (
  requestId: string | number,
  fields: {
    readonly result?: unknown;
    readonly error?: CodexError.CodexAppServerProtocolErrorShape;
  },
): { readonly [key: string]: unknown } => ({
  id: requestId,
  ...(fields.result !== undefined ? { result: fields.result } : {}),
  ...(fields.error !== undefined ? { error: fields.error } : {}),
});

export const makeCodexAppServerPatchedProtocol = Effect.fn("makeCodexAppServerPatchedProtocol")(
  function* (
    options: CodexAppServerPatchedProtocolOptions,
  ): Effect.fn.Return<CodexAppServerPatchedProtocol, never, Scope.Scope> {
    const outgoing = yield* Queue.bounded<string, Cause.Done<void>>(
      CODEX_APP_SERVER_TRANSPORT_QUEUE_CAPACITY,
    );
    // These streams are optional diagnostics. The typed callbacks below are
    // the authoritative runtime path, so retaining an unbounded duplicate
    // history when nobody observes `raw.notifications` / `raw.requests`
    // only leaks memory. Slow observers get a bounded live window instead.
    const incomingNotifications = yield* PubSub.sliding<CodexAppServerIncomingNotification>(
      CODEX_APP_SERVER_OBSERVER_CAPACITY,
    );
    const incomingRequests = yield* PubSub.sliding<CodexAppServerIncomingRequest>(
      CODEX_APP_SERVER_OBSERVER_CAPACITY,
    );
    const pending = yield* Ref.make(new Map<string, CodexAppServerPendingRequest>());
    const nextRequestId = yield* Ref.make(1);

    const terminationHandled = yield* Ref.make(false);
    const terminationReason = yield* Deferred.make<CodexError.CodexAppServerError>();
    const wireLineFramer = makeCodexAppServerWireLineFramer(options.maximumWireLineBytes);

    const logProtocol = (event: CodexAppServerProtocolLogEvent) => {
      if (event.direction === "incoming" && !options.logIncoming) {
        return Effect.void;
      }
      if (event.direction === "outgoing" && !options.logOutgoing) {
        return Effect.void;
      }
      return (
        options.logger?.(event) ??
        Effect.logDebug("Codex App Server protocol event").pipe(Effect.annotateLogs({ event }))
      );
    };

    const failAllPending = (error: CodexError.CodexAppServerError) =>
      Ref.get(pending).pipe(
        Effect.flatMap((current) =>
          Effect.forEach([...current.values()], ({ deferred }) => Deferred.fail(deferred, error), {
            discard: true,
          }),
        ),
        Effect.andThen(Ref.set(pending, new Map())),
      );

    const handleTermination = (classify: () => Effect.Effect<CodexError.CodexAppServerError>) =>
      Ref.modify(terminationHandled, (handled) => {
        if (handled) {
          return [Effect.void, true] as const;
        }
        return [
          Effect.gen(function* () {
            const error = yield* classify();
            yield* Deferred.succeed(terminationReason, error);
            // Close the producer before clearing the pending map. A request
            // racing termination either lands before this point and is failed
            // by failAllPending, or sees the closed queue and fails with the
            // same termination reason instead of waiting forever.
            yield* Queue.end(outgoing);
            yield* failAllPending(error);
            if (options.onTermination) {
              yield* options.onTermination(error);
            }
          }),
          true,
        ] as const;
      }).pipe(Effect.flatten);

    const offerOutgoing = (message: Record<string, unknown>) =>
      Effect.gen(function* () {
        yield* logProtocol({
          direction: "outgoing",
          stage: "decoded",
          payload: message,
        });
        const encoded = yield* encodeWireMessage(message);
        yield* logProtocol({
          direction: "outgoing",
          stage: "raw",
          payload: encoded,
        });
        const offered = yield* Queue.offer(outgoing, encoded);
        if (!offered) {
          const reason = yield* Deferred.await(terminationReason);
          return yield* reason;
        }
      });

    const removePending = (requestId: string) =>
      Ref.update(pending, (current) => {
        if (!current.has(requestId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(requestId);
        return next;
      });

    const resolvePending = (
      requestId: string,
      handler: (pendingRequest: CodexAppServerPendingRequest) => Effect.Effect<void>,
    ) =>
      Ref.modify(pending, (current) => {
        const pendingRequest = current.get(requestId);
        if (!pendingRequest) {
          return [Effect.void, current] as const;
        }
        const next = new Map(current);
        next.delete(requestId);
        return [handler(pendingRequest), next] as const;
      }).pipe(Effect.flatten);

    const respond = (requestId: string | number, result: unknown) =>
      offerOutgoing(toProtocolMessage(requestId, { result }));

    const respondError = (
      requestId: string | number,
      error: CodexError.CodexAppServerRequestError,
    ) => offerOutgoing(toProtocolMessage(requestId, { error: error.toProtocolError() }));

    const handleResponse = (response: typeof JsonRpcResponseEnvelope.Type) => {
      const requestId = String(response.id);
      const protocolError = response.error;
      if (protocolError !== undefined) {
        return resolvePending(requestId, ({ deferred, method }) =>
          Deferred.fail(
            deferred,
            CodexError.CodexAppServerRequestError.fromProtocolError(
              protocolError,
              method,
              requestId,
            ),
          ),
        );
      }
      return resolvePending(requestId, ({ deferred }) =>
        Deferred.succeed(deferred, response.result),
      );
    };

    const handleRequest = (request: CodexAppServerIncomingRequest) =>
      PubSub.publish(incomingRequests, request).pipe(
        Effect.andThen(
          options.onRequest
            ? options.onRequest(request).pipe(
                Effect.matchEffect({
                  onFailure: (error) =>
                    respondError(
                      request.id,
                      CodexError.CodexAppServerRequestError.fromAppServerError(
                        error,
                        request.method,
                      ),
                    ),
                  onSuccess: (result) => respond(request.id, result),
                }),
              )
            : Effect.void,
        ),
        Effect.asVoid,
      );

    const handleNotification = (notification: CodexAppServerIncomingNotification) =>
      PubSub.publish(incomingNotifications, notification).pipe(
        Effect.andThen(options.onNotification ? options.onNotification(notification) : Effect.void),
        Effect.asVoid,
      );

    const routeMessage = (
      message: unknown,
    ): Effect.Effect<void, CodexError.CodexAppServerError> => {
      if (isIncomingRequest(message)) {
        return handleRequest(message);
      }
      if (isIncomingNotification(message)) {
        return handleNotification(message);
      }
      if (isIncomingResponse(message)) {
        return handleResponse(message);
      }
      return Effect.fail(
        CodexError.CodexAppServerProtocolParseError.fromUnroutableMessage(message),
      );
    };

    const handleLine = (line: string): Effect.Effect<void, CodexError.CodexAppServerError> => {
      if (line.trim().length === 0) {
        return Effect.void;
      }
      return logProtocol({
        direction: "incoming",
        stage: "raw",
        payload: line,
      }).pipe(
        Effect.flatMap(() => decodeWireMessage(line)),
        Effect.tap((decoded) =>
          logProtocol({
            direction: "incoming",
            stage: "decoded",
            payload: decoded,
          }),
        ),
        Effect.tapErrorTag("CodexAppServerProtocolParseError", (error) =>
          logProtocol({
            direction: "incoming",
            stage: "decode_failed",
            payload: {
              operation: error.operation,
              ...(error.method === undefined ? {} : { method: error.method }),
              ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
              ...(error.issueCount === undefined ? {} : { issueCount: error.issueCount }),
              ...(error.issueKinds === undefined ? {} : { issueKinds: error.issueKinds }),
              ...(error.maximumPathDepth === undefined
                ? {}
                : { maximumPathDepth: error.maximumPathDepth }),
            },
          }),
        ),
        Effect.flatMap(routeMessage),
      );
    };

    const handleFramedInput = (
      framed: CodexAppServerWireLineFrameResult,
    ): Effect.Effect<void, CodexError.CodexAppServerError> =>
      Effect.forEach(framed.lines, handleLine, { discard: true }).pipe(
        Effect.andThen(
          framed._tag === "Overflow"
            ? Effect.fail(
                new CodexError.CodexAppServerWireLineTooLargeError({
                  maximumBytes: framed.maximumBytes,
                  observedBytes: framed.observedBytes,
                }),
              )
            : Effect.void,
        ),
      );

    yield* options.stdio.stdin.pipe(
      Stream.runForEach((chunk) => handleFramedInput(wireLineFramer.push(chunk))),
      Effect.matchEffect({
        onFailure: (error) =>
          handleTermination(() =>
            Effect.succeed(normalizeIncomingError(error, "read-input-stream")),
          ),
        onSuccess: () =>
          handleFramedInput(wireLineFramer.finish()).pipe(
            Effect.matchEffect({
              onFailure: (error) => handleTermination(() => Effect.succeed(error)),
              onSuccess: () =>
                handleTermination(
                  () =>
                    options.terminationError ??
                    Effect.succeed(new CodexError.CodexAppServerInputStreamEndedError({})),
                ),
            }),
          ),
      }),
      Effect.forkScoped,
    );

    yield* Stream.fromQueue(outgoing).pipe(
      Stream.run(options.stdio.stdout()),
      Effect.matchEffect({
        onFailure: (error) =>
          handleTermination(() =>
            Effect.succeed(normalizeIncomingError(error, "write-output-stream")),
          ),
        onSuccess: () =>
          handleTermination(() =>
            Effect.succeed(new CodexError.CodexAppServerOutputStreamEndedError({})),
          ),
      }),
      Effect.forkScoped,
    );

    const request = (method: string, payload?: unknown) =>
      Effect.gen(function* () {
        const requestId = yield* Ref.modify(
          nextRequestId,
          (current) => [current, current + 1] as const,
        );
        const deferred = yield* Deferred.make<unknown, CodexError.CodexAppServerError>();
        yield* Ref.update(pending, (current) =>
          new Map(current).set(String(requestId), { deferred, method }),
        );
        yield* offerOutgoing({
          id: requestId,
          method,
          ...(payload !== undefined ? { params: payload } : {}),
        }).pipe(Effect.tapError(() => removePending(String(requestId))));
        return yield* Deferred.await(deferred).pipe(
          Effect.onInterrupt(() => removePending(String(requestId))),
        );
      });

    const notify = (method: string, payload?: unknown) =>
      offerOutgoing({
        method,
        ...(payload !== undefined ? { params: payload } : {}),
      });

    return {
      incomingNotifications: Stream.fromPubSub(incomingNotifications),
      incomingRequests: Stream.fromPubSub(incomingRequests),
      request,
      notify,
      respond,
      respondError,
    } satisfies CodexAppServerPatchedProtocol;
  },
);
