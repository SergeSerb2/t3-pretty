import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentCatalogAtoms,
  ENVIRONMENT_CONNECTION_STATE_IDLE_TTL_MS,
} from "./connections.ts";

describe("createEnvironmentCatalogAtoms", () => {
  it("releases idle per-environment supervisor subscriptions", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createEnvironmentCatalogAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");

    expect(atoms.stateAtom(environmentId).idleTTL).toBe(ENVIRONMENT_CONNECTION_STATE_IDLE_TTL_MS);
  });
});
