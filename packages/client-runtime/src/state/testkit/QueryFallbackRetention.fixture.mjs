import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const root = process.argv[2];
const mode = process.argv[3];
const require = NodeModule.createRequire(root + "/packages/client-runtime/package.json");
const load = (name) => import(NodeURL.pathToFileURL(require.resolve("effect/" + name)));
const [
  Effect,
  Layer,
  Option,
  Deferred,
  SubscriptionRef,
  Stream,
  { Atom, AtomRegistry, AsyncResult },
] = await Promise.all(
  ["Effect", "Layer", "Option", "Deferred", "SubscriptionRef", "Stream", "reactivity"].map(load),
);
const app = (path) =>
  import(NodeURL.pathToFileURL(root + "/packages/client-runtime/src/" + path + ".ts"));
const [
  { createEnvironmentQueryAtomFamily },
  { EnvironmentRegistry },
  { EnvironmentSupervisor },
  { AVAILABLE_CONNECTION_STATE, PrimaryConnectionTarget },
] = await Promise.all([
  app("state/runtime"),
  app("connection/registry"),
  app("connection/supervisor"),
  app("connection/model"),
]);
const target = new PrimaryConnectionTarget({
  environmentId: "query-memory",
  label: "Query memory",
  httpBaseUrl: "https://memory.example.test",
  wsBaseUrl: "wss://memory.example.test",
});
const connected = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};
const state = await Effect.runPromise(SubscriptionRef.make(connected));
const supervisor = EnvironmentSupervisor.of({
  target,
  state,
  session: await Effect.runPromise(SubscriptionRef.make(Option.some({}))),
  prepared: await Effect.runPromise(SubscriptionRef.make(Option.none())),
  connect: Effect.void,
  disconnect: Effect.void,
  retryNow: Effect.void,
});
const environments = EnvironmentRegistry.of({
  run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
  followStream: (_id, stream) => Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  stateChanges: () => SubscriptionRef.changes(state),
});
const refs = [];
const runtime = Atom.runtime(Layer.succeed(EnvironmentRegistry, environments));
const family = createEnvironmentQueryAtomFamily(runtime, {
  label: "query-memory",
  idleTtlMs: mode === "idle" ? 1_000 : 0,
  staleTimeMs: 60_000,
  persistence: { load: () => Effect.succeedNone, save: () => Effect.void },
  execute: () =>
    Effect.sync(() => {
      const value = { payload: NodeCrypto.randomBytes(1024 * 1024).toString("hex") };
      refs.push(new WeakRef(value));
      return value;
    }),
});
// This definition remains reachable after its registry nodes release their state.
const atom = family({ environmentId: target.environmentId, input: undefined });

async function populate() {
  const tasks = [];
  let parkTasks = false;
  const registry = AtomRegistry.make({
    timeoutResolution: 100,
    scheduleTask(task) {
      if (parkTasks) tasks.push(task);
      else queueMicrotask(task);
      return () => {};
    },
  });
  const unmount = registry.mount(atom);
  await Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));
  const fallback = await Effect.runPromise(Deferred.make());
  let offline = false;
  const unsubscribe = registry.subscribe(atom, (result) => {
    if (offline && AsyncResult.isSuccess(result) && !result.waiting) {
      Deferred.doneUnsafe(fallback, Effect.void);
    }
  });
  offline = true;
  await Effect.runPromise(
    SubscriptionRef.set(state, { ...connected, phase: "offline", network: "offline" }),
  );
  await Effect.runPromise(Deferred.await(fallback));
  parkTasks = true;
  unsubscribe();
  if (mode === "dispose") {
    unmount();
    while (tasks.length > 0) tasks.shift()();
    registry.dispose();
    while (tasks.length > 0) tasks.shift()();
  } else {
    // Advance only registry TTL timers. The live query and offline transition
    // have already settled, and Effect's execution scheduler remains real.
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalNow = Date.now;
    const timers = new Map();
    let now = Date.now();
    globalThis.setTimeout = (callback, delay) => {
      const handle = {};
      timers.set(handle, { callback, deadline: now + delay });
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      if (!timers.delete(handle)) originalClearTimeout(handle);
    };
    Date.now = () => now;
    try {
      unmount();
      while (tasks.length > 0) tasks.shift()();
      if (!registry.getNodes().has(atom)) throw new Error("The parent query TTL was not retained");
      // One parent TTL plus its sweep bucket; do not grant a second holder TTL.
      now += 1_100;
      for (const [handle, timer] of timers) {
        if (timer.deadline > now) continue;
        timers.delete(handle);
        timer.callback();
      }
      while (tasks.length > 0) tasks.shift()();
      if (registry.getNodes().has(atom)) throw new Error("The parent query was not evicted");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      Date.now = originalNow;
    }
  }
  return registry;
}

// Keep even an idle registry alive, so collection cannot come from dropping the registry itself.
const registry = await populate();
for (let index = 0; index < 8; index++) {
  await new Promise(setImmediate);
  global.gc();
}
console.log(
  JSON.stringify({
    payloads: refs.length,
    retained: refs.filter((ref) => ref.deref()).length,
    definitionRetained: atom !== undefined,
  }),
);
registry.dispose();
