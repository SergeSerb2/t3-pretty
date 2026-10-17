import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Connectivity, Wakeups } from "@t3tools/client-runtime/connection";
import type * as Network from "expo-network";
import { afterEach, beforeEach, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  networkListeners: new Set<(state: Network.NetworkState) => void>(),
  appListeners: new Set<(state: string) => void>(),
  readNetwork: vi.fn<() => Promise<Network.NetworkState>>(),
  onSubscribed: () => {},
  offered: [] as unknown[],
  connectivity: null as Connectivity.Connectivity["Service"] | null,
  wakeups: null as Wakeups.ConnectionWakeups["Service"] | null,
}));

vi.mock("effect/Queue", async (original) => {
  const actual = await original<typeof import("effect/Queue")>();
  return {
    ...actual,
    offerUnsafe: (queue: Parameters<typeof actual.offerUnsafe>[0], value: unknown) => {
      native.offered.push(value);
      return actual.offerUnsafe(queue, value);
    },
  };
});
vi.mock("@t3tools/client-runtime/connection", async (original) => {
  const actual = await original<typeof import("@t3tools/client-runtime/connection")>();
  return {
    ...actual,
    Connectivity: {
      ...actual.Connectivity,
      layer: (service: Connectivity.Connectivity["Service"]) => {
        native.connectivity = service;
        return actual.Connectivity.layer(service);
      },
    },
    Wakeups: {
      ...actual.Wakeups,
      layer: (service: Wakeups.ConnectionWakeups["Service"]) => {
        native.wakeups = service;
        return actual.Wakeups.layer(service);
      },
    },
  };
});
vi.mock("expo-network", () => ({
  getNetworkStateAsync: native.readNetwork,
  addNetworkStateListener: (listener: (state: Network.NetworkState) => void) => {
    native.networkListeners.add(listener);
    native.onSubscribed();
    return { remove: () => native.networkListeners.delete(listener) };
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      native.appListeners.add(listener);
      return { remove: () => native.appListeners.delete(listener) };
    },
  },
}));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("../lib/authClientMetadata", () => ({ authClientMetadata: vi.fn() }));
vi.mock("../lib/runtime", async () => ({
  runtimeContextLayer: (await import("effect/Layer")).empty,
}));
vi.mock("./storage", async () => ({
  connectionStorageLayer: (await import("effect/Layer")).empty,
}));
vi.mock("../persistence/mobile-storage", () => ({}));
vi.mock("../state/thread-outbox-removal", () => ({ clearThreadOutboxEnvironment: vi.fn() }));
vi.mock("../state/use-composer-drafts", () => ({ clearComposerDraftsEnvironment: vi.fn() }));
vi.mock("../state/thread-composer-error", () => ({
  clearThreadComposerErrorsForEnvironment: vi.fn(),
}));

await import("./platform");

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  native.offered.length = 0;
  native.networkListeners.clear();
  native.appListeners.clear();
  native.readNetwork.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("mobile native network subscriptions", () => {
  it.effect(
    "restores connectivity from a current foreground probe and releases subscriptions",
    () =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const subscribed = pending<void>();
          const probe = pending<Network.NetworkState>();
          const probeFinished = pending<void>();
          native.onSubscribed = () => subscribed.resolve();
          native.readNetwork.mockReturnValue(probe.promise);
          const clearTimeout = globalThis.clearTimeout;
          vi.spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
            clearTimeout(timer);
            probeFinished.resolve();
          });
          yield* Stream.runDrain(native.connectivity!.changes).pipe(Effect.forkScoped);
          yield* Effect.promise(() => subscribed.promise);
          for (const listener of native.appListeners) listener("active");
          probe.resolve({ isConnected: true });
          yield* Effect.promise(() => probeFinished.promise);
          expect(native.offered).toEqual(["online"]);
        }).pipe(Effect.scoped);
        expect(native.networkListeners.size).toBe(0);
        expect(native.appListeners.size).toBe(0);
      }),
  );

  it.effect("keeps a newer listener event when a stale foreground probe resolves", () =>
    Effect.gen(function* () {
      const subscribed = pending<void>();
      const probe = pending<Network.NetworkState>();
      const probeFinished = pending<void>();
      native.onSubscribed = () => subscribed.resolve();
      native.readNetwork.mockReturnValue(probe.promise);
      const clearTimeout = globalThis.clearTimeout;
      vi.spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
        clearTimeout(timer);
        probeFinished.resolve();
      });
      yield* Stream.runDrain(native.connectivity!.changes).pipe(Effect.forkScoped);
      yield* Effect.promise(() => subscribed.promise);
      for (const listener of native.appListeners) listener("active");
      for (const listener of native.networkListeners) listener({ isConnected: false });
      probe.resolve({ isConnected: true });
      yield* Effect.promise(() => probeFinished.promise);
      expect(native.offered).toEqual(["offline"]);
    }).pipe(Effect.scoped),
  );

  it.effect("wakes on the first path event before the initial snapshot resolves", () =>
    Effect.gen(function* () {
      const subscribed = pending<void>();
      const snapshot = pending<Network.NetworkState>();
      native.onSubscribed = () => subscribed.resolve();
      native.readNetwork.mockReturnValue(snapshot.promise);
      yield* Stream.runDrain(native.wakeups!.changes).pipe(Effect.forkScoped);
      yield* Effect.promise(() => subscribed.promise);
      for (const listener of native.networkListeners) {
        listener({ isConnected: true, type: "CELLULAR" as Network.NetworkStateType });
      }
      expect(native.offered.filter((value) => value === "network-changed")).toEqual([
        "network-changed",
      ]);
      snapshot.resolve({ isConnected: true, type: "WIFI" as Network.NetworkStateType });
    }).pipe(Effect.scoped),
  );
});
