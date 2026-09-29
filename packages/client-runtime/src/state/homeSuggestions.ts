/**
 * Home suggestions client state: one live snapshot per environment and the
 * two commands that change it. The snapshot arrives over
 * `subscribeHomeSuggestions`, which replays the current batch first, so a
 * consumer never has to call `homeSuggestions.get` separately.
 */
import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

const HOME_SUGGESTIONS_IDLE_TTL_MS = 10 * 60_000;

export function createHomeSuggestionsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const byEnvironment = {
    mode: "serial" as const,
    key: (target: { readonly environmentId: string }) => target.environmentId,
  };
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:home-suggestions:snapshot",
      tag: WS_METHODS.subscribeHomeSuggestions,
      idleTtlMs: HOME_SUGGESTIONS_IDLE_TTL_MS,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:home-suggestions:refresh",
      tag: WS_METHODS.homeSuggestionsRefresh,
      scheduler,
      concurrency: byEnvironment,
    }),
    dismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:home-suggestions:dismiss",
      tag: WS_METHODS.homeSuggestionsDismiss,
      scheduler,
      concurrency: byEnvironment,
    }),
  };
}
