import { EnvironmentId, type OrchestrationV2ArchivedShellSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
  parseArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";
import { v2Now, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

it("round-trips environment keys in sorted order", () => {
  const envA = EnvironmentId.make("env-a");
  const envB = EnvironmentId.make("env-b");
  const key = makeArchivedThreadsEnvironmentKey([envB, envA]);

  expect(parseArchivedThreadsEnvironmentKey(key)).toEqual([envA, envB]);
});

it("encodes environment sets without delimiter collisions", () => {
  const first = [EnvironmentId.make("env\u001fpart"), EnvironmentId.make("tail")];
  const second = [EnvironmentId.make("env"), EnvironmentId.make("part\u001ftail")];

  expect(makeArchivedThreadsEnvironmentKey(first)).not.toBe(
    makeArchivedThreadsEnvironmentKey(second),
  );
});

it("deduplicates environment IDs before reading snapshots", () => {
  const environmentId = EnvironmentId.make("environment-1");

  expect(makeArchivedThreadsEnvironmentKey([environmentId, environmentId])).toBe(
    makeArchivedThreadsEnvironmentKey([environmentId]),
  );
});

it("ignores malformed environment keys", () => {
  expect(parseArchivedThreadsEnvironmentKey("not json{{")).toEqual([]);
  expect(parseArchivedThreadsEnvironmentKey(JSON.stringify(["", null, "environment-1"]))).toEqual(
    [],
  );
});

it("does not expose an archived snapshot failure message", () => {
  const environmentId = EnvironmentId.make("env-sensitive");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    isConnectedAtom: () => Atom.make(true),
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationV2ArchivedShellSnapshot, Error>(
          Cause.fail(new Error("credential=secret-value")),
        ),
      ),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  expect(registry.get(snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
    snapshots: [],
    error: "Failed to load archived threads.",
    isLoading: false,
  });

  registry.dispose();
});

it("hides cached archives on disconnect and restores them on reconnect", () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const connectedAtom = Atom.family((_id: EnvironmentId) => Atom.make(true));
  const snapshot = {
    ...v2ShellSnapshot,
    threads: [{ ...v2ThreadShell, archivedAt: v2Now }],
  };
  const snapshotAtom = Atom.family((_id: EnvironmentId) =>
    Atom.make(AsyncResult.success(snapshot)),
  );
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
    isConnectedAtom: connectedAtom,
    getSnapshotAtom: snapshotAtom,
    labelPrefix: "test:archived-thread-snapshots",
  })(makeArchivedThreadsEnvironmentKey([local, remote]));
  const registry = AtomRegistry.make();
  const dispose = registry.mount(snapshotsAtom);
  try {
    const before = registry.get(snapshotsAtom);
    expect(before.snapshots.map((entry) => entry.environmentId)).toEqual([local, remote]);
    registry.set(connectedAtom(remote), false);
    expect(registry.get(snapshotsAtom)).toEqual({
      snapshots: [{ environmentId: local, snapshot }],
      error: null,
      isLoading: false,
    });
    expect(registry.get(snapshotAtom(remote)).value).toBe(snapshot);
    registry.set(connectedAtom(remote), true);
    expect(registry.get(snapshotsAtom)).toEqual(before);
  } finally {
    dispose();
    registry.dispose();
  }
});
