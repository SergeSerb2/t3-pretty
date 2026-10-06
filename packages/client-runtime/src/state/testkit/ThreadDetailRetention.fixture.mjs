import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

const root = process.argv[2];
const mode = process.argv[3];
const count = Number(process.argv[4] ?? 8);
const bytes = Number(process.argv[5] ?? 32768);
const require = NodeModule.createRequire(root + "/packages/client-runtime/package.json");
const load = (name) => import(NodeURL.pathToFileURL(require.resolve("effect/" + name)));
const [{ Atom, AtomRegistry, AsyncResult }, Option] = await Promise.all(
  ["reactivity", "Option"].map(load),
);
const app = (file) =>
  import(NodeURL.pathToFileURL(root + "/packages/client-runtime/src/state/" + file + ".ts"));
const [{ createEnvironmentThreadDetailAtoms }, { v2Projection, v2Now }] = await Promise.all([
  app("threadDetail"),
  app("orchestrationV2TestFixtures"),
]);
const source = Atom.make(AsyncResult.initial());
const details = createEnvironmentThreadDetailAtoms(() => source);
// Keeping a definition alive must not retain a disposed registry's conversation.
const definitions = [];
const refs = [];
const checkpoints = [];

function read(registry, index) {
  const projection = {
    ...v2Projection,
    messages: [{ id: `message-${index}`, text: NodeCrypto.randomBytes(bytes).toString("hex") }],
    runs: [],
    subagents: [],
    turnItems: [],
    visibleTurnItems: [],
    runtimeRequests: [
      {
        id: `request-${index}`,
        nodeId: `node-${index}`,
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: { type: "not_resumable", reason: "Provider exited" },
        createdAt: v2Now,
        resolvedAt: null,
      },
    ],
  };
  const tracked =
    mode === "threadAtom"
      ? projection
      : mode === "visibleTurnItemsAtom"
        ? projection.visibleTurnItems
        : mode === "turnSubagentsAtom"
          ? projection.runs
          : mode === "pendingRequestsAtom"
            ? projection.runtimeRequests[0]
            : projection.messages;
  refs.push(new WeakRef(tracked));
  const ref = { environmentId: "memory-environment", threadId: `thread-${index}` };
  const atom = details[mode](ref);
  definitions.push(atom);
  registry.set(
    source,
    AsyncResult.success({
      data: Option.some(projection),
      status: "live",
      error: Option.none(),
      history: {},
    }),
  );
  const unmount = registry.mount(atom);
  const value = registry.get(atom);
  if (mode === "threadAtom") NodeAssert.equal(value.projection, projection);
  if (mode === "visibleTurnItemsAtom") NodeAssert.equal(value, projection.visibleTurnItems);
  if (mode === "queuedCountAtom") NodeAssert.equal(value, 0);
  if (mode === "pendingRequestsAtom") NodeAssert.equal(value.approvals.length, 1);
  unmount();
}

for (let start = 0; start < count; start += count / 2) {
  const tasks = [];
  const registry = AtomRegistry.make({
    scheduleTask(task) {
      tasks.push(task);
      return () => {};
    },
  });
  for (let index = start; index < start + count / 2; index++) read(registry, index);
  // The first wave expires idle nodes; the second disposes the whole registry.
  if (start === 0) {
    while (tasks.length > 0) tasks.shift()();
    NodeAssert.equal(registry.getNodes().size, 0);
  }
  registry.dispose();
  while (tasks.length > 0) tasks.shift()();
  for (let index = 0; index < 4; index++) {
    await new Promise(setImmediate);
    global.gc();
  }
  checkpoints.push({
    definitions: definitions.length,
    retained: refs.filter((ref) => ref.deref()).length,
  });
}
console.log(JSON.stringify({ checkpoints }));
