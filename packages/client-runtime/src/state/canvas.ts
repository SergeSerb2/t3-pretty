import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createCanvasEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const applyScheduler = createAtomCommandScheduler();
  const selectionScheduler = createAtomCommandScheduler();
  const threadConcurrencyKey = ({
    environmentId,
    input,
  }: {
    environmentId: string;
    input: { threadId: string };
  }) => JSON.stringify([environmentId, input.threadId]);
  return {
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:canvas:get",
      tag: WS_METHODS.canvasGet,
      staleTimeMs: 5_000,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:canvas:events",
      tag: WS_METHODS.subscribeCanvasEvents,
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:canvas:apply",
      tag: WS_METHODS.canvasApply,
      scheduler: applyScheduler,
      // Applies are revision-chained, so per-thread FIFO keeps a burst of
      // local edits from racing each other into conflicts.
      concurrency: { mode: "serial", key: threadConcurrencyKey },
    }),
    updateSelection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:canvas:update-selection",
      tag: WS_METHODS.canvasUpdateSelection,
      scheduler: selectionScheduler,
      // Selection is last-writer-wins presence state; stale updates are noise.
      concurrency: { mode: "latest", key: threadConcurrencyKey },
    }),
  };
}
