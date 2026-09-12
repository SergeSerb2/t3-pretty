import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { processQueueBatch, type QueueBatchMessage } from "./queueBatch.ts";

describe("processQueueBatch", () => {
  it.effect("retries only the failed message and continues through the batch", () => {
    const processed: string[] = [];
    const decisions = new Map<string, "ack" | "retry">();
    const calls: string[] = [];
    const makeMessage = (body: string): QueueBatchMessage<string> => ({
      id: `message-${body}`,
      attempts: 1,
      body,
      ack: () => {
        calls.push(`ack:${body}`);
        if (!decisions.has(body)) decisions.set(body, "ack");
      },
      retry: () => {
        calls.push(`retry:${body}`);
        if (!decisions.has(body)) decisions.set(body, "retry");
      },
    });
    const messages = [makeMessage("first"), makeMessage("poison"), makeMessage("last")];

    return Effect.gen(function* () {
      yield* processQueueBatch(Stream.fromIterable(messages), (message) =>
        Effect.sync(() => {
          processed.push(message.body);
        }).pipe(
          Effect.andThen(message.body === "poison" ? Effect.fail("invalid job") : Effect.void),
        ),
      );

      // Alchemy acknowledges the batch after the handler succeeds. Cloudflare
      // keeps the first per-message decision, so the poison job remains retried.
      for (const message of messages) message.ack();

      expect(processed).toEqual(["first", "poison", "last"]);
      expect(decisions).toEqual(
        new Map([
          ["first", "ack"],
          ["poison", "retry"],
          ["last", "ack"],
        ]),
      );
      expect(calls).toEqual([
        "ack:first",
        "retry:poison",
        "ack:last",
        "ack:first",
        "ack:poison",
        "ack:last",
      ]);
    });
  });
});
