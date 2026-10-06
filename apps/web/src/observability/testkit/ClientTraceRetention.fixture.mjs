import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const root = process.argv[2];
const mode = process.argv[3];
const count = Number(process.argv[4] ?? 4);
const bytes = Number(process.argv[5] ?? 32768);
const require = NodeModule.createRequire(root + "/apps/web/package.json");
const load = (name) => import(NodeURL.pathToFileURL(require.resolve("effect/" + name)));
const [Effect, Cache, Tracer] = await Promise.all(["Effect", "Cache", "Tracer"].map(load));
const ClientTracer = await import(
  NodeURL.pathToFileURL(root + "/apps/web/src/observability/clientTracer.ts")
);
const refs = [];
const spans = [];
if (mode === "delegate") {
  ClientTracer.setDelegate(
    Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    }),
  );
}
const cache = await Effect.runPromise(
  Cache.make({ capacity: count, timeToLive: "10 minutes", lookup: (key) => Effect.succeed(key) }),
);

async function read(index) {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      if (mode === "native") spans.push(yield* Effect.currentSpan);
      const projection = { text: NodeCrypto.randomBytes(bytes).toString("hex") };
      refs.push(new WeakRef(projection));
      // Cached lookup fibers retain the parent client span after it completes.
      yield* Cache.get(cache, index);
      return projection;
    }).pipe(Effect.withSpan("read-client-thread"), Effect.provide(ClientTracer.layer)),
  );
  NodeAssert.equal(result.text.length, bytes * 2);
}

for (let index = 0; index < count; index++) await read(index);
for (let index = 0; index < 4; index++) {
  await new Promise(setImmediate);
  global.gc();
}
console.log(
  JSON.stringify({
    cacheSize: await Effect.runPromise(Cache.size(cache)),
    retained: refs.filter((ref) => ref.deref()).length,
    ended: spans.filter((span) => span.status._tag === "Ended").length,
  }),
);
