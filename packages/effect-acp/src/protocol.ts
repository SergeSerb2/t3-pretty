import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Stdio from "effect/Stdio";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import * as RpcMessage from "effect/unstable/rpc/RpcMessage";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import * as AcpSchema from "./_generated/schema.gen.ts";
import { CLIENT_METHODS } from "./_generated/meta.gen.ts";
import * as AcpError from "./errors.ts";
const isAcpError = Schema.is(AcpError.AcpError);

export interface AcpProtocolLogEvent {
  readonly direction: "incoming" | "outgoing";
  readonly stage: "raw" | "decoded" | "decode_failed";
  readonly payload: unknown;
}

export type AcpIncomingNotification =
  | {
      readonly _tag: "SessionUpdate";
      readonly method: typeof CLIENT_METHODS.session_update;
      readonly params: AcpSchema.SessionNotification;
    }
  | {
      readonly _tag: "ElicitationComplete";
      readonly method: typeof CLIENT_METHODS.session_elicitation_complete;
      readonly params: AcpSchema.ElicitationCompleteNotification;
    }
  | {
      readonly _tag: "ExtNotification";
      readonly method: string;
      readonly params: unknown;
    };

export interface AcpPatchedProtocolOptions {
  readonly stdio: Stdio.Stdio;
  readonly terminationError?: Effect.Effect<AcpError.AcpError>;
  readonly maximumWireLineBytes?: number;
  readonly serverRequestMethods: ReadonlySet<string>;
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (event: AcpProtocolLogEvent) => Effect.Effect<void, never>;
  readonly onNotification?: (
    notification: AcpIncomingNotification,
  ) => Effect.Effect<void, AcpError.AcpError, never>;
  readonly onExtRequest?: (
    method: string,
    params: unknown,
  ) => Effect.Effect<unknown, AcpError.AcpError, never>;
  readonly onTermination?: (error: AcpError.AcpError) => Effect.Effect<void, never, never>;
}

export interface AcpPatchedProtocol {
  readonly clientProtocol: RpcClient.Protocol["Service"];
  readonly serverProtocol: RpcServer.Protocol["Service"];
  readonly incoming: Stream.Stream<AcpIncomingNotification>;
  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
}

interface AcpPendingRequest {
  readonly deferred: Deferred.Deferred<unknown, AcpError.AcpError>;
  readonly method: string;
}

/**
 * ACP prompts can carry eight base64-encoded 10 MiB images plus text and
 * metadata. Match the primary transport's 128 MiB compatibility ceiling while
 * preventing a broken provider from growing one unterminated stdout record
 * without bound.
 */
export const ACP_MAXIMUM_WIRE_LINE_BYTES = 128 * 1024 * 1024;
const ACP_TRANSPORT_QUEUE_CAPACITY = 8;
const ACP_NOTIFICATION_OBSERVER_CAPACITY = 128;

export type AcpWireLineFrameResult =
  | { readonly _tag: "Framed"; readonly lines: ReadonlyArray<string> }
  | {
      readonly _tag: "Overflow";
      readonly lines: ReadonlyArray<string>;
      readonly maximumBytes: number;
      readonly observedBytes: number;
    };

/** Incrementally frames raw UTF-8 bytes without joining an incomplete line on every chunk. */
export function makeAcpWireLineFramer(configuredMaximumBytes = ACP_MAXIMUM_WIRE_LINE_BYTES) {
  const maximumBytes =
    Number.isSafeInteger(configuredMaximumBytes) && configuredMaximumBytes > 0
      ? Math.min(configuredMaximumBytes, ACP_MAXIMUM_WIRE_LINE_BYTES)
      : ACP_MAXIMUM_WIRE_LINE_BYTES;
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
  ): AcpWireLineFrameResult => {
    overflow = { maximumBytes, observedBytes };
    clearPending();
    return { _tag: "Overflow", lines, ...overflow };
  };

  const push = (chunk: Uint8Array<ArrayBufferLike>): AcpWireLineFrameResult => {
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

  const finish = (): AcpWireLineFrameResult => {
    if (overflow) return { _tag: "Overflow", lines: [], ...overflow };
    return pendingBytes === 0
      ? { _tag: "Framed", lines: [] }
      : { _tag: "Framed", lines: [decodeCompletedLine(new Uint8Array())] };
  };

  return { push, finish } as const;
}

const decodeSessionUpdate = Schema.decodeUnknownEffect(AcpSchema.SessionNotification);
const decodeElicitationComplete = Schema.decodeUnknownEffect(
  AcpSchema.ElicitationCompleteNotification,
);
const parserFactory = RpcSerialization.ndJsonRpc();

export const makeAcpPatchedProtocol = Effect.fn("makeAcpPatchedProtocol")(function* (
  options: AcpPatchedProtocolOptions,
): Effect.fn.Return<AcpPatchedProtocol, never, Scope.Scope> {
  const parser = parserFactory.makeUnsafe();
  const wireLineFramer = makeAcpWireLineFramer(options.maximumWireLineBytes);
  const wireEncoder = new TextEncoder();
  const serverQueue = yield* Queue.bounded<RpcMessage.FromClientEncoded>(
    ACP_TRANSPORT_QUEUE_CAPACITY,
  );
  const clientQueue = yield* Queue.bounded<RpcMessage.FromServerEncoded>(
    ACP_TRANSPORT_QUEUE_CAPACITY,
  );
  // Notifications are dispatched through the typed callback below; this live
  // stream is an optional raw observer. A queue retained every notification
  // forever in the normal no-observer server path.
  const notificationPubSub = yield* PubSub.sliding<AcpIncomingNotification>(
    ACP_NOTIFICATION_OBSERVER_CAPACITY,
  );
  const disconnects = yield* Queue.bounded<number>(1);
  const outgoing = yield* Queue.bounded<string | Uint8Array, Cause.Done<void>>(
    ACP_TRANSPORT_QUEUE_CAPACITY,
  );
  const nextRequestId = yield* Ref.make(1);
  const terminationHandled = yield* Ref.make(false);
  const terminationReason = yield* Deferred.make<AcpError.AcpError>();
  const extPending = yield* Ref.make(new Map<string, AcpPendingRequest>());

  const logProtocol = (event: AcpProtocolLogEvent) => {
    if (event.direction === "incoming" && !options.logIncoming) {
      return Effect.void;
    }
    if (event.direction === "outgoing" && !options.logOutgoing) {
      return Effect.void;
    }
    return (
      options.logger?.(event) ??
      Effect.logDebug("ACP protocol event").pipe(Effect.annotateLogs({ event }))
    );
  };

  const offerOutgoing = Effect.fn("offerOutgoing")(function* (
    message: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded,
  ) {
    yield* logProtocol({
      direction: "outgoing",
      stage: "decoded",
      payload: message,
    });

    const method = message._tag === "Request" ? message.tag : undefined;
    const encodedRequestId =
      message._tag === "Request"
        ? message.id
        : "requestId" in message
          ? message.requestId
          : undefined;
    const requestId = encodedRequestId === "" ? undefined : encodedRequestId;
    const encoded = yield* Effect.try({
      try: () => parser.encode(message),
      catch: (cause) => AcpError.AcpProtocolParseError.fromEncodingError(method, requestId, cause),
    });

    if (encoded) {
      yield* logProtocol({
        direction: "outgoing",
        stage: "raw",
        payload: typeof encoded === "string" ? encoded : new TextDecoder().decode(encoded),
      });

      const offered = yield* Queue.offer(outgoing, encoded);
      if (!offered) {
        const reason = yield* Deferred.await(terminationReason);
        return yield* reason;
      }
    }
  });

  const resolveExtPending = (
    requestId: AcpError.AcpRequestId,
    onFound: (pendingRequest: AcpPendingRequest) => Effect.Effect<void>,
  ) =>
    Ref.modify(extPending, (pending) => {
      const pendingKey = String(requestId);
      const pendingRequest = pending.get(pendingKey);
      if (!pendingRequest) {
        return [Effect.void, pending] as const;
      }
      const next = new Map(pending);
      next.delete(pendingKey);
      return [onFound(pendingRequest), next] as const;
    }).pipe(Effect.flatten);

  const removeExtPending = (requestId: AcpError.AcpRequestId) =>
    Ref.update(extPending, (pending) => {
      const pendingKey = String(requestId);
      if (!pending.has(pendingKey)) {
        return pending;
      }
      const next = new Map(pending);
      next.delete(pendingKey);
      return next;
    });

  const completeExtPendingFailure = (requestId: AcpError.AcpRequestId, error: AcpError.AcpError) =>
    resolveExtPending(requestId, ({ deferred }) => Deferred.fail(deferred, error));

  const completeExtPendingSuccess = (requestId: AcpError.AcpRequestId, value: unknown) =>
    resolveExtPending(requestId, ({ deferred }) => Deferred.succeed(deferred, value));

  const failAllExtPending = (error: AcpError.AcpError) =>
    Ref.getAndSet(extPending, new Map()).pipe(
      Effect.flatMap((pending) =>
        Effect.forEach([...pending.values()], ({ deferred }) => Deferred.fail(deferred, error), {
          discard: true,
        }),
      ),
    );

  const dispatchNotification = (notification: AcpIncomingNotification) =>
    PubSub.publish(notificationPubSub, notification).pipe(
      Effect.andThen(
        options.onNotification
          ? options.onNotification(notification).pipe(Effect.catch(() => Effect.void))
          : Effect.void,
      ),
      Effect.asVoid,
    );

  const emitClientProtocolError = (error: AcpError.AcpError) =>
    Queue.offer(clientQueue, {
      _tag: "ClientProtocolError",
      error: new RpcClientError.RpcClientError({
        reason: new RpcClientError.RpcClientDefect({
          message: "ACP protocol terminated.",
          cause: error,
        }),
      }),
    }).pipe(Effect.asVoid);

  const handleTermination = (classify: () => Effect.Effect<AcpError.AcpError>) =>
    Ref.modify(terminationHandled, (handled) => {
      if (handled) {
        return [Effect.void, true] as const;
      }
      return [
        Effect.gen(function* () {
          yield* Queue.offer(disconnects, 0);
          const error = yield* classify();
          yield* Deferred.succeed(terminationReason, error);
          // Close the producer before clearing the pending map. A request
          // racing termination either lands before this point and is failed,
          // or sees the closed queue and fails with the same reason.
          yield* Queue.end(outgoing);
          yield* failAllExtPending(error);
          yield* emitClientProtocolError(error);
          if (options.onTermination) {
            yield* options.onTermination(error);
          }
        }),
        true,
      ] as const;
    }).pipe(Effect.flatten);

  const respondWithSuccess = (requestId: AcpError.AcpRequestId, value: unknown) =>
    offerOutgoing({
      _tag: "Exit",
      requestId,
      exit: {
        _tag: "Success",
        value,
      },
    });

  const respondWithError = (requestId: AcpError.AcpRequestId, error: AcpError.AcpRequestError) =>
    offerOutgoing({
      _tag: "Exit",
      requestId,
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: error.toProtocolError(),
          },
        ],
      },
    });

  const handleExtRequest = (message: RpcMessage.RequestEncoded) => {
    if (!options.onExtRequest) {
      return respondWithError(message.id, AcpError.AcpRequestError.methodNotFound(message.tag));
    }
    return options.onExtRequest(message.tag, message.payload).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          respondWithError(
            message.id,
            AcpError.AcpRequestError.fromExtensionHandlerError(error, message.tag),
          ),
        onSuccess: (value) => respondWithSuccess(message.id, value),
      }),
    );
  };

  const handleRequestEncoded = (message: RpcMessage.RequestEncoded) => {
    if (message.id === "") {
      if (message.tag === CLIENT_METHODS.session_update) {
        return decodeSessionUpdate(message.payload).pipe(
          Effect.map(
            (params) =>
              ({
                _tag: "SessionUpdate",
                method: CLIENT_METHODS.session_update,
                params,
              }) satisfies AcpIncomingNotification,
          ),
          Effect.mapError((cause) =>
            AcpError.AcpProtocolParseError.fromSchemaError(
              "decode-notification-payload",
              CLIENT_METHODS.session_update,
              cause,
            ),
          ),
          Effect.flatMap(dispatchNotification),
        );
      }
      if (message.tag === CLIENT_METHODS.session_elicitation_complete) {
        return decodeElicitationComplete(message.payload).pipe(
          Effect.map(
            (params) =>
              ({
                _tag: "ElicitationComplete",
                method: CLIENT_METHODS.session_elicitation_complete,
                params,
              }) satisfies AcpIncomingNotification,
          ),
          Effect.mapError((cause) =>
            AcpError.AcpProtocolParseError.fromSchemaError(
              "decode-notification-payload",
              CLIENT_METHODS.session_elicitation_complete,
              cause,
            ),
          ),
          Effect.flatMap(dispatchNotification),
        );
      }
      return dispatchNotification({
        _tag: "ExtNotification",
        method: message.tag,
        params: message.payload,
      });
    }

    if (!options.serverRequestMethods.has(message.tag)) {
      return handleExtRequest(message).pipe(
        Effect.catchTags({
          AcpProtocolParseError: (error) =>
            Effect.logWarning(error).pipe(
              Effect.annotateLogs({
                method: message.tag,
                requestId: message.id,
                operation: error.operation,
              }),
              Effect.andThen(
                respondWithError(
                  message.id,
                  AcpError.AcpRequestError.fromExtensionResponseEncodingError(
                    message.tag,
                    message.id,
                    error,
                  ),
                ),
              ),
            ),
        }),
        Effect.asVoid,
      );
    }

    return Queue.offer(serverQueue, message).pipe(Effect.asVoid);
  };

  const handleExitEncoded = (message: RpcMessage.ResponseExitEncoded) =>
    Ref.get(extPending).pipe(
      Effect.flatMap((pending) => {
        const pendingRequest = pending.get(String(message.requestId));
        if (!pendingRequest) {
          return Queue.offer(clientQueue, message).pipe(Effect.asVoid);
        }
        if (message.exit._tag === "Success") {
          return completeExtPendingSuccess(message.requestId, message.exit.value);
        }
        const failure = message.exit.cause.find((entry) => entry._tag === "Fail");
        if (failure && isProtocolError(failure.error)) {
          return completeExtPendingFailure(
            message.requestId,
            AcpError.AcpRequestError.fromProtocolError(failure.error, {
              method: pendingRequest.method,
              requestId: message.requestId,
              cause: message.exit.cause,
            }),
          );
        }
        return completeExtPendingFailure(
          message.requestId,
          AcpError.AcpRequestError.fromExtensionResponseFailure(
            pendingRequest.method,
            message.requestId,
            message.exit.cause,
          ),
        );
      }),
    );

  const routeDecodedMessage = (
    message: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded,
  ): Effect.Effect<void, AcpError.AcpError> => {
    switch (message._tag) {
      case "Request":
        return handleRequestEncoded(message);
      case "Exit":
        return handleExitEncoded(message);
      case "Chunk":
        return Ref.get(extPending).pipe(
          Effect.flatMap((pending) => {
            const pendingRequest = pending.get(String(message.requestId));
            return pendingRequest
              ? completeExtPendingFailure(
                  message.requestId,
                  AcpError.AcpRequestError.unsupportedStreamingResponse(
                    pendingRequest.method,
                    message.requestId,
                  ),
                )
              : Queue.offer(clientQueue, message).pipe(Effect.asVoid);
          }),
        );
      case "Defect":
      case "ClientProtocolError":
      case "Pong":
        return Queue.offer(clientQueue, message).pipe(Effect.asVoid);
      case "Ack":
      case "Interrupt":
      case "Ping":
      case "Eof":
        return Queue.offer(serverQueue, message).pipe(Effect.asVoid);
    }
  };

  const handleLine = (line: string): Effect.Effect<void, AcpError.AcpError> =>
    logProtocol({
      direction: "incoming",
      stage: "raw",
      payload: line,
    }).pipe(
      Effect.flatMap(() =>
        Effect.try({
          // The Effect NDJSON parser emits only newline-terminated records.
          // Framing first keeps its own partial-record buffer empty.
          try: () =>
            parser.decode(`${line}\n`) as ReadonlyArray<
              RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded
            >,
          catch: (cause) =>
            new AcpError.AcpProtocolParseError({
              operation: "decode-wire-message",
              cause,
            }),
        }),
      ),
      Effect.tap((messages) =>
        logProtocol({
          direction: "incoming",
          stage: "decoded",
          payload: messages,
        }),
      ),
      Effect.tapErrorTag("AcpProtocolParseError", (error) =>
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
      Effect.flatMap((messages) =>
        Effect.forEach(messages, routeDecodedMessage, {
          discard: true,
        }),
      ),
    );

  const handleFramedInput = (
    framed: AcpWireLineFrameResult,
  ): Effect.Effect<void, AcpError.AcpError> =>
    Effect.forEach(framed.lines, handleLine, { discard: true }).pipe(
      Effect.andThen(
        framed._tag === "Overflow"
          ? Effect.fail(
              new AcpError.AcpWireLineTooLargeError({
                maximumBytes: framed.maximumBytes,
                observedBytes: framed.observedBytes,
              }),
            )
          : Effect.void,
      ),
    );

  yield* options.stdio.stdin.pipe(
    Stream.runForEach((chunk) =>
      handleFramedInput(
        wireLineFramer.push(typeof chunk === "string" ? wireEncoder.encode(chunk) : chunk),
      ),
    ),
    Effect.matchEffect({
      onFailure: (error) => {
        const normalized: AcpError.AcpError = isAcpError(error)
          ? error
          : new AcpError.AcpTransportError({
              operation: "read-input-stream",
              cause: error,
            });
        return handleTermination(() => Effect.succeed(normalized));
      },
      onSuccess: () =>
        handleFramedInput(wireLineFramer.finish()).pipe(
          Effect.matchEffect({
            onFailure: (error) => handleTermination(() => Effect.succeed(error)),
            onSuccess: () =>
              handleTermination(
                () =>
                  options.terminationError ??
                  Effect.succeed(new AcpError.AcpInputStreamEndedError({})),
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
          Effect.succeed(
            new AcpError.AcpTransportError({
              operation: "write-output-stream",
              cause: error,
            }),
          ),
        ),
      onSuccess: () =>
        handleTermination(() => Effect.succeed(new AcpError.AcpOutputStreamEndedError({}))),
    }),
    Effect.forkScoped,
  );

  const clientProtocol = RpcClient.Protocol.of({
    run: (_clientId, f) =>
      Stream.fromQueue(clientQueue).pipe(
        Stream.runForEach((message) => f(message)),
        Effect.forever,
      ),
    send: (_clientId, request) =>
      offerOutgoing(request).pipe(
        Effect.mapError(
          (error) =>
            new RpcClientError.RpcClientError({
              reason: new RpcClientError.RpcClientDefect({
                message: "Failed to send ACP protocol message.",
                cause: error,
              }),
            }),
        ),
      ),
    supportsAck: true,
    supportsTransferables: false,
  });

  const serverProtocol = RpcServer.Protocol.of({
    run: (f) =>
      Stream.fromQueue(serverQueue).pipe(
        Stream.runForEach((message) => f(0, message)),
        Effect.forever,
      ),
    disconnects,
    send: (_clientId, response) => offerOutgoing(response).pipe(Effect.orDie),
    end: (_clientId) => Queue.end(outgoing),
    clientIds: Effect.succeed(new Set([0])),
    initialMessage: Effect.succeedNone,
    supportsAck: true,
    supportsTransferables: false,
    supportsSpanPropagation: true,
  });

  const sendNotification = Effect.fn("sendNotification")(function* (
    method: string,
    payload: unknown,
  ) {
    yield* offerOutgoing({
      _tag: "Request",
      id: "",
      tag: method,
      payload,
      headers: [],
    });
  });

  const sendRequest = Effect.fn("sendRequest")(function* (method: string, payload: unknown) {
    const requestId = yield* Ref.modify(
      nextRequestId,
      (current) => [current, current + 1] as const,
    );
    const deferred = yield* Deferred.make<unknown, AcpError.AcpError>();
    yield* Ref.update(extPending, (pending) =>
      new Map(pending).set(String(requestId), { deferred, method }),
    );
    yield* offerOutgoing({
      _tag: "Request",
      id: requestId,
      tag: method,
      payload,
      headers: [],
    }).pipe(Effect.tapError(() => removeExtPending(requestId)));
    return yield* Deferred.await(deferred).pipe(
      Effect.onInterrupt(() => removeExtPending(requestId)),
    );
  });

  return {
    clientProtocol,
    serverProtocol,
    get incoming() {
      return Stream.fromPubSub(notificationPubSub);
    },
    request: sendRequest,
    notify: sendNotification,
  } satisfies AcpPatchedProtocol;
});

function isProtocolError(
  value: unknown,
): value is { code: number; message: string; data?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "number" &&
    "message" in value &&
    typeof value.message === "string"
  );
}
