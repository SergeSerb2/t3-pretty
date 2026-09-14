import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

export interface QueueBatchMessage<Body> {
  readonly id: string;
  readonly attempts: number;
  readonly body: Body;
  readonly ack: () => void;
  readonly retry: () => void;
}

/**
 * Processes every message in a Cloudflare queue batch and makes the
 * acknowledgement decision before the batch-level event-source wrapper does.
 */
export const processQueueBatch = <Body, A, E, R>(
  stream: Stream.Stream<QueueBatchMessage<Body>>,
  process: (message: QueueBatchMessage<Body>) => Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R> =>
  stream.pipe(
    Stream.runForEach((message) =>
      process(message).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.sync(() => message.retry()).pipe(
              Effect.andThen(
                Effect.logError("relay queue message failed; retrying", {
                  error: Redacted.make(cause, { label: "QueueMessageFailure" }),
                  "relay.queue.message_id": message.id,
                  "relay.queue.message_attempt": message.attempts,
                }),
              ),
            ),
          onSuccess: () => Effect.sync(() => message.ack()),
        }),
      ),
    ),
  );
