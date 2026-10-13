import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const root = process.argv[2];
const mode = process.argv[3];
const require = NodeModule.createRequire(root + "/packages/client-runtime/package.json");
const load = (name) => import(NodeURL.pathToFileURL(require.resolve("effect/" + name)));
const [Effect, Queue, Deferred, Clock, Duration, Fiber] = await Promise.all(
  ["Effect", "Queue", "Deferred", "Clock", "Duration", "Fiber"].map(load),
);
const { runCachePersistence } = await import(
  NodeURL.pathToFileURL(root + "/packages/client-runtime/src/state/cachePersistence.ts")
);
const queue = await Effect.runPromise(Queue.sliding(1));
const parked = await Effect.runPromise(Deferred.make());
const wake = await Effect.runPromise(Deferred.make());
let persisted = 0;
const persist = (snapshot) =>
  Effect.sync(() => {
    NodeAssert.equal(snapshot.payload.length, 2 * 1024 * 1024);
    persisted++;
  });
const clock = {
  currentTimeMillisUnsafe: () => 0,
  currentTimeMillis: Effect.succeed(0),
  currentTimeNanosUnsafe: () => 0n,
  currentTimeNanos: Effect.succeed(0n),
  sleep: (duration) =>
    Duration.toMillis(duration) === 500
      ? Effect.void
      : Deferred.succeed(parked, undefined).pipe(
          Effect.andThen(mode === "cooldown" ? Deferred.await(wake) : Effect.void),
        ),
};
const fiber = Effect.runFork(
  runCachePersistence(queue, persist).pipe(Effect.provideService(Clock.Clock, clock)),
);

async function enqueue() {
  const snapshot = { payload: NodeCrypto.randomBytes(1024 * 1024).toString("hex") };
  const ref = new WeakRef(snapshot);
  await Effect.runPromise(Queue.offer(queue, snapshot));
  return ref;
}

const ref = await enqueue();
await Effect.runPromise(Deferred.await(parked));
for (let index = 0; index < 4; index++) {
  await new Promise(setImmediate);
  global.gc();
}
const retained = ref.deref() !== undefined;
await Effect.runPromise(Fiber.interrupt(fiber));
console.log(JSON.stringify({ persisted, retained }));
