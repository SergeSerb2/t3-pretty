import { describe, expect, it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import type { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentSessionAtoms, SESSION_STATE_IDLE_TTL_MS } from "./session.ts";

describe("environment session state", () => {
  it("releases idle environment session subscriptions", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | HttpClient.HttpClient,
      never
    >;
    const atoms = createEnvironmentSessionAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");

    expect(atoms.initialConfigAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
    expect(atoms.preparedConnectionAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
    expect(atoms.sessionStateAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
  });
});
