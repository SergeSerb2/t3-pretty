import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  createAllEnvironmentProjectSnapshotsReadyAtom,
  createAllReachableShellsLiveAtom,
} from "./shell";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            projects: [],
            threads: [],
            archivedThreads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(environmentIds: readonly EnvironmentId[]): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: `https://${environmentId}.example.test`,
                  wsBaseUrl: `wss://${environmentId}.example.test`,
                })
              : new BearerConnectionTarget({
                  environmentId,
                  connectionId: environmentId,
                  label: environmentId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness(requiresPrimaryEnvironment = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const ready = createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    requiresPrimaryEnvironment,
  });
  const connections = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<AsyncResult.AsyncResult<SupervisorConnectionState>>(
      AsyncResult.success(AVAILABLE_CONNECTION_STATE),
    ),
  );
  const reachable = createAllReachableShellsLiveAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    connectionStateAtom: connections,
    requiresPrimaryEnvironment,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, connections, ready, reachable, registry };
}

describe("prompt-link shell readiness", () => {
  it("settles a discovered empty remote-only catalog without clearing saved project scopes", () => {
    const { catalog, reachable, ready, registry } = makeHarness(false);
    expect(registry.get(reachable)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(reachable)).toBe(true);
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for local primary discovery, including when a remote snapshot is already live", () => {
    const { catalog, shells, reachable, registry } = makeHarness();
    registry.set(catalog, catalogState([]));
    expect(registry.get(reachable)).toBe(false);
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(reachable)).toBe(false);
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(reachable)).toBe(true);
    registry.dispose();
  });

  it("waits for reachable remote snapshots or their settled offline state", () => {
    const { catalog, shells, connections, reachable, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(reachable)).toBe(false);
    registry.set(shells(REMOTE), shellState("cached"));
    registry.set(
      connections(REMOTE),
      AsyncResult.success({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "backoff",
        attempt: 2,
      }),
    );
    expect(registry.get(reachable)).toBe(false);
    registry.set(
      connections(REMOTE),
      AsyncResult.success({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "backoff",
        attempt: 3,
      }),
    );
    expect(registry.get(reachable)).toBe(true);
    registry.set(
      connections(REMOTE),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
    );
    expect(registry.get(reachable)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(reachable)).toBe(true);
    registry.dispose();
  });
});

describe("project snapshot readiness", () => {
  it("does not clear a saved scope while the ready catalog is still empty", () => {
    const { catalog, ready, registry } = makeHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for primary discovery even if a persisted remote is already live", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a hosted client to load projects without a primary environment", () => {
    const { catalog, shells, ready, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("waits for live snapshots through offline startup and reconnect", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    // An old cache and a reconnect in progress can both omit a real project.
    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("synchronizing"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("stops waiting for an environment only when it leaves the catalog", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([LOCAL]));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});
