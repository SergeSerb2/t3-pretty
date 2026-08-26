import { EnvironmentId, type OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
  parseArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";

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
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationShellSnapshot, Error>(
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
