import type { ServerLifecycleStreamEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

type LifecycleEventInput =
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "welcome" }>, "sequence">
  | Omit<Extract<ServerLifecycleStreamEvent, { type: "ready" }>, "sequence">;

interface SnapshotState {
  readonly sequence: number;
  readonly events: ReadonlyArray<ServerLifecycleStreamEvent>;
}

export class ServerLifecycleEvents extends Context.Service<
  ServerLifecycleEvents,
  {
    readonly publish: (event: LifecycleEventInput) => Effect.Effect<ServerLifecycleStreamEvent>;
    readonly snapshot: Effect.Effect<SnapshotState>;
    readonly stream: Stream.Stream<ServerLifecycleStreamEvent>;
    readonly subscribe: Effect.Effect<
      {
        readonly snapshot: SnapshotState;
        readonly changes: Stream.Stream<ServerLifecycleStreamEvent>;
      },
      never,
      Scope.Scope
    >;
  }
>()("t3/serverLifecycleEvents") {}

const make = Effect.gen(function* () {
  const pubsub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerLifecycleStreamEvent>(),
    PubSub.shutdown,
  );
  const state = yield* Ref.make<SnapshotState>({
    sequence: 0,
    events: [],
  });
  const publishMutex = yield* Semaphore.make(1);

  const publish = (event: LifecycleEventInput) =>
    publishMutex.withPermits(1)(
      Effect.uninterruptible(
        Ref.modify(state, (current) => {
          const nextSequence = current.sequence + 1;
          const nextEvent = {
            ...event,
            sequence: nextSequence,
          } satisfies ServerLifecycleStreamEvent;
          const nextEvents =
            nextEvent.type === "welcome"
              ? [nextEvent, ...current.events.filter((entry) => entry.type !== "welcome")]
              : [nextEvent, ...current.events.filter((entry) => entry.type !== "ready")];
          return [nextEvent, { sequence: nextSequence, events: nextEvents }] as const;
        }).pipe(Effect.tap((nextEvent) => PubSub.publish(pubsub, nextEvent))),
      ),
    );

  const subscribe = publishMutex.withPermits(1)(
    Effect.gen(function* () {
      const snapshot = yield* Ref.get(state);
      const subscription = yield* PubSub.subscribe(pubsub);
      return {
        snapshot,
        changes: Stream.fromSubscription(subscription).pipe(
          Stream.filter((event) => event.sequence > snapshot.sequence),
        ),
      } as const;
    }),
  );

  return {
    publish,
    snapshot: Ref.get(state),
    get stream() {
      return Stream.fromPubSub(pubsub);
    },
    subscribe,
  } satisfies ServerLifecycleEvents["Service"];
});

export const layer = Layer.effect(ServerLifecycleEvents, make);
