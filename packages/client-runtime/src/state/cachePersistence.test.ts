import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";

import { runCachePersistence } from "./cachePersistence.ts";

it.effect("coalesces snapshots during the initial delay and the save cooldown", () =>
  Effect.gen(function* () {
    const pending = yield* Queue.sliding<number | undefined>(1);
    const saved = yield* Queue.unbounded<number | undefined>();
    yield* runCachePersistence(pending, (value) =>
      Queue.offer(saved, value).pipe(Effect.asVoid),
    ).pipe(Effect.forkScoped);
    yield* Queue.offer(pending, 1);
    yield* TestClock.adjust("499 millis");
    expect(yield* Queue.size(saved)).toBe(0);
    yield* Queue.offer(pending, 2);
    yield* TestClock.adjust("1 milli");
    expect(yield* Queue.take(saved)).toBe(2);

    yield* Queue.offer(pending, 3);
    yield* Queue.offer(pending, 4);
    yield* TestClock.adjust("9999 millis");
    expect(yield* Queue.size(saved)).toBe(0);
    yield* TestClock.adjust("1 milli");
    expect(yield* Queue.take(saved)).toBe(4);

    // Undefined is a queued value too, rather than an empty worker slot.
    yield* Queue.offer(pending, undefined);
    yield* TestClock.adjust("10 seconds");
    expect(yield* Queue.take(saved)).toBeUndefined();
  }).pipe(Effect.scoped),
);
