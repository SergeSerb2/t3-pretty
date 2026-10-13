import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

// The sliding queue keeps only the latest pending snapshot while writes cool down.
// Do not debounce upstream: its consumer can retain an older snapshot during a save.
export const runCachePersistence = Effect.fn("runCachePersistence")(function* <A, E, R>(
  queue: Queue.Queue<A>,
  persist: (value: A) => Effect.Effect<void, E, R>,
) {
  let next: Option.Option<A> = Option.some(yield* Queue.take(queue));
  yield* Effect.sleep("500 millis");
  next = Option.orElse(yield* Queue.poll(queue), () => next);
  while (true) {
    yield* persist(Option.getOrThrow(next));
    // Do not retain a saved projection during the cooldown or an idle queue wait.
    next = Option.none();
    yield* Effect.sleep("10 seconds");
    next = Option.some(yield* Queue.take(queue));
  }
});
