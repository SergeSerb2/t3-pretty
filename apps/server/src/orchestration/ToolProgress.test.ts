import { EventId, ThreadId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { TOOL_PROGRESS_PERSIST_INTERVAL_MS, make, toolProgressActivityId } from "./ToolProgress.ts";

const threadId = ThreadId.make("thread-1");
const tick = (itemId: string, detail: string): OrchestrationThreadActivity => ({
  id: toolProgressActivityId(itemId),
  tone: "tool",
  kind: "tool.updated",
  summary: "Run",
  payload: { itemType: "command_execution", detail },
  turnId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

it.effect("coalesces persistence per item and streams every tick as an ephemeral event", () =>
  Effect.gen(function* () {
    const registry = yield* make;
    const seen = yield* Stream.take(registry.stream, 4).pipe(Stream.runCollect, Effect.forkChild);
    yield* Effect.yieldNow;

    const t0 = 10_000;
    const record = (itemId: string, detail: string, nowMs: number) =>
      registry.record({ threadId, itemId, activity: tick(itemId, detail), nowMs });

    // First tick starts the clock; only a tick past the interval is due.
    assert.isFalse(yield* record("a", "1", t0));
    assert.isFalse(yield* record("a", "2", t0 + TOOL_PROGRESS_PERSIST_INTERVAL_MS - 1));
    assert.isTrue(yield* record("a", "3", t0 + TOOL_PROGRESS_PERSIST_INTERVAL_MS));
    assert.isFalse(yield* record("b", "1", t0 + TOOL_PROGRESS_PERSIST_INTERVAL_MS));

    const events = Array.from(yield* Fiber.join(seen));
    assert.deepStrictEqual(
      events.map((event) => [event.type, event.sequence, event.aggregateId, event.eventId]),
      Array.from({ length: 3 }, () => [
        "thread.activity-appended",
        0,
        threadId,
        EventId.make("a:progress:live"),
      ]).concat([["thread.activity-appended", 0, threadId, EventId.make("b:progress:live")]]),
    );

    // Snapshot view: latest tick per item.
    assert.deepStrictEqual(
      registry.getThreadProgress(threadId).map((activity) => activity.id),
      ["a:progress", "b:progress"],
    );

    // Completion drops the item; flush returns only unpersisted (dirty) items
    // and forgets the thread.
    registry.complete(threadId, "a");
    assert.deepStrictEqual(
      registry.flush(threadId).map((activity) => activity.id),
      ["b:progress"],
    );
    assert.deepStrictEqual(registry.getThreadProgress(threadId), []);
    assert.deepStrictEqual(registry.flush(threadId), []);

    // A just-persisted item is not dirty, so it is not flushed again.
    assert.isFalse(yield* record("c", "1", t0));
    assert.isTrue(yield* record("c", "2", t0 + TOOL_PROGRESS_PERSIST_INTERVAL_MS));
    assert.deepStrictEqual(registry.flush(threadId), []);
  }),
);
