import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as KeyedLock from "./KeyedLock.ts";

it.effect("serializes callers and removes the semaphore after its last user", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lock = yield* KeyedLock.make;
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();

      const first = yield* lock
        .withLock(
          "thread-1",
          Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
          ),
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(firstEntered);

      const second = yield* lock
        .withLock("thread-1", Deferred.succeed(secondEntered, undefined))
        .pipe(Effect.forkScoped);

      assert.equal(yield* lock.entryCount, 1);
      assert.isFalse(yield* Deferred.isDone(secondEntered));

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(secondEntered);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.equal(yield* lock.entryCount, 0);
    }),
  ),
);
